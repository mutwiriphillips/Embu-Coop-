/**
 * Full-database backup and restore, done through Prisma so it needs no
 * `pg_dump` and no database shell (Render's free plan has neither).
 *
 * File format: gzip-compressed JSON Lines.
 *   line 1      {"format":"embu-coop-backup","version":1,"createdAt":...,"models":{name:count}}
 *   other lines {"m":"<Model>","r":{...row...}}
 * Every table is included, uploaded files (StoredFile.data) too. Dates are
 * ISO strings, binary is {"$b64":"..."}, money is a string, so nothing is
 * rounded. The file contains password hashes and personal data: treat it like
 * the database itself (see RENDER_DEPLOYMENT.md, "Backups").
 *
 * Restore is NON-DESTRUCTIVE: it only inserts rows whose id/unique keys are
 * not already there (createMany + skipDuplicates). It never updates or deletes,
 * so running it twice, or on a database that already has some data, cannot
 * damage anything.
 */
const zlib = require("zlib");
const readline = require("readline");

const FORMAT = "embu-coop-backup";
const VERSION = 1;

const lowerFirst = (s) => s.charAt(0).toLowerCase() + s.slice(1);

/** Models from the Prisma datamodel, parents before children. */
function orderedModels(datamodel) {
  const byName = new Map(datamodel.models.map((m) => [m.name, m]));
  const deps = new Map();
  for (const m of datamodel.models) {
    const d = new Set();
    for (const f of m.fields) {
      if (f.kind === "object" && f.relationFromFields && f.relationFromFields.length && f.type !== m.name) {
        d.add(f.type);
      }
    }
    deps.set(m.name, d);
  }
  const out = [];
  const state = new Map(); // 1 = visiting, 2 = done
  const visit = (name, path) => {
    if (state.get(name) === 2) return;
    if (state.get(name) === 1) throw new Error("Circular relation between models: " + [...path, name].join(" -> "));
    state.set(name, 1);
    [...deps.get(name)].sort().forEach((p) => visit(p, [...path, name]));
    state.set(name, 2);
    out.push(byName.get(name));
  };
  [...byName.keys()].sort().forEach((n) => visit(n, []));
  return out;
}

const hasBytes = (model) => model.fields.some((f) => f.type === "Bytes");
const selfReferencing = (model) =>
  model.fields.some((f) => f.kind === "object" && f.type === model.name && f.relationFromFields && f.relationFromFields.length);

// ---- value <-> JSON ----------------------------------------------------
function encodeRow(model, row) {
  const out = {};
  for (const f of model.fields) {
    if (f.kind === "object") continue;
    const v = row[f.name];
    if (v === undefined) continue;
    if (v === null) out[f.name] = null;
    else if (f.type === "DateTime") out[f.name] = new Date(v).toISOString();
    else if (f.type === "Bytes") out[f.name] = { $b64: Buffer.from(v).toString("base64") };
    else if (f.type === "Decimal") out[f.name] = v.toString();
    else if (f.type === "BigInt") out[f.name] = v.toString();
    else out[f.name] = v;
  }
  return out;
}

function decodeRow(model, row) {
  const out = {};
  for (const f of model.fields) {
    if (f.kind === "object") continue;
    if (!(f.name in row)) continue;
    const v = row[f.name];
    if (v === null) out[f.name] = null;
    else if (f.type === "DateTime") out[f.name] = new Date(v);
    else if (f.type === "Bytes") out[f.name] = Buffer.from(v.$b64, "base64");
    else if (f.type === "BigInt") out[f.name] = BigInt(v);
    else out[f.name] = v; // Decimal stays a string: Prisma accepts it exactly
  }
  return out;
}

// ---- backup ------------------------------------------------------------
/**
 * Streams a backup into `writable` (a file, or an HTTP response). Reads each
 * table in small pages so memory stays low even with many uploaded files.
 * Resolves with { models: {Name: count}, total }.
 */
async function writeBackup(prisma, datamodel, writable, { now = new Date() } = {}) {
  const gz = zlib.createGzip();
  gz.pipe(writable);
  const done = new Promise((resolve, reject) => {
    writable.on("finish", resolve);
    writable.on("close", resolve);
    writable.on("error", reject);
    gz.on("error", reject);
  });
  let failure = null;
  gz.on("error", (e) => { failure = e; });
  const put = async (obj) => {
    if (failure) throw failure;
    if (!gz.write(JSON.stringify(obj) + "\n")) await new Promise((resolve) => gz.once("drain", resolve));
  };

  const models = orderedModels(datamodel);
  const counts = {};
  // Count first so the header (and a later restore) can verify completeness.
  for (const m of models) counts[m.name] = await prisma[lowerFirst(m.name)].count();
  await put({ format: FORMAT, version: VERSION, createdAt: now.toISOString(), models: counts });

  let total = 0;
  for (const m of models) {
    const delegate = prisma[lowerFirst(m.name)];
    const pageSize = hasBytes(m) ? 10 : 500;
    let cursor = null;
    for (;;) {
      const rows = await delegate.findMany({
        take: pageSize,
        orderBy: { id: "asc" },
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      });
      if (!rows.length) break;
      for (const r of rows) await put({ m: m.name, r: encodeRow(m, r) });
      total += rows.length;
      cursor = rows[rows.length - 1].id;
      if (rows.length < pageSize) break;
    }
  }
  gz.end();
  await done;
  return { models: counts, total };
}

// ---- inspect / restore --------------------------------------------------
async function* readLines(readable) {
  const rl = readline.createInterface({ input: readable.pipe(zlib.createGunzip()), crlfDelay: Infinity });
  for await (const line of rl) if (line.trim()) yield JSON.parse(line);
}

/** Reads only the header. Throws if this is not one of our backups. */
async function readHeader(readableFactory) {
  for await (const first of readLines(readableFactory())) {
    if (first.format !== FORMAT) throw new Error("This file is not an Embu Co-op backup.");
    if (first.version > VERSION) throw new Error(`Backup version ${first.version} is newer than this app understands (${VERSION}).`);
    return first;
  }
  throw new Error("The backup file is empty.");
}

/**
 * Inserts every row that is not already in the database. Returns per-model
 * { inFile, inserted, skipped }. With dryRun it only reports what is in the file.
 */
async function restoreBackup(prisma, datamodel, readableFactory, { dryRun = false, batch = 200, log = () => {} } = {}) {
  const header = await readHeader(readableFactory);
  const models = orderedModels(datamodel);
  const byName = new Map(models.map((m) => [m.name, m]));
  const unknown = Object.keys(header.models).filter((n) => !byName.has(n));
  if (unknown.length) {
    throw new Error("The backup has tables this version does not know about: " + unknown.join(", ") + ". Restore with the same or a newer version of the code.");
  }

  const result = {};
  for (const m of models) result[m.name] = { inFile: header.models[m.name] || 0, inserted: 0, skipped: 0 };
  if (dryRun) return { header, result };

  // One pass over the file, flushing a batch whenever the table changes or the
  // batch is full. The file is already in parent-before-child order.
  let current = null;
  let buf = [];
  const flush = async () => {
    if (!current || !buf.length) return;
    const delegate = prisma[lowerFirst(current.name)];
    const res = await delegate.createMany({ data: buf, skipDuplicates: true });
    result[current.name].inserted += res.count;
    result[current.name].skipped += buf.length - res.count;
    buf = [];
  };

  let first = true;
  for await (const line of readLines(readableFactory())) {
    if (first) { first = false; continue; }
    const m = byName.get(line.m);
    if (!m) throw new Error("Unknown table in backup: " + line.m);
    if (!current || current.name !== m.name) {
      await flush();
      current = m;
      log(`restoring ${m.name}…`);
    }
    buf.push(decodeRow(m, line.r));
    // A table that points at itself (staff reporting lines) is inserted in one
    // statement so parents and children are checked together.
    if (!selfReferencing(m) && buf.length >= (hasBytes(m) ? 10 : batch)) await flush();
  }
  await flush();

  const short = Object.entries(result).filter(([, v]) => v.inserted + v.skipped !== v.inFile);
  if (short.length) {
    throw new Error("Row counts do not match the header for: " + short.map(([n]) => n).join(", ") + ". The file may be truncated.");
  }
  return { header, result };
}

module.exports = { FORMAT, VERSION, orderedModels, encodeRow, decodeRow, writeBackup, readHeader, restoreBackup, lowerFirst };
