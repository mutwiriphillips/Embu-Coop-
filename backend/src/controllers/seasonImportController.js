const multer = require("multer");
const prisma = require("../config/db");
const { recordAudit } = require("../utils/audit");
const { areaScope, httpError, norm } = require("../utils/geography");
const { VALUE_CHAINS } = require("../utils/societyType");
const { parseCsv, parseXlsx, mapHeaders, parsePrice, cleanName, keyOf, sortedKeyOf, csvCell } = require("../utils/seasonImport");
const { runBulk, validCropYear } = require("./seasonRateController");

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 1024 * 1024, files: 1 } }).single("file");
const MAX_ROWS = 1000;

// GET /api/season-rates/template?valueChain=&cropYear=&countyId=
// A CSV of the societies in the caller's area with what is already recorded; fill it in
// (or replace it with the county's own list) and upload it back.
async function template(req, res) {
  const valueChain = String(req.query.valueChain || "COFFEE").toUpperCase();
  if (!VALUE_CHAINS.includes(valueChain)) throw httpError(400, "Unknown value chain");
  const cropYear = String(req.query.cropYear || "");
  if (!validCropYear(cropYear)) throw httpError(400, "Crop year looks like 2025/2026");
  const scope = areaScope(req.user);
  const countyId = scope.countyId || req.query.countyId || undefined;

  const coops = await prisma.cooperative.findMany({ where: { valueChain, ...(countyId ? { countyId } : {}) } });
  const ids = coops.map((c) => c.id);
  const recs = ids.length ? await prisma.cropSeasonRecord.findMany({ where: { cooperativeId: { in: ids }, cropYear } }) : [];
  const rounds = recs.length ? await prisma.cropSeasonRound.findMany({ where: { recordId: { in: recs.map((r) => r.id) } } }) : [];
  const facIds = [...new Set(recs.map((r) => r.factoryId).filter(Boolean))];
  const facs = facIds.length ? await prisma.factory.findMany({ where: { id: { in: facIds } } }) : [];
  const facName = new Map(facs.map((f) => [f.id, f.name]));
  const recBy = new Map(recs.map((r) => [r.cooperativeId, r]));
  const n = Math.max(2, ...rounds.map((r) => r.roundNo));

  coops.sort((a, b) => String(a.subCounty).localeCompare(String(b.subCounty)) || a.name.localeCompare(b.name));
  const head = ["Sub-County", "Ward", "Society's Name", "Factory", ...Array.from({ length: n }, (_, i) => `Av. payment (${i + 1})`)];
  const lines = [head.map(csvCell).join(",")];
  for (const c of coops) {
    const rec = recBy.get(c.id);
    const cells = [c.subCounty, c.ward, c.name, rec?.factoryId ? facName.get(rec.factoryId) || "" : ""];
    for (let i = 1; i <= n; i++) { const r = rec && rounds.find((x) => x.recordId === rec.id && x.roundNo === i); cells.push(r ? Number(r.avgPrice).toFixed(2) : "Not yet"); }
    lines.push(cells.map(csvCell).join(","));
  }
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="season-rates-${valueChain.toLowerCase()}-${cropYear.replace("/", "-")}.csv"`);
  res.setHeader("Cache-Control", "no-store");
  res.send("﻿" + lines.join("\r\n") + "\r\n");
}

// POST /api/season-rates/import  (multipart: file, valueChain, cropYear, countyId?, preview?, skipUnknown?)
// Matches each line to a registered society by name (numbering and "F.C.S"/"FCS" are ignored),
// then saves like the screen does. "Not yet" and empty cells change nothing, so an upload
// never erases a price. Nothing is saved if any line has a problem, unless skipUnknown is set.
async function importFile(req, res) {
  await new Promise((resolve, reject) => upload(req, res, (e) => (e ? reject(e) : resolve())));
  if (!req.file) throw httpError(400, "Choose the CSV (or Excel) file to upload");
  const valueChain = String(req.body.valueChain || "").toUpperCase();
  if (!VALUE_CHAINS.includes(valueChain)) throw httpError(400, "Choose the value chain first");
  const cropYear = String(req.body.cropYear || "").trim();
  if (!validCropYear(cropYear)) throw httpError(400, "Crop year looks like 2025/2026");
  const preview = req.body.preview === "true" || req.body.preview === true;
  const skipUnknown = req.body.skipUnknown === "true" || req.body.skipUnknown === true;

  const buf = req.file.buffer;
  let table;
  try {
    table = buf.length > 3 && buf[0] === 0x50 && buf[1] === 0x4b ? await parseXlsx(buf) : parseCsv(buf.toString("utf8"));
  } catch { throw httpError(400, "That file couldn't be read. Save it as CSV or .xlsx and try again"); }
  if (table.rows.length < 2) throw httpError(400, "The file has no data rows");
  if (table.rows.length > MAX_ROWS + 1) throw httpError(400, `At most ${MAX_ROWS} rows per upload`);
  let cols;
  try { cols = mapHeaders(table.rows[0]); } catch (e) { throw httpError(400, e.message); }
  const decimalComma = table.delimiter === ";";

  const scope = areaScope(req.user);
  const countyId = scope.countyId || req.body.countyId || undefined;
  const coops = await prisma.cooperative.findMany({ where: { valueChain, ...(countyId ? { countyId } : {}) } });
  const byKey = new Map(), bySorted = new Map();
  for (const c of coops) {
    const k = keyOf(c.name), s = sortedKeyOf(c.name);
    byKey.set(k, [...(byKey.get(k) || []), c]); bySorted.set(s, [...(bySorted.get(s) || []), c]);
  }
  const countyIds = [...new Set(coops.map((c) => c.countyId))];
  const factories = countyIds.length ? await prisma.factory.findMany({ where: { countyId: { in: countyIds } } }) : [];
  const facBy = new Map(factories.map((f) => [f.countyId + "|" + norm(f.name), f]));

  const problems = [], unmatched = [], rows = [], seen = new Map(), newFactoryNames = new Map();
  for (let i = 1; i < table.rows.length; i++) {
    const line = table.rows[i], rowNo = i + 1;
    const rawName = String(line[cols.society] || "").trim();
    const name = cleanName(rawName);
    if (!name) continue;
    let hits = byKey.get(keyOf(name)) || [];
    if (hits.length === 0) hits = bySorted.get(sortedKeyOf(name)) || [];
    if (hits.length > 1 && cols.subCounty >= 0) {
      const sc = norm(line[cols.subCounty]);
      const narrowed = hits.filter((c) => norm(c.subCounty) === sc);
      if (narrowed.length) hits = narrowed;
    }
    if (hits.length === 0) { unmatched.push(name); if (!skipUnknown) problems.push({ row: rowNo, message: `"${name}" is not a registered ${valueChain.toLowerCase()} society in your area` }); continue; }
    if (hits.length > 1) { problems.push({ row: rowNo, message: `"${name}" matches more than one society (${hits.map((h) => h.subCounty + "/" + h.name).join(", ")}); add the Sub-County column` }); continue; }
    const coop = hits[0];
    if (seen.has(coop.id)) { problems.push({ row: rowNo, message: `${coop.name} is listed twice (also row ${seen.get(coop.id)})` }); continue; }
    seen.set(coop.id, rowNo);

    const rr = [];
    for (const [no, idx] of Object.entries(cols.rounds)) {
      const p = parsePrice(line[idx], decimalComma);
      if (p === null) continue;
      if (Number.isNaN(p)) { problems.push({ row: rowNo, message: `${coop.name}: "${String(line[idx]).trim()}" is not a valid price for payment (${no})` }); continue; }
      rr.push({ roundNo: Number(no), avgPrice: p });
    }
    const row = { cooperativeId: coop.id, rounds: rr, _factoryName: null };
    const fname = cols.factory >= 0 ? String(line[cols.factory] || "").trim() : "";
    if (fname && !["notyet", "na", "-"].includes(norm(fname))) {
      if (fname.length < 2 || fname.length > 120) problems.push({ row: rowNo, message: `${coop.name}: the factory name must be 2 to 120 characters` });
      else {
        const f = facBy.get(coop.countyId + "|" + norm(fname));
        if (f) row.factoryId = f.id; else { row._factoryName = fname; newFactoryNames.set(coop.countyId + "|" + norm(fname), { name: fname, countyId: coop.countyId }); }
      }
    }
    rows.push(row);
  }
  if (rows.length === 0 && problems.length === 0) throw httpError(400, "No societies were found in the file");
  if (problems.length) return res.status(preview ? 200 : 422).json({ preview, ok: false, error: "Nothing was saved. Fix these lines and upload again.", problems: problems.slice(0, 100), unmatched, matched: rows.length });

  const base = { valueChain, cropYear, rows: rows.map(({ _factoryName, ...r }) => r), viaFile: true };
  const dry = await runBulk(req.user, base, { dryRun: true });
  if (dry.problems) return res.status(preview ? 200 : 422).json({ preview, ok: false, error: "Nothing was saved. " + dry.problems.slice(0, 3).join("; "), problems: dry.problems.map((m) => ({ message: m })), unmatched, matched: rows.length });
  const report = { preview, ok: true, matched: rows.length, unmatched, skipped: unmatched.length, newFactories: [...newFactoryNames.values()].map((f) => f.name), changes: dry.stats };
  if (preview) return res.json(report);

  // Create the factories that did not exist yet, then save for real.
  let created = 0;
  for (const f of newFactoryNames.values()) {
    const made = await prisma.factory.create({ data: { name: f.name, countyId: f.countyId, valueChain: valueChain === "OTHER" ? null : valueChain } });
    facBy.set(f.countyId + "|" + norm(f.name), made); created++;
  }
  const final = { ...base, rows: rows.map(({ _factoryName, ...r }) => {
    if (_factoryName) { const coop = coops.find((c) => c.id === r.cooperativeId); r.factoryId = facBy.get(coop.countyId + "|" + norm(_factoryName)).id; }
    return r;
  }) };
  const out = await runBulk(req.user, final);
  if (out.problems) throw httpError(422, "Nothing was saved. " + out.problems.slice(0, 3).join("; "));
  res.json({ ...report, preview: false, factoriesCreated: created, changes: out.stats });
}

module.exports = { template, importFile };
