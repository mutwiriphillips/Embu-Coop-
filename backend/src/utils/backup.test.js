// Run: node src/utils/backup.test.js  (needs no database)
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { orderedModels, writeBackup, restoreBackup, readHeader } = require("./backup");

const f = (name, type, extra = {}) => ({ name, type, kind: "scalar", ...extra });
const rel = (name, type, from) => ({ name, type, kind: "object", relationFromFields: from ? [from] : [] });
const datamodel = {
  models: [
    { name: "Document", fields: [f("id", "String"), f("coopId", "String"), rel("coop", "Coop", "coopId"), f("data", "Bytes"), f("at", "DateTime")] },
    { name: "Coop", fields: [f("id", "String"), f("name", "String"), f("fee", "Decimal"), f("meta", "Json", { isList: false }), rel("docs", "Document", null)] },
    { name: "User", fields: [f("id", "String"), f("bossId", "String"), rel("boss", "User", "bossId"), rel("reports", "User", null)] },
  ],
};

function fakeDb() {
  const t = { coop: [], document: [], user: [] };
  const mk = (n) => ({
    count: async () => t[n].length,
    findMany: async ({ take, skip = 0, cursor }) => {
      let rows = [...t[n]].sort((a, b) => (a.id < b.id ? -1 : 1));
      if (cursor) rows = rows.slice(rows.findIndex((r) => r.id === cursor.id) + skip);
      return rows.slice(0, take);
    },
    createMany: async ({ data, skipDuplicates }) => {
      let count = 0;
      for (const d of data) {
        if (t[n].some((r) => r.id === d.id)) { if (skipDuplicates) continue; throw new Error("dup"); }
        t[n].push(d); count++;
      }
      return { count };
    },
  });
  return { t, coop: mk("coop"), document: mk("document"), user: mk("user") };
}

(async () => {
  let pass = 0;
  const ok = (c, m) => { assert(c, m); pass++; };

  // ordering: parents first, self-reference allowed
  const order = orderedModels(datamodel).map((m) => m.name);
  ok(order.indexOf("Coop") < order.indexOf("Document"), "Coop before Document");
  try { orderedModels({ models: [
    { name: "A", fields: [rel("b", "B", "bId")] }, { name: "B", fields: [rel("a", "A", "aId")] } ] }); ok(false, "cycle"); }
  catch (e) { ok(/Circular/.test(e.message), "cycle detected"); }

  // backup -> restore round trip
  const src = fakeDb();
  const bytes = Buffer.from([0, 1, 2, 250, 255, 10, 13]);
  src.t.coop.push({ id: "c1", name: "Kirimiri, \"Dairy\"\nSociety", fee: "1234567.89", meta: { a: [1, 2] } });
  for (let i = 0; i < 25; i++) src.t.document.push({ id: "d" + String(i).padStart(2, "0"), coopId: "c1", data: bytes, at: new Date("2026-03-04T05:06:07.000Z") });
  src.t.user.push({ id: "u2", bossId: "u1" }, { id: "u1", bossId: null }); // child sorts after parent only by luck of id: u1<u2
  src.t.user.push({ id: "a0", bossId: "u1" });

  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "bk-")), "b.jsonl.gz");
  const r = await writeBackup(src, datamodel, fs.createWriteStream(file));
  ok(r.total === 29 && r.models.Document === 25, "counts");
  const header = await readHeader(() => fs.createReadStream(file));
  ok(header.format === "embu-coop-backup" && header.models.Coop === 1, "header");

  const dst = fakeDb();
  const pre = await restoreBackup(dst, datamodel, () => fs.createReadStream(file), { dryRun: true });
  ok(pre.result.Document.inFile === 25 && dst.t.document.length === 0, "dry run writes nothing");

  const res = await restoreBackup(dst, datamodel, () => fs.createReadStream(file), { batch: 7 });
  ok(res.result.Document.inserted === 25 && res.result.User.inserted === 3, "all inserted");
  ok(dst.t.coop[0].name === src.t.coop[0].name && dst.t.coop[0].fee === "1234567.89", "text/money exact");
  ok(Buffer.compare(dst.t.document[0].data, bytes) === 0, "binary exact");
  ok(dst.t.document[0].at instanceof Date && dst.t.document[0].at.toISOString() === "2026-03-04T05:06:07.000Z", "date revived");

  // re-run changes nothing
  const again = await restoreBackup(dst, datamodel, () => fs.createReadStream(file));
  ok(again.result.Document.inserted === 0 && again.result.Document.skipped === 25 && dst.t.document.length === 25, "idempotent");

  // never overwrites existing rows
  const keep = fakeDb();
  keep.t.coop.push({ id: "c1", name: "NEWER EDIT", fee: "1", meta: null });
  await restoreBackup(keep, datamodel, () => fs.createReadStream(file));
  ok(keep.t.coop[0].name === "NEWER EDIT", "existing row untouched");

  // not a backup / truncated
  const junk = path.join(path.dirname(file), "junk.gz");
  fs.writeFileSync(junk, require("zlib").gzipSync('{"hello":1}\n'));
  try { await readHeader(() => fs.createReadStream(junk)); ok(false, "junk"); } catch (e) { ok(/not an Embu/.test(e.message), "junk rejected"); }
  const cut = path.join(path.dirname(file), "cut.gz");
  fs.writeFileSync(cut, fs.readFileSync(file).subarray(0, 40));
  try { await restoreBackup(fakeDb(), datamodel, () => fs.createReadStream(cut)); ok(false, "cut"); } catch (e) { ok(true, "truncated file rejected"); }

  console.log(`${pass} backup checks passed`);
})().catch((e) => { console.error("FAIL", e); process.exit(1); });
