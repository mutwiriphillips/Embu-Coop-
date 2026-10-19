const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { z } = require("zod");
const prisma = require("../config/db");
const { recordAudit } = require("../utils/audit");
const { checkNewPassword } = require("../utils/passwordPolicy");
const { flagDefaultPassword, changeOwnPassword } = require("../utils/accountPassword");

const registerSchema = z.object({
  cooperativeId: z.string().uuid(),
  nationalId: z.string().min(1),
  phoneNumber: z.string().min(1),
  email: z.string().email().optional(),
  password: z.string().min(1),
});

const loginSchema = z.object({
  nationalId: z.string().min(1),
  password: z.string().min(1),
});

function signMemberToken(account) {
  return jwt.sign({ sub: account.id, type: "member" }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || "8h",
  });
}

function toPublicMember(member, account) {
  return {
    memberId: member.id,
    legalName: member.legalName,
    gender: member.gender,
    shareCapital: member.shareCapital,
    joinedAt: member.createdAt,
    cooperative: member.cooperative
      ? {
          id: member.cooperative.id,
          name: member.cooperative.name,
          valueChain: member.cooperative.valueChain,
          registrationNumber: member.cooperative.registrationNumber,
        }
      : undefined,
    account: {
      id: account.id,
      phoneNumber: account.phoneNumber,
      email: account.email,
      mustChangePassword: Boolean(account.mustChangePassword),
    },
  };
}

/**
 * Registration verifies the submitted National ID + cooperative selection
 * against an existing Member record that staff already created (via the
 * Cooperative Manager or Field Officer member-roll entry) — see
 * cooperativeController.addMember. This platform has no integration with
 * IPRS or any external government ID registry; "verification" here means
 * matching against the cooperative's own membership records, which is the
 * only ground truth this system actually has. That is a deliberate,
 * documented scope boundary, not an oversight — wiring a real eCitizen/IPRS
 * check would need a separate government-facing agreement.
 */
async function register(req, res) {
  const data = registerSchema.parse(req.body);

  const member = await prisma.member.findUnique({
    where: { cooperativeId_nationalId: { cooperativeId: data.cooperativeId, nationalId: data.nationalId } },
    include: { account: true },
  });

  // A National ID is not a secret, so the ID alone must not let anyone claim a
  // member's account. The phone number must also match the one the cooperative
  // recorded. Both failures give the same answer, so this can't be used to find
  // out who is a member.
  const lastNine = (v) => String(v || "").replace(/\D/g, "").slice(-9);
  const notFound = {
    error: "We could not match those details to a member record. Check the National ID and the phone number your cooperative has on file, or ask your Cooperative Manager to confirm your registration.",
  };
  if (!member || !member.phoneNumber || lastNine(member.phoneNumber).length < 9 || lastNine(member.phoneNumber) !== lastNine(data.phoneNumber)) {
    return res.status(404).json(notFound);
  }

  if (member.account) {
    return res.status(409).json({ error: "An account already exists for this member. Please log in instead." });
  }

  const problem = checkNewPassword(data.password);
  if (problem) return res.status(400).json({ error: `Password: ${problem}` });
  const passwordHash = await bcrypt.hash(data.password, 12);

  const account = await prisma.memberAccount.create({
    data: {
      memberId: member.id,
      nationalId: data.nationalId,
      phoneNumber: data.phoneNumber,
      email: data.email,
      passwordHash,
    },
  });

  await recordAudit({
    action: "MEMBER_SELF_REGISTER",
    entityType: "MemberAccount",
    entityId: account.id,
    metadata: { memberId: member.id, cooperativeId: data.cooperativeId },
  });

  const memberWithCoop = await prisma.member.findUnique({
    where: { id: member.id },
    include: { cooperative: true },
  });

  const token = signMemberToken(account);
  res.status(201).json({ token, member: toPublicMember(memberWithCoop, account) });
}

async function login(req, res) {
  const { nationalId, password } = loginSchema.parse(req.body);

  const account = await prisma.memberAccount.findUnique({
    where: { nationalId },
    include: { member: { include: { cooperative: true } } },
  });

  if (!account || !account.active) {
    return res.status(401).json({ error: "Invalid credentials" });
  }

  const valid = await bcrypt.compare(password, account.passwordHash);
  if (!valid) {
    return res.status(401).json({ error: "Invalid credentials" });
  }

  await prisma.memberAccount.update({ where: { id: account.id }, data: { lastLoginAt: new Date() } });
  await flagDefaultPassword("memberAccount", account, password);

  const token = signMemberToken(account);
  res.json({ token, member: toPublicMember(account.member, account) });
}

async function me(req, res) {
  res.json({ member: toPublicMember(req.member, req.memberAccount) });
}

// POST /api/member-auth/change-password
async function changePassword(req, res) {
  const updated = await changeOwnPassword("memberAccount", req.memberAccount, req.body || {}, "MEMBER_PASSWORD_CHANGED");
  res.json({ token: signMemberToken(updated), member: toPublicMember(req.member, updated) });
}

module.exports = { register, login, me, changePassword, toPublicMember };
