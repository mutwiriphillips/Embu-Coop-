"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import ProtectedRoute from "../../components/ProtectedRoute";
import { useAuth } from "../../context/AuthContext";
import api from "../../lib/api";

const CHAINS = ["COFFEE", "TEA", "DAIRY", "MIRAA", "SUGARCANE", "COTTON", "CASHEWNUT", "FISHERIES", "LIVESTOCK", "POULTRY", "IRRIGATION", "OTHER"];
const pretty = (s) => s.charAt(0) + s.slice(1).toLowerCase();
const money = (n) => Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const unitWord = (u) => (u === "LITERS" ? "litre" : "kg");

export default function SeasonRatesPage() {
  const { user } = useAuth();
  const isNA = user?.role === "NATIONAL_ADMIN";
  const [valueChain, setValueChain] = useState("COFFEE");
  const [cropYear, setCropYear] = useState("");
  const [countyId, setCountyId] = useState("");
  const [counties, setCounties] = useState([]);
  const [factories, setFactories] = useState([]);
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [editing, setEditing] = useState(false);
  const [edits, setEdits] = useState({}); // cooperativeId -> { factoryId?, rounds: { no: "123.4" } }
  const [extraRounds, setExtraRounds] = useState(0);
  const [newYear, setNewYear] = useState("");
  const [busy, setBusy] = useState(false);
  const [focus, setFocus] = useState("");
  const sectionRefs = useRef({});
  const [showImport, setShowImport] = useState(false);
  const [file, setFile] = useState(null);
  const [skipUnknown, setSkipUnknown] = useState(false);
  const [report, setReport] = useState(null);
  const [importBusy, setImportBusy] = useState(false);

  function load(params = {}) {
    const q = { valueChain, ...(cropYear ? { cropYear } : {}), ...(isNA && countyId ? { countyId } : {}), ...params };
    setError("");
    api.get("/season-rates", { params: q })
      .then((r) => { setData(r.data); if (!cropYear) setCropYear(r.data.cropYear); })
      .catch((e) => setError(e?.response?.data?.error || "Could not load the directory"));
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [valueChain, cropYear, countyId]);
  useEffect(() => { if (isNA) api.get("/counties").then((r) => setCounties(r.data)).catch(() => {}); }, [isNA]);
  useEffect(() => { if (data?.canEdit) api.get("/factories").then((r) => setFactories(r.data)).catch(() => {}); }, [data?.canEdit]);

  const roundCount = (data?.roundCount || 2) + (editing ? extraRounds : 0);
  const roundNos = Array.from({ length: roundCount }, (_, i) => i + 1);

  function cell(s, no) {
    const e = edits[s.cooperativeId]?.rounds?.[no];
    if (e !== undefined) return e;
    const r = s.rounds.find((x) => x.roundNo === no);
    return r ? String(r.avgPrice) : "";
  }
  function setRound(s, no, v) {
    setEdits((p) => ({ ...p, [s.cooperativeId]: { ...p[s.cooperativeId], rounds: { ...(p[s.cooperativeId]?.rounds || {}), [no]: v } } }));
  }
  function setFactory(s, v) {
    setEdits((p) => ({ ...p, [s.cooperativeId]: { ...p[s.cooperativeId], factoryId: v || null } }));
  }

  async function save() {
    setError(""); setMsg("");
    const rows = [];
    for (const g of data.subCounties) for (const s of g.societies) {
      const e = edits[s.cooperativeId]; if (!e) continue;
      const row = { cooperativeId: s.cooperativeId, rounds: [] };
      if (e.factoryId !== undefined && e.factoryId !== s.factoryId) row.factoryId = e.factoryId;
      for (const [no, v] of Object.entries(e.rounds || {})) {
        const orig = s.rounds.find((x) => x.roundNo === Number(no));
        const txt = String(v).trim();
        if (txt === "") { if (orig) row.rounds.push({ roundNo: Number(no), avgPrice: null }); continue; }
        const n = Number(txt);
        if (!Number.isFinite(n) || n <= 0) { setError(`"${v}" is not a valid price (${s.name}, payment ${no})`); return; }
        if (!orig || orig.avgPrice !== n) row.rounds.push({ roundNo: Number(no), avgPrice: n });
      }
      if (row.rounds.length || row.factoryId !== undefined) rows.push(row);
    }
    if (rows.length === 0) { setEditing(false); setEdits({}); setExtraRounds(0); return; }
    setBusy(true);
    try {
      const r = await api.put("/season-rates/bulk", { valueChain, cropYear: data.cropYear, rows });
      setMsg(`Saved: ${r.data.societies} societies updated. The payout dashboard now uses these figures.`);
      setEditing(false); setEdits({}); setExtraRounds(0); load();
    } catch (e) { setError(e?.response?.data?.error || "Could not save"); }
    setBusy(false);
  }

  async function downloadTemplate() {
    setError("");
    try {
      const r = await api.get("/season-rates/template", { params: { valueChain, cropYear: data.cropYear, ...(isNA && countyId ? { countyId } : {}) }, responseType: "blob" });
      const url = URL.createObjectURL(r.data);
      const a = document.createElement("a");
      a.href = url; a.download = `season-rates-${valueChain.toLowerCase()}-${data.cropYear.replace("/", "-")}.csv`; a.click();
      URL.revokeObjectURL(url);
    } catch (e) { setError("Could not download the template"); }
  }
  async function sendFile(preview) {
    if (!file) { setError("Choose a CSV or Excel file first"); return; }
    setError(""); setMsg(""); setImportBusy(true);
    const fd = new FormData();
    fd.append("file", file); fd.append("valueChain", valueChain); fd.append("cropYear", data.cropYear);
    fd.append("preview", preview ? "true" : "false"); fd.append("skipUnknown", skipUnknown ? "true" : "false");
    if (isNA && countyId) fd.append("countyId", countyId);
    try {
      const r = await api.post("/season-rates/import", fd);
      setReport(r.data);
      if (!preview && r.data.ok) {
        setMsg(`Imported: ${r.data.changes.roundsSet} prices recorded for ${r.data.changes.societies} societies${r.data.factoriesCreated ? `, ${r.data.factoriesCreated} new factory(ies) created` : ""}. The payout dashboard now uses them.`);
        setReport(null); setFile(null); setShowImport(false); load();
      }
    } catch (e) {
      const b = e?.response?.data;
      if (b?.problems) setReport(b); else setError(b?.error || "Could not read the file");
    }
    setImportBusy(false);
  }

  function jump(name) {
    setFocus(name);
    const el = sectionRefs.current[name];
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  function startNewYear() {
    if (!/^\d{4}\/\d{4}$/.test(newYear)) { setError("Write the crop year like 2026/2027"); return; }
    setNewYear(""); setCropYear(newYear);
  }

  const cls = "rounded-md border border-gray-300 px-3 py-2 text-sm";
  const factoriesFor = (s) => factories.filter((f) => f.countyId === s.countyId);
  const subAvg = (g, no) => {
    const v = g.societies.map((s) => s.rounds.find((x) => x.roundNo === no)?.avgPrice).filter((x) => x != null);
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
  };

  return (
    <ProtectedRoute>
      <h1 className="mb-1 text-2xl font-bold">Crop Season Rates</h1>
      <p className="mb-5 text-sm text-gray-500">
        The average price per {unitWord(data?.unit)} each society was paid in each payment round of a crop year, the factory that paid, grouped by sub-county.
        What is recorded here feeds the Farmer Disbursements dashboard.
      </p>

      <div className="sticky top-0 z-10 mb-4 flex flex-wrap items-end gap-3 rounded-lg border border-gray-200 bg-white p-3">
        <div><label className="mb-1 block text-xs text-gray-500">Value chain</label>
          <select className={cls} value={valueChain} onChange={(e) => { setCropYear(""); setEditing(false); setEdits({}); setValueChain(e.target.value); }}>
            {CHAINS.map((c) => <option key={c} value={c}>{pretty(c)}</option>)}
          </select></div>
        <div><label className="mb-1 block text-xs text-gray-500">Crop year</label>
          <select className={cls} value={data?.cropYear || cropYear} onChange={(e) => { setEditing(false); setEdits({}); setCropYear(e.target.value); }}>
            {(data?.cropYears || [cropYear]).filter(Boolean).map((y) => <option key={y}>{y}</option>)}
          </select></div>
        {data?.canEdit && (
          <div className="flex items-end gap-1"><div><label className="mb-1 block text-xs text-gray-500">New crop year</label>
            <input className={cls + " w-28"} placeholder="2026/2027" value={newYear} onChange={(e) => setNewYear(e.target.value)} /></div>
            <button className="rounded-md border border-gray-300 px-3 py-2 text-sm" onClick={startNewYear}>Start</button></div>
        )}
        {isNA && (
          <div><label className="mb-1 block text-xs text-gray-500">County</label>
            <select className={cls} value={countyId} onChange={(e) => { setCropYear(""); setCountyId(e.target.value); }}>
              <option value="">All counties</option>{counties.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select></div>
        )}
        <div><label className="mb-1 block text-xs text-gray-500">Go to sub-county</label>
          <select className={cls} value={focus} onChange={(e) => jump(e.target.value)}>
            <option value="">Choose…</option>
            {(data?.subCounties || []).map((g) => <option key={g.label} value={g.label}>{g.label} ({g.societies.length})</option>)}
          </select></div>
        {data?.canEdit && (
          <div className="ml-auto flex flex-wrap gap-2">
            {!editing && <button className="rounded-md border border-gray-300 px-3 py-2 text-sm" onClick={() => { setShowImport(!showImport); setReport(null); }}>Import CSV</button>}
            {!editing ? (
              <button className="rounded-md bg-kenya-green px-4 py-2 text-sm font-medium text-white" onClick={() => { setEditing(true); setMsg(""); }}>Edit</button>
            ) : (
              <>
                <button className="rounded-md border border-gray-300 px-3 py-2 text-sm" onClick={() => setExtraRounds(extraRounds + 1)} disabled={roundCount >= 12}>+ Payment</button>
                <button className="rounded-md border border-gray-300 px-3 py-2 text-sm" onClick={() => { setEditing(false); setEdits({}); setExtraRounds(0); }}>Cancel</button>
                <button className="rounded-md bg-kenya-green px-4 py-2 text-sm font-medium text-white disabled:opacity-50" disabled={busy} onClick={save}>{busy ? "Saving…" : "Save"}</button>
              </>
            )}
          </div>
        )}
      </div>

      {showImport && data?.canEdit && (
        <div className="mb-4 rounded-lg border border-gray-200 bg-white p-4 text-sm">
          <p className="mb-2 font-semibold">Import {pretty(valueChain)} prices for {data.cropYear}</p>
          <ol className="mb-3 list-decimal space-y-1 pl-5 text-xs text-gray-600">
            <li>Use your own list, or <button className="text-kenya-green underline" onClick={downloadTemplate}>download the template</button> already filled with your societies.</li>
            <li>Columns: society name, optional Factory, and one column per payment headed like <b>Av. payment (1)</b>, <b>(2)</b>… Numbering such as &quot;1.&quot; and &quot;FCS&quot; spelling are ignored when matching names.</li>
            <li>&quot;Not yet&quot; and empty cells change nothing; an import never erases a price. A factory name that doesn&apos;t exist yet is created.</li>
          </ol>
          <div className="flex flex-wrap items-center gap-3">
            <input type="file" accept=".csv,.xlsx,text/csv" onChange={(e) => { setFile(e.target.files?.[0] || null); setReport(null); }} />
            <label className="flex items-center gap-1 text-xs text-gray-600"><input type="checkbox" checked={skipUnknown} onChange={(e) => setSkipUnknown(e.target.checked)} /> Skip societies I can&apos;t match</label>
            <button className="rounded-md border border-gray-300 px-3 py-2 text-sm disabled:opacity-50" disabled={importBusy || !file} onClick={() => sendFile(true)}>Check file</button>
          </div>
          {report && (
            <div className="mt-3 rounded-md bg-gray-50 p-3 text-xs">
              {report.ok ? (
                <>
                  <p className="font-medium text-gray-800">Ready: {report.matched} societies matched, {report.changes.roundsSet} prices to record{report.changes.roundsSet === 0 ? " (nothing new)" : ""}{report.newFactories?.length ? `, new factories: ${report.newFactories.join(", ")}` : ""}.</p>
                  {report.unmatched?.length > 0 && <p className="mt-1 text-gray-600">Skipped (not found): {report.unmatched.join(", ")}</p>}
                  <button className="mt-2 rounded-md bg-kenya-green px-4 py-2 text-sm font-medium text-white disabled:opacity-50" disabled={importBusy} onClick={() => sendFile(false)}>{importBusy ? "Saving…" : "Confirm and save"}</button>
                </>
              ) : (
                <>
                  <p className="font-medium text-red-700">{report.error || "Nothing would be saved."}</p>
                  <ul className="mt-1 list-disc space-y-0.5 pl-5 text-gray-700">{(report.problems || []).slice(0, 30).map((p, i) => <li key={i}>{p.row ? `Row ${p.row}: ` : ""}{p.message}</li>)}</ul>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}
      {msg && <p className="mb-3 text-sm text-kenya-green">{msg}</p>}
      {data && data.subCounties.length === 0 && <p className="rounded-lg border border-gray-200 bg-white p-6 text-center text-gray-400">No {pretty(valueChain)} societies registered in your area yet.</p>}

      {(data?.subCounties || []).map((g) => (
        <section key={g.label} ref={(el) => (sectionRefs.current[g.label] = el)} className={"mb-8 scroll-mt-28 rounded-lg border bg-white " + (focus === g.label ? "border-kenya-green" : "border-gray-200")}>
          <h2 className="border-b border-gray-100 px-4 py-3 text-base font-semibold">
            {g.label} Sub-County <span className="font-normal text-gray-500">· {pretty(valueChain)} payouts for {data.cropYear} crop year</span>
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
                <tr>
                  <th className="px-3 py-2">#</th><th className="px-3 py-2">Society&apos;s name</th><th className="px-3 py-2">Ward</th><th className="px-3 py-2">Factory paying</th>
                  {roundNos.map((n) => <th key={n} className="px-3 py-2 text-right">Av. payment ({n})<div className="font-normal normal-case text-gray-400">KES / {unitWord(data.unit)}</div></th>)}
                </tr>
              </thead>
              <tbody>
                {g.societies.map((s, i) => (
                  <tr key={s.cooperativeId} className="border-t border-gray-100">
                    <td className="px-3 py-2 text-gray-400">{i + 1}</td>
                    <td className="px-3 py-2 font-medium">{s.name}</td>
                    <td className="px-3 py-2 text-gray-600">{s.ward || "—"}</td>
                    <td className="px-3 py-2">
                      {editing ? (
                        <select className="w-44 rounded-md border border-gray-300 px-2 py-1 text-xs" value={(edits[s.cooperativeId]?.factoryId !== undefined ? edits[s.cooperativeId].factoryId : s.factoryId) || ""} onChange={(e) => setFactory(s, e.target.value)}>
                          <option value="">— none —</option>{factoriesFor(s).map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                        </select>
                      ) : s.factoryName || <span className="text-gray-400">—</span>}
                    </td>
                    {roundNos.map((n) => {
                      const r = s.rounds.find((x) => x.roundNo === n);
                      return (
                        <td key={n} className="px-3 py-2 text-right">
                          {editing ? (
                            <input inputMode="decimal" className="w-24 rounded-md border border-gray-300 px-2 py-1 text-right text-sm" placeholder="not yet" value={cell(s, n)} onChange={(e) => setRound(s, n, e.target.value)} />
                          ) : r ? money(r.avgPrice) : <span className="text-gray-400">Not yet</span>}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-gray-200 bg-gray-50 text-xs text-gray-600">
                  <td colSpan={4} className="px-3 py-2 font-medium">Simple average of societies that have been paid</td>
                  {roundNos.map((n) => { const a = subAvg(g, n); return <td key={n} className="px-3 py-2 text-right font-medium">{a == null ? "—" : money(a)}</td>; })}
                </tr>
              </tfoot>
            </table>
          </div>
        </section>
      ))}
    </ProtectedRoute>
  );
}
