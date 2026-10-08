const prisma = require("../config/db");
const { recordAudit } = require("../utils/audit");
const { httpError } = require("../utils/geography");
const { assertValidFile } = require("../utils/fileStorage");
const { extractPdfLines } = require("../utils/pdfText");
const { parseNameList } = require("../utils/nameListParser");

const KINDS = { MEMBERS: "cooperatives", COMMITTEE: "governance", BOARD: "governance" };
const MAX_ROWS = 2000;

function canEdit(user, module) {
  if (user.role === "NATIONAL_ADMIN" || user.role === "DIRECTOR") return true;
  const p = (user.permissions || []).find((x) => x.module === module);
  return !!(p && p.canEdit);
}

/**
 * POST /cooperatives/:id/imports/parse   (multipart: file, kind)
 *
 * Reads a typed PDF and PROPOSES a list of people. Nothing is saved: the
 * browser shows the proposal in an editable table, the user fixes whatever was
 * misread, and only then are records created through the normal endpoints
 * (which validate again). The PDF is stored afterwards, as a supporting
 * document, by the same Documents upload used everywhere else.
 */
async function parseList(req, res) {
  const kind = String(req.body.kind || "").toUpperCase();
  if (!KINDS[kind]) throw httpError(400, "Choose what the list is: members, management committee or supervisory board");
  if (!canEdit(req.user, KINDS[kind])) throw httpError(403, `You don't have permission to edit ${KINDS[kind]}`);
  if (!req.file) throw httpError(400, "Attach the PDF");
  assertValidFile(req.file, "NAME_LIST_PDF");

  const { lines, pageCount, truncated } = await extractPdfLines(req.file.buffer);
  if (!lines.length) {
    throw httpError(422, "This PDF has no typed text. It looks like a scan or a photo saved as a PDF, which can't be read reliably. Upload a typed PDF (for example, one exported from Word or Excel), or add the names by hand and keep this file under Documents.");
  }
  const { rows, skipped } = parseNameList(lines, kind);
  if (!rows.length) {
    throw httpError(422, "No names with an ID, phone number or position were recognised in this PDF. Check that it is a list of people laid out as rows (for example name, ID number, phone, gender).");
  }

  let capped = false;
  let outRows = rows;
  if (rows.length > MAX_ROWS) { outRows = rows.slice(0, MAX_ROWS); capped = true; }

  if (kind === "MEMBERS") {
    const existing = await prisma.member.findMany({ where: { cooperativeId: req.params.id }, select: { nationalId: true } });
    const have = new Set(existing.map((m) => String(m.nationalId).toUpperCase()));
    for (const r of outRows) {
      if (r.nationalId && have.has(r.nationalId.toUpperCase())) {
        r.alreadyMember = true;
        r.warnings.push("Already a member of this cooperative");
      }
    }
  }

  await recordAudit({
    userId: req.user.id,
    action: "PARSE_NAME_LIST",
    entityType: "Cooperative",
    entityId: req.params.id,
    metadata: { kind, rows: outRows.length, pages: pageCount },
  });

  res.json({
    kind,
    pageCount,
    pagesRead: truncated ? 80 : pageCount,
    truncated,
    capped,
    rows: outRows,
    skipped: skipped.slice(0, 200),
  });
}

module.exports = { parseList };
