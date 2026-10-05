const crypto = require("crypto");
const multer = require("multer");
const prisma = require("../config/db");
const { httpError } = require("./geography");

// Files are kept in memory only while a request is processed, then written to
// PostgreSQL (StoredFile.data). Render's web-service disk is wiped on every
// deploy, so writing uploads to local disk would silently lose them.
const MAX_FILE_BYTES = 10 * 1024 * 1024; // hard ceiling for any single file

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_BYTES, files: 6 },
});

// The file type is decided by the file's first bytes, never by its name or
// the Content-Type the browser sends, so a renamed executable or script
// can't be smuggled in as a "photo".
function sniff(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf.slice(0, 4).toString("latin1") === "%PDF") return { kind: "pdf", mime: "application/pdf", ext: "pdf" };
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { kind: "image", mime: "image/jpeg", ext: "jpg" };
  if (buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { kind: "image", mime: "image/png", ext: "png" };
  if (buf.slice(0, 4).toString("latin1") === "RIFF" && buf.slice(8, 12).toString("latin1") === "WEBP") return { kind: "image", mime: "image/webp", ext: "webp" };
  return null;
}

// What each kind of upload accepts. Documents may be a PDF or a clear photo of
// the paper (common where scanners aren't available); photos must be images.
const RULES = {
  DOCUMENT:           { kinds: ["pdf", "image"], maxBytes: 10 * 1024 * 1024, label: "a PDF or a photo (JPG, PNG, WEBP)" },
  AGM_NOTICE:         { kinds: ["pdf", "image"], maxBytes: 10 * 1024 * 1024, label: "a PDF or a photo (JPG, PNG, WEBP)" },
  AGM_MINUTES:        { kinds: ["pdf", "image"], maxBytes: 10 * 1024 * 1024, label: "a PDF or a photo (JPG, PNG, WEBP)" },
  AGROVET_PERMIT:     { kinds: ["pdf", "image"], maxBytes: 10 * 1024 * 1024, label: "a PDF or a photo (JPG, PNG, WEBP)" },
  AGROVET_SHOP_PHOTO: { kinds: ["image"], maxBytes: 5 * 1024 * 1024, label: "a photo (JPG, PNG, WEBP)" },
  ASSET_PHOTO:        { kinds: ["image"], maxBytes: 5 * 1024 * 1024, label: "a photo (JPG, PNG, WEBP)" },
  VISIT_PHOTO:        { kinds: ["image"], maxBytes: 5 * 1024 * 1024, label: "a photo (JPG, PNG, WEBP)" },
};

function cleanName(name, ext) {
  const base = String(name || "file").replace(/\.[^.]+$/, "").replace(/[^a-zA-Z0-9 _.-]/g, "").trim().slice(0, 80) || "file";
  return `${base}.${ext}`;
}

// Check a file against its rule without storing it, so a multi-step create
// (e.g. a shop application with photos) can reject bad files before writing
// anything at all.
function assertValidFile(file, purpose) {
  const rule = RULES[purpose];
  if (!file) return;
  const type = sniff(file.buffer);
  if (!type || !rule.kinds.includes(type.kind)) throw httpError(400, `"${file.originalname}" isn't accepted here. Upload ${rule.label}.`);
  if (file.size > rule.maxBytes) throw httpError(400, `"${file.originalname}" is ${(file.size / 1048576).toFixed(1)} MB; the limit is ${rule.maxBytes / 1048576} MB.`);
}

/**
 * Validate and store one uploaded file. `scope` records what it belongs to
 * (county, cooperative, agrovet shop, asset, visit), which is what the
 * download endpoint later checks before handing it to anyone.
 */
async function saveFile({ file, purpose, scope = {}, uploadedByUserId, uploadedByAgrovetId }) {
  const rule = RULES[purpose];
  if (!rule) throw httpError(400, "Unknown upload type");
  if (!file || !file.buffer) throw httpError(400, "No file was attached");
  const type = sniff(file.buffer);
  if (!type || !rule.kinds.includes(type.kind)) {
    throw httpError(400, `"${file.originalname}" isn't accepted here. Upload ${rule.label}.`);
  }
  if (file.size > rule.maxBytes) {
    throw httpError(400, `"${file.originalname}" is ${(file.size / 1048576).toFixed(1)} MB; the limit is ${rule.maxBytes / 1048576} MB.`);
  }
  const stored = await prisma.storedFile.create({
    data: {
      purpose,
      fileName: cleanName(file.originalname, type.ext),
      mimeType: type.mime,
      sizeBytes: file.size,
      sha256: crypto.createHash("sha256").update(file.buffer).digest("hex"),
      data: file.buffer,
      countyId: scope.countyId || null,
      cooperativeId: scope.cooperativeId || null,
      agrovetShopId: scope.agrovetShopId || null,
      assetId: scope.assetId || null,
      visitId: scope.visitId || null,
      uploadedByUserId: uploadedByUserId || null,
      uploadedByAgrovetId: uploadedByAgrovetId || null,
    },
  });
  return publicFile(stored);
}

// Metadata only. The bytes are only ever served by GET /api/files/:id.
function publicFile(f) {
  return { id: f.id, purpose: f.purpose, fileName: f.fileName, mimeType: f.mimeType, sizeBytes: f.sizeBytes, createdAt: f.createdAt };
}

// Documents and AGM records keep their existing storageKey columns; a stored
// file is referenced as "file:<id>".
const toStorageKey = (fileId) => `file:${fileId}`;
const fileIdFromKey = (key) => (typeof key === "string" && key.startsWith("file:") ? key.slice(5) : null);

const FILE_LIST_SELECT = { id: true, purpose: true, fileName: true, mimeType: true, sizeBytes: true, createdAt: true };

module.exports = { upload, saveFile, assertValidFile, publicFile, sniff, RULES, toStorageKey, fileIdFromKey, FILE_LIST_SELECT };
