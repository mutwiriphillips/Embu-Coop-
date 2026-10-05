const { z } = require("zod");
const prisma = require("../config/db");
const { recordAudit } = require("../utils/audit");
const { saveFile, assertValidFile, toStorageKey, fileIdFromKey } = require("../utils/fileStorage");
const { httpError } = require("../utils/geography");
const {
  checkOneThirdRule,
  deriveCommitteeStatus,
  computeReelectionDueDate,
} = require("../utils/governance");

const committeeMemberSchema = z.object({
  fullName: z.string().min(1),
  gender: z.enum(["MALE", "FEMALE"]),
  role: z.enum([
    "CHAIRPERSON",
    "VICE_CHAIRPERSON",
    "SECRETARY",
    "TREASURER",
    "BOARD_MEMBER",
    "EXECUTIVE_MANAGER",
    "SUPERVISORY_CHAIR",
    "SUPERVISORY_SECRETARY",
  ]),
  electionDate: z.coerce.date(),
});

const committeeSchema = z.object({
  committeeType: z.enum(["MANAGEMENT", "SUPERVISORY"]),
  termLengthYears: z.number().int().positive().default(3),
  members: z.array(committeeMemberSchema).min(1),
});

const signatorySchema = z.object({
  fullName: z.string().min(1),
  role: z.string().min(1),
  bankAccount: z.string().min(1),
});

const overrideSchema = z.object({
  justification: z.string().min(10),
});

// Creates/replaces a committee composition. Runs the 1/3 rule check;
// blocks submission on violation unless already overridden by the Director.
async function saveCommittee(req, res) {
  const data = committeeSchema.parse(req.body);

  const ruleResult = checkOneThirdRule(data.members);
  const status = deriveCommitteeStatus(
    data.members.map((m) => ({
      ...m,
      reelectionDueDate: computeReelectionDueDate(m.electionDate, data.termLengthYears),
    }))
  );

  if (!ruleResult.compliant && !req.body.overrideJustification) {
    return res.status(422).json({
      error: "1/3 gender rotation rule violation — submission blocked",
      detail: ruleResult,
      hint: "A Director may resubmit with 'overrideJustification' to log an override.",
    });
  }

  const committee = await prisma.committee.create({
    data: {
      cooperativeId: req.params.id,
      committeeType: data.committeeType,
      termLengthYears: data.termLengthYears,
      status,
      complianceOverride: !ruleResult.compliant,
      overrideJustification: !ruleResult.compliant ? req.body.overrideJustification : null,
      members: {
        create: data.members.map((m) => ({
          fullName: m.fullName,
          gender: m.gender,
          role: m.role,
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
    metadata: { ruleResult, overridden: !ruleResult.compliant },
  });

  res.status(201).json({ committee, complianceCheck: ruleResult });
}

async function listCommittees(req, res) {
  const committees = await prisma.committee.findMany({
    where: { cooperativeId: req.params.id },
    include: { members: true, signatories: true },
    orderBy: { createdAt: "desc" },
  });

  // Refresh derived status live (term expiry is time-dependent).
  const enriched = committees.map((c) => ({
    ...c,
    status: deriveCommitteeStatus(c.members),
  }));

  res.json(enriched);
}

// Director-only override endpoint for a previously blocked composition.
async function overrideCommittee(req, res) {
  const { justification } = overrideSchema.parse(req.body);

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

// --- Election candidates ---

const candidateSchema = z.object({
  fullName: z.string().min(1),
  gender: z.enum(["MALE", "FEMALE"]),
  roleAppliedFor: committeeMemberSchema.shape.role,
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
  attachAGMFiles,
  saveCommittee,
  listCommittees,
  overrideCommittee,
  addSignatory,
  applyCandidate,
  listCandidates,
  updateCandidateStatus,
  recordAGM,
  listAGMs,
};
