const prisma = require("../config/db");
const { computeCreditAssessment } = require("../utils/creditScore");
const { deriveCommitteeStatus } = require("../utils/governance");
const { recordAudit } = require("../utils/audit");

// Gathers everything the scoring engine needs for one cooperative, refreshing
// each committee's derived status the same way governanceController does —
// so a stale stored status never silently skews the score.
async function gatherAssessmentInputs(cooperativeId) {
  const [members, contributions, produceDeliveries, documents, committeesRaw] = await Promise.all([
    prisma.member.findMany({ where: { cooperativeId }, select: { id: true, createdAt: true } }),
    prisma.contribution.findMany({
      where: { cooperativeId },
      select: { memberId: true, amount: true, type: true, contributionDate: true },
    }),
    prisma.produceDelivery.findMany({
      where: { cooperativeId },
      select: { memberId: true, quantity: true, deliveryDate: true },
    }),
    prisma.document.findMany({ where: { cooperativeId }, select: { docType: true, status: true } }),
    prisma.committee.findMany({
      where: { cooperativeId },
      include: { members: true },
    }),
  ]);

  const committees = committeesRaw.map((c) => ({
    committeeType: c.committeeType,
    status: deriveCommitteeStatus(c.members),
    complianceOverride: c.complianceOverride,
  }));

  return { members, contributions, produceDeliveries, documents, committees };
}

// POST /cooperatives/:id/credit-assessment — runs a fresh assessment and
// stores it (so it can be retrieved/exported later even as underlying data
// changes). Restricted to roles that can vouch for the cooperative's
// standing — not self-servable by the cooperative's own manager.
async function runAssessment(req, res) {
  const cooperative = await prisma.cooperative.findUniqueOrThrow({ where: { id: req.params.id } });
  const inputs = await gatherAssessmentInputs(cooperative.id);
  const result = computeCreditAssessment(inputs);

  const assessment = await prisma.creditAssessment.create({
    data: {
      cooperativeId: cooperative.id,
      score: result.score,
      band: result.band,
      breakdown: result,
      computedById: req.user.id,
    },
  });

  await recordAudit({
    userId: req.user.id,
    action: "RUN_CREDIT_ASSESSMENT",
    entityType: "CreditAssessment",
    entityId: assessment.id,
    metadata: { cooperativeId: cooperative.id, score: result.score, band: result.band },
  });

  res.status(201).json(assessment);
}

// GET /cooperatives/:id/credit-assessment — latest assessment, or null if
// none has ever been run.
async function getLatestAssessment(req, res) {
  const assessment = await prisma.creditAssessment.findFirst({
    where: { cooperativeId: req.params.id },
    orderBy: { createdAt: "desc" },
    include: { computedBy: { select: { id: true, fullName: true } } },
  });
  res.json(assessment);
}

// GET /cooperatives/:id/credit-assessment/history — full history, for
// showing a trend line to a lender (is this cooperative improving?).
async function getAssessmentHistory(req, res) {
  const assessments = await prisma.creditAssessment.findMany({
    where: { cooperativeId: req.params.id },
    orderBy: { createdAt: "desc" },
    select: { id: true, score: true, band: true, createdAt: true },
  });
  res.json(assessments);
}

module.exports = { runAssessment, getLatestAssessment, getAssessmentHistory };
