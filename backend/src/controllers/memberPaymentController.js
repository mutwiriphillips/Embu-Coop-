const { z } = require("zod");
const prisma = require("../config/db");
const { recordAudit } = require("../utils/audit");
const { httpError } = require("../utils/geography");

// Payments keyed in by hand by the National Admin, ahead of the M-Pesa integration:
// amount, the month it is for, and the pasted transaction message. They are ordinary
// MONTHLY_CONTRIBUTION rows (forMonth set), so the member portal, the contribution
// totals and the credit score pick them up with no second entry.
const ADMIN = "NATIONAL_ADMIN";

const thisMonth = () => new Date().toISOString().slice(0, 7);
const paymentSchema = z.object({
  amount: z.number().positive("Enter the amount paid").max(10000000),
  forMonth: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Choose the month paid").refine((m) => m <= thisMonth(), "That month hasn't started yet"),
  transactionMessage: z.string().trim().min(5, "Paste the transaction message").max(1000),
});

// An M-Pesa receipt code is 10 letters/digits with at least one of each (e.g. SJK4X7ABCD).
const RECEIPT = /\b(?=[A-Z0-9]*[A-Z])(?=[A-Z0-9]*\d)[A-Z0-9]{10}\b/;
const KSH = /ksh\.?\s?([\d,]+(?:\.\d{1,2})?)/i;
const receiptOf = (msg) => (RECEIPT.exec(msg) || [])[0] || null;
const messageAmount = (msg) => { const m = KSH.exec(msg); return m ? Number(m[1].replace(/,/g, "")) : null; };

async function loadMember(req) {
  const member = await prisma.member.findUnique({ where: { id: req.params.memberId } });
  if (!member || member.cooperativeId !== req.params.id) throw httpError(404, "Member not found in this cooperative");
  return member;
}

// GET /cooperatives/:id/members/:memberId/payments  — history of hand-keyed payments.
// The transaction message (it can hold phone numbers and names) goes to the National Admin only.
async function list(req, res) {
  const member = await loadMember(req);
  const rows = await prisma.contribution.findMany({ where: { memberId: member.id, cooperativeId: req.params.id, forMonth: { not: null } }, orderBy: { createdAt: "desc" } });
  const isAdmin = req.user.role === ADMIN;
  res.json(rows.map((c) => ({
    id: c.id, amount: Number(c.amount), forMonth: c.forMonth, receipt: c.externalRef, recordedAt: c.createdAt,
    hasMessage: Boolean(c.transactionMessage), ...(isAdmin ? { transactionMessage: c.transactionMessage } : {}),
  })));
}

// POST /cooperatives/:id/members/:memberId/payments  (National Admin only)
async function record(req, res) {
  const data = paymentSchema.parse(req.body);
  const member = await loadMember(req);
  const receipt = receiptOf(data.transactionMessage);
  if (receipt) {
    const dup = await prisma.contribution.findFirst({ where: { cooperativeId: req.params.id, externalRef: receipt } });
    if (dup) throw httpError(409, `Receipt ${receipt} was already recorded. The same transaction can't be entered twice.`);
  }
  const [y, m] = data.forMonth.split("-").map(Number);
  const c = await prisma.contribution.create({
    data: {
      memberId: member.id, cooperativeId: req.params.id, amount: data.amount, type: "MONTHLY_CONTRIBUTION",
      method: receipt ? "MPESA" : "OTHER", externalRef: receipt, contributionDate: new Date(Date.UTC(y, m - 1, 1)),
      forMonth: data.forMonth, transactionMessage: data.transactionMessage, recordedById: req.user.id,
    },
  });
  await recordAudit({ userId: req.user.id, action: "MEMBER_PAYMENT_RECORDED", entityType: "Contribution", entityId: c.id, metadata: { memberId: member.id, amount: data.amount, forMonth: data.forMonth } });
  const warnings = [];
  const said = messageAmount(data.transactionMessage);
  if (said != null && said !== data.amount) warnings.push(`The message says KES ${said.toLocaleString()} but you entered KES ${data.amount.toLocaleString()}. Check it, and delete and re-enter if it is wrong.`);
  res.status(201).json({ id: c.id, amount: data.amount, forMonth: data.forMonth, receipt, warnings });
}

// DELETE /cooperatives/:id/members/:memberId/payments/:paymentId  (National Admin only)
// To correct a wrong entry. Only hand-keyed payments can be removed here.
async function remove(req, res) {
  const member = await loadMember(req);
  const c = await prisma.contribution.findUnique({ where: { id: req.params.paymentId } });
  if (!c || c.memberId !== member.id || c.cooperativeId !== req.params.id || !c.forMonth) throw httpError(404, "Payment not found");
  await prisma.contribution.delete({ where: { id: c.id } });
  await recordAudit({ userId: req.user.id, action: "MEMBER_PAYMENT_REMOVED", entityType: "Contribution", entityId: c.id, metadata: { memberId: member.id, amount: Number(c.amount), forMonth: c.forMonth } });
  res.json({ ok: true });
}

/** Per-member summary of hand-keyed payments for the Members column: Map(memberId -> {count,total,last}). */
async function paymentSummary(cooperativeId) {
  const rows = await prisma.contribution.findMany({ where: { cooperativeId, forMonth: { not: null } }, select: { memberId: true, amount: true, forMonth: true, createdAt: true } });
  const out = new Map();
  for (const r of rows) {
    const e = out.get(r.memberId) || { count: 0, total: 0, last: null };
    e.count++; e.total += Number(r.amount);
    if (!e.last || r.forMonth > e.last.forMonth || (r.forMonth === e.last.forMonth && r.createdAt > e.last.recordedAt)) e.last = { amount: Number(r.amount), forMonth: r.forMonth, recordedAt: r.createdAt };
    out.set(r.memberId, e);
  }
  return out;
}

module.exports = { list, record, remove, paymentSummary, receiptOf, messageAmount };
