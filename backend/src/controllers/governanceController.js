const { z } = require("zod");
const prisma = require("../config/db");
const { recordAudit } = require("../utils/audit");
const { saveFile, assertValidFile, toStorageKey, fileIdFromKey } = require("../utils/fileStorage");
const { httpError } = require("../utils/geography");
const { assertBelongs } = require("../utils/ownership");
const {
  checkOneThirdRule,
  genderRuleEnforced,
  deriveCommitteeStatus,
  computeReelectionDueDate,
  isServing,
  latestPerType,
  withLiveStatus,
  BOARD_POSITIONS,
  BOARD_POSITION_LABELS,
  BOARD_TERM_YEARS,
  boardMemberStatus,
} = require("../utils/governance");
const { phoneSchema, nationalIdSchema, requiredDate, optionalDate, clearableDate } = require("../utils/validators");

// The roles of the Management Committee. (The two supervisory roles in the
// database enum are not used: the Supervisory Board has its own record.)
const MANAGEMENT_ROLES = ["CHAIRPERSON", "VICE_CHAIRPERSON", "SECRETARY", "TREASURER", "BOARD_MEMBER", "EXECUTIVE_MANAGER"];
const roleSchema = z.enum(MANAGEMENT_ROLES);

const retiresAfterAppointment = (m) => !m.retirementDate || !m.appointmentDate || m.retirementDate >= m.appointmentDate;
const RETIRE_MSG = { message: "Retirement date can't be before the date of appointment", path: ["retirementDate"] };

const committeeMemberSchema = z
  .object({
    fullName: z.string().trim().min(1, "Full name is required"),
    gender: z.enum(["MALE", "FEMALE"]),
    role: roleSchema,
    nationalId: nationalIdSchema,
    phoneNumber: phoneSchema,
    // The form asks for one date, "Date appointed". The election date is still
    // kept on every record (it starts the 3-year term), and defaults to the
    // date appointed unless the caller sends a different one.
    electionDate: optionalDate("Election date"),
    appointmentDate: requiredDate("Date appointed"),
    retirementDate: optionalDate("Retirement date"),
  })
  .refine(retiresAfterAppointment, RETIRE_MSG)
  .transform((m) => ({ ...m, electionDate: m.electionDate ?? m.appointmentDate }));

const committeeSchema = z.object({
  committeeType: z
    .literal("MANAGEMENT", { errorMap: () => ({ message: "Only the Management Committee is recorded here. The Supervisory Board has its own tab." }) })
    .default("MANAGEMENT"),
  termLengthYears: z.number().int().positive().max(10).default(3),
  members: z.array(committeeMemberSchema).min(1, "Add at least one committee member").max(50),
});

// Edits to someone already on a committee: identity, contact and service
// dates only. Role and gender are not editable here because they decide the
// 1/3 rule; to change them, submit the committee again.
const committeeMemberEditSchema = z.object({
  fullName: z.string().trim().min(1).optional(),
  nationalId: nationalIdSchema.optional(),
  phoneNumber: phoneSchema.optional(),
  appointmentDate: optionalDate("Date of appointment"),
  retirementDate: clearableDate("Retirement date"),
});

const boardSchema = z
  .object({
    position: z.enum(BOARD_POSITIONS, { errorMap: () => ({ message: "Choose Chairman, Honorary Secretary or Member" }) }),
    fullName: z.string().trim().min(1, "Full name is required"),
    nationalId: nationalIdSchema,
    phoneNumber: phoneSchema,
    appointmentDate: requiredDate("Date of appointment"),
    retirementDate: optionalDate("Retirement date"),
  })
  .refine(retiresAfterAppointment, RETIRE_MSG);

const boardEditSchema = committeeMemberEditSchema;

const OVERRIDE_ROLES = ["NATIONAL_ADMIN", "DIRECTOR"];

// Nobody may hold two seats at once: two members still in office can't share
// an ID number.
function assertNoDuplicateServing(members, now = new Date()) {
  const seen = new Map();
  for (const m of members) {
    if (!m.nationalId || !isServing(m, now)) continue;
    if (seen.has(m.nationalId)) {
      throw httpError(400, `ID number ${m.nationalId} appears twice for people still in office (${seen.get(m.nationalId)} and ${m.fullName}). One person can't hold two seats.`);
    }
    seen.set(m.nationalId, m.fullName);
  }
}

const signatorySchema = z.object({
  fullName: z.string().min(1),
  role: z.string().min(1),
  bankAccount: z.string().min(1),
});

const overrideSchema = z.object({
  justification: z.string().trim().min(10),
});

// Creates/replaces a committee composition. Runs the 1/3 rule check;
// blocks submission on violation unless already overridden by the Director.
async function saveCommittee(req, res) {
  const data = committeeSchema.parse(req.body);
  assertNoDuplicateServing(data.members);

  const ruleResult = checkOneThirdRule(data.members);
  const status = deriveCommitteeStatus(
    data.members.map((m) => ({
      ...m,
      reelectionDueDate: computeReelectionDueDate(m.electionDate, data.termLengthYears),
    }))
  );

  // While enforcement is suspended nothing is blocked and nothing counts as an
  // "override": the committee is saved as submitted and its status still shows
  // NON_COMPLIANT, so the imbalance stays visible for when enforcement starts.
  const enforced = genderRuleEnforced();
  const blocking = enforced && !ruleResult.compliant;
  const justification = enforced ? String(req.body.overrideJustification || "").trim() : "";
  if (blocking) {
    if (!justification) {
      return res.status(422).json({
        error: "1/3 gender rotation rule violation — submission blocked",
        detail: ruleResult,
        hint: "A Director may resubmit with 'overrideJustification' to log an override.",
      });
    }
    // The block is the rule; only a Director (or the National Admin) may lift it.
    // Before, anyone able to edit governance could lift it by typing any text.
    if (!OVERRIDE_ROLES.includes(req.user.role)) {
      return res.status(403).json({
        error: "Only a Director can override the 1/3 gender rule. Ask your County Director to submit this committee.",
        detail: ruleResult,
      });
    }
    if (justification.length < 10) {
      return res.status(400).json({ error: "The override justification must be at least 10 characters." });
    }
  }

  const committee = await prisma.committee.create({
    data: {
      cooperativeId: req.params.id,
      committeeType: data.committeeType,
      termLengthYears: data.termLengthYears,
      status,
      complianceOverride: blocking,
      overrideJustification: blocking ? justification : null,
      members: {
        create: data.members.map((m) => ({
          fullName: m.fullName,
          gender: m.gender,
          role: m.role,
          nationalId: m.nationalId,
          phoneNumber: m.phoneNumber,
          appointmentDate: m.appointmentDate,
          retirementDate: m.retirementDate ?? null,
          electionDate: m.electionDate,
          reelectionDueDate: computeReelectionDueDate(m.electionDate, data.termLengthYears),
        })),
      },
    },
    include: { members: true },
  });

  await recordAudit({
    userId: req.user.id,
    action: "SAVE_COMMITTEE",
    entityType: "Committee",
    entityId: committee.id,
    metadata: { ruleResult, overridden: blocking, genderRuleEnforced: enforced },
  });

  res.status(201).json({ committee, complianceCheck: ruleResult, genderRuleEnforced: enforced });
}

// Lets the app say whether a lopsided committee will be blocked or just flagged.
async function getRules(req, res) {
  res.json({ genderRuleEnforced: genderRuleEnforced() });
}

async function listCommittees(req, res) {
  const committees = await prisma.committee.findMany({
    where: { cooperativeId: req.params.id },
    include: { members: true, signatories: true },
    orderBy: { createdAt: "desc" },
  });

  res.json(withLiveStatus(committees));
}

// Director-only override endpoint for a previously blocked composition.
async function overrideCommittee(req, res) {
  const { justification } = overrideSchema.parse(req.body);
  assertBelongs(await prisma.committee.findUnique({ where: { id: req.params.committeeId } }), req.params.id, "Committee");

  const committee = await prisma.committee.update({
    where: { id: req.params.committeeId },
    data: { complianceOverride: true, overrideJustification: justification },
  });

  await recordAudit({
    userId: req.user.id,
    action: "OVERRIDE_COMMITTEE_COMPLIANCE",
    entityType: "Committee",
    entityId: committee.id,
    metadata: { justification },
  });

  res.json(committee);
}

// --- Signatories ---

async function addSignatory(req, res) {
  const data = signatorySchema.parse(req.body);
  assertBelongs(await prisma.committee.findUnique({ where: { id: req.params.committeeId } }), req.params.id, "Committee");
  const signatory = await prisma.signatory.create({
    data: { ...data, committeeId: req.params.committeeId },
  });

  await recordAudit({
    userId: req.user.id,
    action: "ADD_SIGNATORY",
    entityType: "Signatory",
    entityId: signatory.id,
  });

  res.status(201).json(signatory);
}

// PATCH /committees/:committeeId/members/:memberId
// Fill in or correct a committee member's ID, phone number and service dates,
// and record a retirement. This is how members recorded before these fields
// existed are completed, without resubmitting the whole committee.
async function updateCommitteeMember(req, res) {
  const data = committeeMemberEditSchema.parse(req.body);
  const committee = await prisma.committee.findUnique({ where: { id: req.params.committeeId }, include: { members: true } });
  assertBelongs(committee, req.params.id, "Committee");
  const member = committee.members.find((m) => m.id === req.params.memberId);
  if (!member) throw httpError(404, "Committee member not found");

  const changes = Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined));
  if (!Object.keys(changes).length) throw httpError(400, "Nothing to change");
  const merged = { ...member, ...changes };
  const start = merged.appointmentDate || merged.electionDate;
  if (merged.retirementDate && new Date(merged.retirementDate) < new Date(start)) {
    throw httpError(400, "Retirement date can't be before the date of appointment");
  }
  assertNoDuplicateServing(committee.members.map((m) => (m.id === member.id ? merged : m)));

  // The election date normally equals the date appointed (that is how the
  // form records it). If the appointed date is corrected and the two were the
  // same day, the election date and the re-election due date move with it;
  // a deliberately different election date is left alone.
  const day = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null);
  if (changes.appointmentDate && member.electionDate && day(member.electionDate) === day(member.appointmentDate)) {
    changes.electionDate = changes.appointmentDate;
    changes.reelectionDueDate = computeReelectionDueDate(changes.appointmentDate, committee.termLengthYears);
  }
  const updated = await prisma.committeeMember.update({ where: { id: member.id }, data: changes });
  // Audit the fields touched, never the ID or phone values themselves.
  await recordAudit({
    userId: req.user.id,
    action: "UPDATE_COMMITTEE_MEMBER",
    entityType: "CommitteeMember",
    entityId: member.id,
    metadata: { committeeId: committee.id, fields: Object.keys(changes) },
  });
  const members = committee.members.map((m) => (m.id === member.id ? updated : m));
  res.json({ member: updated, committeeStatus: deriveCommitteeStatus(members) });
}

// --- Supervisory Board: Chairman, Honorary Secretary, Member ---

// Two stints overlap when each starts before the other ends (an open-ended
// stint, still serving, never ends).
function overlaps(a, b) {
  const aEnd = a.retirementDate ? new Date(a.retirementDate).getTime() : Infinity;
  const bEnd = b.retirementDate ? new Date(b.retirementDate).getTime() : Infinity;
  return new Date(a.appointmentDate).getTime() < bEnd && new Date(b.appointmentDate).getTime() < aEnd;
}
const fmt = (d) => new Date(d).toISOString().slice(0, 10);

function assertBoardFits(candidate, others) {
  for (const o of others) {
    if (!overlaps(candidate, o)) continue;
    if (o.position === candidate.position) {
      throw httpError(409, `The ${BOARD_POSITION_LABELS[candidate.position]} seat is held by ${o.fullName} from ${fmt(o.appointmentDate)}${o.retirementDate ? ` to ${fmt(o.retirementDate)}` : ""}. Record their retirement date first, then appoint the new holder (the new appointment can't start before that date).`);
    }
    if (o.nationalId === candidate.nationalId) {
      throw httpError(409, `ID number ${candidate.nationalId} is already on the Supervisory Board as ${BOARD_POSITION_LABELS[o.position]} (${o.fullName}) over those dates. One person can't hold two seats.`);
    }
  }
}

async function managementServingIds(cooperativeId) {
  const committees = await prisma.committee.findMany({ where: { cooperativeId, committeeType: "MANAGEMENT" }, include: { members: true } });
  const [current] = latestPerType(committees);
  return new Set((current?.members || []).filter((m) => isServing(m) && m.nationalId).map((m) => m.nationalId));
}

function decorateBoard(rows, mgmtIds) {
  return rows.map((r) => ({
    ...r,
    positionLabel: BOARD_POSITION_LABELS[r.position],
    status: boardMemberStatus(r),
    termEndsOn: computeTermEnd(r.appointmentDate),
    // A warning, not a block: Rule 28(4) keeps the two bodies' powers apart,
    // so the same person on both deserves a second look.
    alsoOnManagementCommittee: isServing(r) && mgmtIds.has(r.nationalId),
  }));
}
const computeTermEnd = (appointmentDate) => computeReelectionDueDate(appointmentDate, BOARD_TERM_YEARS);

// GET /governance/supervisory-board
async function listBoard(req, res) {
  const rows = await prisma.supervisoryBoardMember.findMany({
    where: { cooperativeId: req.params.id },
    orderBy: { appointmentDate: "desc" },
  });
  res.json(decorateBoard(rows, await managementServingIds(req.params.id)));
}

// POST /governance/supervisory-board
async function addBoardMember(req, res) {
  const data = boardSchema.parse(req.body);
  const existing = await prisma.supervisoryBoardMember.findMany({ where: { cooperativeId: req.params.id } });
  assertBoardFits(data, existing);
  const member = await prisma.supervisoryBoardMember.create({ data: { ...data, retirementDate: data.retirementDate ?? null, cooperativeId: req.params.id } });
  await recordAudit({
    userId: req.user.id,
    action: "ADD_SUPERVISORY_MEMBER",
    entityType: "SupervisoryBoardMember",
    entityId: member.id,
    metadata: { position: member.position, fullName: member.fullName, appointmentDate: member.appointmentDate },
  });
  res.status(201).json(decorateBoard([member], await managementServingIds(req.params.id))[0]);
}

// PATCH /governance/supervisory-board/:memberId (correct details, record a retirement)
async function updateBoardMember(req, res) {
  const data = boardEditSchema.parse(req.body);
  const member = await prisma.supervisoryBoardMember.findUnique({ where: { id: req.params.memberId } });
  assertBelongs(member, req.params.id, "Board member");
  const changes = Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined));
  if (!Object.keys(changes).length) throw httpError(400, "Nothing to change");
  const merged = { ...member, ...changes };
  if (merged.retirementDate && new Date(merged.retirementDate) < new Date(merged.appointmentDate)) {
    throw httpError(400, "Retirement date can't be before the date of appointment");
  }
  const others = (await prisma.supervisoryBoardMember.findMany({ where: { cooperativeId: req.params.id } })).filter((o) => o.id !== member.id);
  assertBoardFits(merged, others);
  const updated = await prisma.supervisoryBoardMember.update({ where: { id: member.id }, data: changes });
  await recordAudit({
    userId: req.user.id,
    action: "UPDATE_SUPERVISORY_MEMBER",
    entityType: "SupervisoryBoardMember",
    entityId: member.id,
    metadata: { position: member.position, fields: Object.keys(changes) },
  });
  res.json(decorateBoard([updated], await managementServingIds(req.params.id))[0]);
}

// DELETE /governance/supervisory-board/:memberId (entered by mistake)
// For a person who really served and left, record a retirement date instead:
// that keeps the history. Deleting is for entries that should never have been made.
async function deleteBoardMember(req, res) {
  const member = await prisma.supervisoryBoardMember.findUnique({ where: { id: req.params.memberId } });
  assertBelongs(member, req.params.id, "Board member");
  await prisma.supervisoryBoardMember.delete({ where: { id: member.id } });
  await recordAudit({
    userId: req.user.id,
    action: "DELETE_SUPERVISORY_MEMBER",
    entityType: "SupervisoryBoardMember",
    entityId: member.id,
    metadata: { position: member.position, fullName: member.fullName },
  });
  res.status(204).send();
}

// --- Election candidates ---

const candidateSchema = z.object({
  fullName: z.string().min(1),
  gender: z.enum(["MALE", "FEMALE"]),
  roleAppliedFor: roleSchema,
  enteredByStaff: z.boolean().default(false),
});

async function applyCandidate(req, res) {
  const data = candidateSchema.parse(req.body);
  const candidate = await prisma.electionCandidate.create({
    data: { ...data, cooperativeId: req.params.id },
  });
  res.status(201).json(candidate);
}

async function listCandidates(req, res) {
  const candidates = await prisma.electionCandidate.findMany({
    where: { cooperativeId: req.params.id },
    orderBy: { createdAt: "desc" },
  });
  res.json(candidates);
}

async function updateCandidateStatus(req, res) {
  const { status } = z
    .object({ status: z.enum(["APPLIED", "UNDER_REVIEW", "APPROVED", "REJECTED"]) })
    .parse(req.body);
  assertBelongs(await prisma.electionCandidate.findUnique({ where: { id: req.params.candidateId } }), req.params.id, "Candidate");

  const candidate = await prisma.electionCandidate.update({
    where: { id: req.params.candidateId },
    data: { status },
  });
  res.json(candidate);
}

// --- AGM ---

const agmSchema = z.object({
  agmType: z.enum(["ANNUAL", "EXTRAORDINARY"]),
  meetingDate: z.coerce.date(),
  noticeStorageKey: z.string().optional(),
  minutesStorageKey: z.string().optional(),
});

// Store the AGM's notice / minutes files (multipart fields "notice" and
// "minutes") and return the storageKey columns to set. Both are checked first,
// so one bad file never leaves the other half-saved.
async function storeAgmFiles(req) {
  const notice = req.files?.notice?.[0];
  const minutes = req.files?.minutes?.[0];
  assertValidFile(notice, "AGM_NOTICE");
  assertValidFile(minutes, "AGM_MINUTES");
  const scope = { countyId: req.cooperative.countyId, cooperativeId: req.cooperative.id };
  const keys = {};
  if (notice) keys.noticeStorageKey = toStorageKey((await saveFile({ file: notice, purpose: "AGM_NOTICE", scope, uploadedByUserId: req.user.id })).id);
  if (minutes) keys.minutesStorageKey = toStorageKey((await saveFile({ file: minutes, purpose: "AGM_MINUTES", scope, uploadedByUserId: req.user.id })).id);
  return keys;
}

const withFileIds = (a) => ({ ...a, noticeFileId: fileIdFromKey(a.noticeStorageKey), minutesFileId: fileIdFromKey(a.minutesStorageKey) });

async function recordAGM(req, res) {
  const { noticeStorageKey, minutesStorageKey, ...data } = agmSchema.parse(req.body);
  const files = await storeAgmFiles(req);
  const agm = await prisma.aGM.create({ data: { ...data, ...files, cooperativeId: req.params.id } });

  await recordAudit({
    userId: req.user.id,
    action: "RECORD_AGM",
    entityType: "AGM",
    entityId: agm.id,
  });

  res.status(201).json(withFileIds(agm));
}

// POST /cooperatives/:id/governance/agms/:agmId/files  (multipart notice / minutes)
// The letter calling the AGM comes before the meeting and the signed minutes
// only after it, so files can be added to an AGM after it's recorded.
async function attachAGMFiles(req, res) {
  const agm = await prisma.aGM.findUnique({ where: { id: req.params.agmId } });
  if (!agm || agm.cooperativeId !== req.params.id) throw httpError(404, "AGM not found");
  const files = await storeAgmFiles(req);
  if (!Object.keys(files).length) throw httpError(400, "Attach the notice, the minutes, or both");
  const updated = await prisma.aGM.update({ where: { id: agm.id }, data: files });
  await recordAudit({ userId: req.user.id, action: "ATTACH_AGM_FILES", entityType: "AGM", entityId: agm.id, metadata: Object.keys(files) });
  res.json(withFileIds(updated));
}

async function listAGMs(req, res) {
  const agms = await prisma.aGM.findMany({
    where: { cooperativeId: req.params.id },
    orderBy: { meetingDate: "desc" },
  });
  res.json(agms.map(withFileIds));
}

module.exports = {
  updateCommitteeMember,
  listBoard,
  addBoardMember,
  updateBoardMember,
  deleteBoardMember,
  attachAGMFiles,
  saveCommittee,
  listCommittees,
  overrideCommittee,
  getRules,
  addSignatory,
  applyCandidate,
  listCandidates,
  updateCandidateStatus,
  recordAGM,
  listAGMs,
};
