const multer = require("multer");
const prisma = require("../config/db");
const { recordAudit } = require("../utils/audit");
const { areaScope, httpError, norm } = require("../utils/geography");
const { VALUE_CHAINS } = require("../utils/societyType");
const { parseCsv, parseXlsx, cleanName, keyOf, sortedKeyOf, strip } = require("../utils/seasonImport");

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 1024 * 1024, files: 1 } }).single("file");
const MAX_ROWS = 2000;

/** "kathakwa " -> "Kathakwa", "New kapingazi" -> "New Kapingazi" */
const tidy = (s) => String(s || "").replace(/\s+/g, " ").trim().replace(/(^|[\s\-/(])([a-z])/g, (_, a, b) => a + b.toUpperCase());

function distance(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}

/** Closest registered society for a name that matched nothing: one that contains it ("C.Ngandori" -> "Central Ngandori"), else a near spelling ("Nembure" -> "Nembute"). */
function suggest(name, coops) {
  const k = keyOf(name);
  const inside = coops.filter((c) => k.length >= 5 && keyOf(c.name).includes(k));
  if (inside.length === 1) return inside[0];
  const best = coops.map((c) => ({ c, d: distance(k, keyOf(c.name)) })).sort((a, b) => a.d - b.d);
  const ties = best.filter((b) => b.d === (best[0] && best[0].d));
  return best[0] && ties.length === 1 && best[0].d <= Math.max(1, Math.floor(k.length * 0.25)) ? best[0].c : null;
}

/** Finds the heading row (it may sit under a title line) and the columns. */
function findColumns(rows) {
  for (let i = 0; i < Math.min(rows.length, 8); i++) {
    const cells = rows[i].map((c) => strip(c));
    const society = cells.findIndex((c) => /(cooperative|society|fcs)/.test(c) && !c.includes("factory"));
    const factory = cells.findIndex((c) => /(factory|mill)/.test(c));
    if (society >= 0 && factory >= 0 && society !== factory) {
      return { header: i, society, factory, subCounty: cells.findIndex((c) => c.includes("subcounty")), zone: cells.findIndex((c) => /(zone|location)/.test(c)) };
    }
  }
  throw httpError(400, "I couldn't find the headings. The sheet needs a COOPERATIVE column and a FACTORY column (SUBCOUNTY and ZONE are optional).");
}

// POST /api/factories/import  (multipart: file, valueChain?, countyId?, preview?, skipUnknown?)
// Reads a "cooperative -> its factories" sheet. A blank cooperative cell means "same cooperative as the row above".
// It only ever creates factories and links them to societies; nothing is removed or overwritten.
async function importFile(req, res) {
  await new Promise((resolve, reject) => upload(req, res, (e) => (e ? reject(e) : resolve())));
  if (!req.file) throw httpError(400, "Choose the Excel (or CSV) file to upload");
  const valueChain = String(req.body.valueChain || "COFFEE").toUpperCase();
  if (!VALUE_CHAINS.includes(valueChain)) throw httpError(400, "Unknown value chain");
  const preview = req.body.preview === "true" || req.body.preview === true;
  const skipUnknown = req.body.skipUnknown === "true" || req.body.skipUnknown === true;
  const useSuggested = req.body.useSuggested === "true" || req.body.useSuggested === true;

  const buf = req.file.buffer;
  let table;
  try { table = buf.length > 3 && buf[0] === 0x50 && buf[1] === 0x4b ? await parseXlsx(buf) : parseCsv(buf.toString("utf8")); }
  catch { throw httpError(400, "That file couldn't be read. Save it as .xlsx or CSV and try again"); }
  if (table.rows.length > MAX_ROWS) throw httpError(400, `At most ${MAX_ROWS} rows per upload`);
  const cols = findColumns(table.rows);

  const scope = areaScope(req.user);
  const countyId = scope.countyId || req.body.countyId || undefined;
  if (!countyId) throw httpError(400, "Choose the county first");
  const coops = await prisma.cooperative.findMany({ where: { valueChain, countyId } });
  const byKey = new Map(), bySorted = new Map();
  for (const c of coops) {
    const k = keyOf(c.name), s = sortedKeyOf(c.name);
    byKey.set(k, [...(byKey.get(k) || []), c]); bySorted.set(s, [...(bySorted.get(s) || []), c]);
  }
  const factories = await prisma.factory.findMany({ where: { countyId } });
  const facBy = new Map(factories.map((f) => [norm(f.name), f]));
  const links = await prisma.cooperativeFactory.findMany({ where: { cooperativeId: { in: coops.map((c) => c.id) } } });
  const linked = new Set(links.map((l) => l.cooperativeId + "|" + l.factoryId));

  const problems = [], unmatched = new Map(), plan = new Map(); // coopId -> { coop, factories: Map(norm -> {name, zone}) }
  const notes = [];
  let current = null; // the cooperative the rows below belong to
  for (let i = cols.header + 1; i < table.rows.length; i++) {
    const line = table.rows[i], rowNo = i + 1;
    const rawCoop = String(line[cols.society] || "").trim();
    const fac = tidy(line[cols.factory]);
    if (rawCoop) {
      const name = cleanName(rawCoop);
      let hits = byKey.get(keyOf(name)) || [];
      if (hits.length === 0) hits = bySorted.get(sortedKeyOf(name)) || [];
      if (hits.length > 1 && cols.subCounty >= 0) {
        const sc = norm(line[cols.subCounty]);
        const narrowed = hits.filter((c) => norm(c.subCounty) === sc);
        if (narrowed.length) hits = narrowed;
      }
      const guess = hits.length === 0 ? suggest(name, coops) : null;
      if (guess && useSuggested) { hits = [guess]; notes.push(`"${tidy(name)}" was matched to ${guess.name}`); }
      if (hits.length === 0) {
        current = { unknown: tidy(name) };
        if (!unmatched.has(current.unknown)) unmatched.set(current.unknown, { name: current.unknown, row: rowNo, suggestion: guess ? guess.name : null, factories: [] });
      } else if (hits.length > 1) { problems.push({ row: rowNo, message: `"${name}" matches more than one society (${hits.map((h) => h.name).join(", ")})` }); current = null; continue; }
      else {
        current = { coop: hits[0] };
        if (!plan.has(hits[0].id)) plan.set(hits[0].id, { coop: hits[0], factories: new Map() });
      }
    }
    if (!fac) continue;
    if (!current) { problems.push({ row: rowNo, message: `"${fac}" has no cooperative above it` }); continue; }
    if (fac.length < 2 || fac.length > 120) { problems.push({ row: rowNo, message: `Factory name "${fac}" must be 2 to 120 characters` }); continue; }
    if (current.unknown) { unmatched.get(current.unknown).factories.push(fac); continue; }
    const zone = cols.zone >= 0 ? tidy(line[cols.zone]) : "";
    const entry = plan.get(current.coop.id);
    if (entry.factories.has(norm(fac))) { notes.push(`${current.coop.name}: "${fac}" is listed twice (row ${rowNo}); counted once`); continue; }
    entry.factories.set(norm(fac), { name: fac, zone });
  }
  if (!skipUnknown) for (const u of unmatched.values()) problems.push({ row: u.row, message: `"${u.name}" is not a registered ${valueChain.toLowerCase()} society in this county${u.suggestion ? ` (did you mean "${u.suggestion}"?)` : ""}` });
  if (plan.size === 0 && problems.length === 0) throw httpError(400, "No societies were found in the file");
  if (problems.length) return res.status(preview ? 200 : 422).json({ preview, ok: false, error: "Nothing was saved. Fix these lines and upload again, or tick \"Skip societies I haven't registered\".", problems: problems.slice(0, 100), unmatched: [...unmatched.values()] });

  // What would change
  const newFactories = new Map(), newLinks = [], already = [];
  for (const { coop, factories: fs } of plan.values()) {
    for (const [k, f] of fs) {
      const existing = facBy.get(k);
      if (!existing && !newFactories.has(k)) newFactories.set(k, f);
      if (existing && linked.has(coop.id + "|" + existing.id)) already.push(`${coop.name} / ${f.name}`);
      else newLinks.push({ coop, key: k, name: f.name });
    }
  }
  const sheetKeys = new Set([...plan.values()].flatMap((p) => [...p.factories.keys()]));
  const sharedFactories = [...sheetKeys].filter((k) => [...plan.values()].filter((p) => p.factories.has(k)).length > 1).map((k) => [...plan.values()].find((p) => p.factories.has(k)).factories.get(k).name);
  const report = {
    preview, ok: true, societies: plan.size, factoriesInSheet: sheetKeys.size,
    newFactories: [...newFactories.values()].map((f) => f.name), linksToCreate: newLinks.length, alreadyLinked: already.length,
    unmatched: [...unmatched.values()], skipped: unmatched.size, notes, sharedFactories,
    preview_rows: [...plan.values()].map((p) => ({ society: p.coop.name, factories: [...p.factories.values()].map((f) => f.name) })),
  };
  if (preview) return res.json(report);

  let createdFactories = 0, createdLinks = 0, zonesSet = 0;
  for (const [k, f] of newFactories) {
    const made = await prisma.factory.create({ data: { name: f.name, countyId, valueChain: valueChain === "OTHER" ? null : valueChain, location: f.zone || null } });
    facBy.set(k, made); createdFactories++;
  }
  for (const l of newLinks) {
    const fac = facBy.get(l.key);
    await prisma.cooperativeFactory.create({ data: { cooperativeId: l.coop.id, factoryId: fac.id } }); createdLinks++;
  }
  // an existing factory with no zone yet gets the sheet's zone; a zone already recorded is never overwritten
  for (const { factories: fs } of plan.values()) for (const [k, f] of fs) {
    const fac = facBy.get(k);
    if (fac && !fac.location && f.zone && !newFactories.has(k)) { await prisma.factory.update({ where: { id: fac.id }, data: { location: f.zone } }); fac.location = f.zone; zonesSet++; }
  }
  await recordAudit({ userId: req.user.id, action: "FACTORIES_IMPORTED", entityType: "Factory", entityId: countyId, metadata: { createdFactories, createdLinks, societies: plan.size } });
  res.json({ ...report, preview: false, createdFactories, createdLinks, zonesSet });
}

module.exports = { importFile };
