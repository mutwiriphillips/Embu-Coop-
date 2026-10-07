const { z } = require("zod");
const prisma = require("../config/db");
const { recordAudit } = require("../utils/audit");
const { saveFile, toStorageKey, fileIdFromKey } = require("../utils/fileStorage");
const { httpError } = require("../utils/geography");
const { assertBelongs } = require("../utils/ownership");

// File type and size rules live in utils/fileStorage.js (documents: PDF or a
// photo of the paper, up to 10 MB).

const uploadSchema = z.object({
  docType: z.enum([
    "REGISTRATION_CERTIFICATE",
    "BY_LAWS",
    "MEETING_MINUTES",
    "CODE_OF_CONDUCT",
    "AUDIT_REPORT",
    "SPOT_CHECK_REPORT",
    "OTHER",
  ]),
  title: z.string().trim().min(1, "Give the document a title"),
});

// Rejecting a filing without saying why leaves the cooperative guessing.
const decisionSchema = z
  .object({ approve: z.boolean(), note: z.string().trim().optional() })
  .refine((d) => d.approve || (d.note && d.note.length >= 3), { message: "Say why it is being rejected (at least 3 characters)", path: ["note"] });

// Staff who may delete a document. Once a Director has approved it, only a
// Director (or the National Admin) may remove it.
const APPROVER_ROLES = ["NATIONAL_ADMIN", "DIRECTOR"];

// GET /cooperatives/:id/documents?status=PENDING
async function listDocuments(req, res) {
  const { status } = req.query;
  const documents = await prisma.document.findMany({
    where: {
      cooperativeId: req.params.id,
      ...(status ? { status } : {}),
    },
    include: {
      uploadedBy: { select: { id: true, fullName: true } },
      reviewedBy: { select: { id: true, fullName: true } },
      approvedBy: { select: { id: true, fullName: true } },
    },
    orderBy: { createdAt: "desc" },
  });
  // fileId lets the screen open the actual file through GET /api/files/:id.
  // Documents recorded before real uploads existed have no file (fileId null).
  res.json(documents.map((d) => ({ ...d, fileId: fileIdFromKey(d.storageKey) })));
}

// Any authenticated cooperative manager / field staff can upload; enters PENDING quarantine.
async function uploadDocument(req, res) {
  const data = uploadSchema.parse(req.body);
  // A document now always carries the real file (multipart field "file").
  // Previously only a title and a storage-key string were saved and no file
  // was ever kept.
  if (!req.file) throw httpError(400, "Attach the document: a PDF or a clear photo of it");
  const coop = req.cooperative;
  // A society has one registration certificate. A second is only accepted if
  // the earlier one was rejected, so the file can't fill up with duplicates.
  if (data.docType === "REGISTRATION_CERTIFICATE") {
    const onFile = await prisma.document.findFirst({
      where: { cooperativeId: coop.id, docType: "REGISTRATION_CERTIFICATE", status: { in: ["PENDING", "REVIEWED", "APPROVED"] } },
    });
    if (onFile) {
      throw httpError(409, `A registration certificate is already on file ("${onFile.title}", ${onFile.status.toLowerCase()}). Delete it first if it was uploaded by mistake, or wait for it to be rejected before uploading a replacement.`);
    }
  }
  const saved = await saveFile({
    file: req.file,
    purpose: "DOCUMENT",
    scope: { countyId: coop.countyId, cooperativeId: coop.id },
    uploadedByUserId: req.user.id,
  });

  const document = await prisma.document.create({
    data: {
      ...data,
      storageKey: toStorageKey(saved.id),
      fileSizeBytes: saved.sizeBytes,
      cooperativeId: req.params.id,
      uploadedById: req.user.id,
      status: "PENDING",
    },
  });

  await recordAudit({
    userId: req.user.id,
    action: "UPLOAD_DOCUMENT",
    entityType: "Document",
    entityId: document.id,
  });

  res.status(201).json({ ...document, fileId: saved.id, file: saved });
}

// Tier 1: Sub-county officer reviews (PENDING -> REVIEWED or REJECTED)
async function reviewDocument(req, res) {
  const { approve, note } = decisionSchema.parse(req.body);

  const doc = await prisma.document.findUnique({ where: { id: req.params.docId } });
  assertBelongs(doc, req.params.id, "Document");
  if (doc.status !== "PENDING") {
    return res.status(409).json({ error: `Document must be PENDING to review (current: ${doc.status})` });
  }

  const updated = await prisma.document.update({
    where: { id: req.params.docId },
    data: {
      status: approve ? "REVIEWED" : "REJECTED",
      reviewedById: req.user.id,
      reviewedAt: new Date(),
      rejectionNote: approve ? null : note,
    },
  });

  await recordAudit({
    userId: req.user.id,
    action: approve ? "REVIEW_DOCUMENT_APPROVE" : "REVIEW_DOCUMENT_REJECT",
    entityType: "Document",
    entityId: updated.id,
  });

  res.json(updated);
}

// Tier 2: Director sign-off (REVIEWED -> APPROVED or REJECTED)
async function approveDocument(req, res) {
  const { approve, note } = decisionSchema.parse(req.body);

  const doc = await prisma.document.findUnique({ where: { id: req.params.docId } });
  assertBelongs(doc, req.params.id, "Document");
  if (doc.status !== "REVIEWED") {
    return res.status(409).json({ error: `Document must be REVIEWED before Director sign-off (current: ${doc.status})` });
  }

  const updated = await prisma.document.update({
    where: { id: req.params.docId },
    data: {
      status: approve ? "APPROVED" : "REJECTED",
      approvedById: req.user.id,
      approvedAt: new Date(),
      rejectionNote: approve ? null : note,
    },
  });

  await recordAudit({
    userId: req.user.id,
    action: approve ? "APPROVE_DOCUMENT" : "REJECT_DOCUMENT",
    entityType: "Document",
    entityId: updated.id,
  });

  res.json(updated);
}

async function deleteDocument(req, res) {
  const doc = await prisma.document.findUnique({ where: { id: req.params.docId } });
  assertBelongs(doc, req.params.id, "Document");
  if (doc.status === "APPROVED" && !APPROVER_ROLES.includes(req.user.role)) {
    throw httpError(403, "This document has been approved by the Director. Only a Director can delete it.");
  }
  await prisma.document.delete({ where: { id: doc.id } });
  // Remove the stored file too: leaving the bytes behind would keep a deleted
  // document (often an ID-bearing paper) in the database with no record of it.
  const fileId = fileIdFromKey(doc.storageKey);
  if (fileId) await prisma.storedFile.deleteMany({ where: { id: fileId, cooperativeId: doc.cooperativeId } });
  await recordAudit({
    userId: req.user.id,
    action: "DELETE_DOCUMENT",
    entityType: "Document",
    entityId: doc.id,
    metadata: { docType: doc.docType, title: doc.title, status: doc.status },
  });
  res.status(204).send();
}

module.exports = { listDocuments, uploadDocument, reviewDocument, approveDocument, deleteDocument };
