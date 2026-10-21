// Compliance indicator for a cooperative: how complete is its record?
// Societies are mass-loaded with only a name, type and location, then filled in
// one by one (registration details, documents, members, governance). Each item
// below is either on file or missing; nothing is guessed or auto-passed.

const AGM_WINDOW_MONTHS = 12;

const ITEMS = [
  { key: "registrationNumber", label: "Registration number", where: "Registration details" },
  { key: "registrationDate", label: "Date of registration", where: "Registration details" },
  { key: "location", label: "Sub-county and ward match the official list", where: "Registration details" },
  { key: "certificate", label: "Certificate of Registration uploaded", where: "Documents" },
  { key: "bylaws", label: "By-laws uploaded", where: "Documents" },
  { key: "members", label: "Member list added", where: "Members" },
  { key: "committee", label: "Management committee recorded", where: "Governance" },
  { key: "board", label: "Supervisory board recorded", where: "Supervisory Board" },
  { key: "agm", label: `AGM held in the last ${AGM_WINDOW_MONTHS} months`, where: "AGM" },
  { key: "audit", label: "Audit report on file", where: "Documents" },
];

/**
 * @param coop   the cooperative row
 * @param facts  { docTypes: string[] (non-rejected uploads), members: number, managementMembers: number,
 *                 boardMembers: number, agmDates: Date[] }
 */
function computeCompliance(coop, facts = {}, now = new Date()) {
  const docs = new Set(facts.docTypes || []);
  const since = new Date(now); since.setMonth(since.getMonth() - AGM_WINDOW_MONTHS);
  const done = {
    registrationNumber: Boolean(coop.registrationNumber),
    registrationDate: Boolean(coop.registrationDate),
    location: Boolean(coop.subCountyId && coop.wardId),
    certificate: docs.has("REGISTRATION_CERTIFICATE"),
    bylaws: docs.has("BY_LAWS"),
    members: (facts.members || 0) > 0,
    committee: (facts.managementMembers || 0) > 0,
    board: (facts.boardMembers || 0) > 0,
    agm: (facts.agmDates || []).some((d) => new Date(d) >= since && new Date(d) <= now),
    audit: docs.has("AUDIT_REPORT"),
  };
  const items = ITEMS.map((i) => ({ ...i, done: done[i.key] }));
  const doneCount = items.filter((i) => i.done).length;
  const percent = Math.round((doneCount / items.length) * 100);
  const level = doneCount === items.length ? "COMPLIANT" : percent >= 50 ? "PARTIAL" : "INCOMPLETE";
  return { level, percent, done: doneCount, total: items.length, missing: items.filter((i) => !i.done).map(({ key, label, where }) => ({ key, label, where })), items };
}

/** Gathers the facts for many cooperatives in a few queries (not one per cooperative). */
async function complianceFor(prisma, coops, now = new Date()) {
  const ids = coops.map((c) => c.id);
  if (!ids.length) return new Map();
  const [docs, members, committees, board, agms] = await Promise.all([
    prisma.document.findMany({ where: { cooperativeId: { in: ids } }, select: { cooperativeId: true, docType: true, status: true } }),
    prisma.member.findMany({ where: { cooperativeId: { in: ids } }, select: { cooperativeId: true } }),
    prisma.committee.findMany({ where: { cooperativeId: { in: ids } }, include: { members: true } }),
    prisma.supervisoryBoardMember.findMany({ where: { cooperativeId: { in: ids } }, select: { cooperativeId: true } }),
    prisma.aGM.findMany({ where: { cooperativeId: { in: ids } }, select: { cooperativeId: true, meetingDate: true } }),
  ]);
  const by = (rows) => { const m = new Map(); rows.forEach((r) => { if (!m.has(r.cooperativeId)) m.set(r.cooperativeId, []); m.get(r.cooperativeId).push(r); }); return m; };
  const D = by(docs), M = by(members), C = by(committees), B = by(board), A = by(agms);
  const out = new Map();
  for (const c of coops) {
    const cm = C.get(c.id) || [];
    out.set(c.id, computeCompliance(c, {
      docTypes: (D.get(c.id) || []).filter((d) => d.status !== "REJECTED").map((d) => d.docType),
      members: (M.get(c.id) || []).length,
      managementMembers: cm.filter((x) => x.committeeType === "MANAGEMENT").reduce((n, x) => n + (x.members || []).length, 0),
      boardMembers: (B.get(c.id) || []).length + cm.filter((x) => x.committeeType === "SUPERVISORY").reduce((n, x) => n + (x.members || []).length, 0),
      agmDates: (A.get(c.id) || []).map((a) => a.meetingDate),
    }, now));
  }
  return out;
}

module.exports = { computeCompliance, complianceFor, ITEMS };
