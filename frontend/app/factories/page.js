"use client";

import { useEffect, useState } from "react";
import ProtectedRoute from "../../components/ProtectedRoute";
import { useAuth } from "../../context/AuthContext";
import api from "../../lib/api";

const CHAINS = ["COFFEE", "DAIRY", "MIRAA", "IRRIGATION", "TEA", "SUGARCANE", "COTTON", "CASHEWNUT", "FISHERIES", "LIVESTOCK", "POULTRY", "SACCO", "HOUSING", "TRANSPORT", "HANDICRAFTS", "OTHER"];
const blank = { name: "", valueChain: "", location: "", contactPhone: "", countyId: "" };

export default function FactoriesPage() {
  const { user } = useAuth();
  const isNA = user?.role === "NATIONAL_ADMIN";
  const canManage = isNA || user?.role === "DIRECTOR";
  const [rows, setRows] = useState([]);
  const [counties, setCounties] = useState([]);
  const [form, setForm] = useState(blank);
  const [editing, setEditing] = useState(null);
  const [error, setError] = useState("");

  function load() {
    api.get("/factories").then((r) => setRows(r.data)).catch((e) => setError(e?.response?.data?.error || "Failed to load factories"));
  }
  useEffect(load, []);
  useEffect(() => { if (isNA) api.get("/counties").then((r) => setCounties(r.data)).catch(() => {}); }, [isNA]);

  async function save(e) {
    e.preventDefault();
    setError("");
    const body = { name: form.name, valueChain: form.valueChain || undefined, location: form.location || undefined, contactPhone: form.contactPhone || undefined };
    try {
      if (editing) await api.patch(`/factories/${editing}`, body);
      else await api.post("/factories", { ...body, ...(isNA ? { countyId: form.countyId } : {}) });
      setForm(blank); setEditing(null); load();
    } catch (err) { setError(err?.response?.data?.error || "Could not save"); }
  }
  async function del(f) {
    setError("");
    if (!window.confirm(`Delete ${f.name}?`)) return;
    try { await api.delete(`/factories/${f.id}`); load(); }
    catch (err) { setError(err?.response?.data?.error || "Could not delete"); }
  }
  function edit(f) {
    setEditing(f.id);
    setForm({ name: f.name, valueChain: f.valueChain || "", location: f.location || "", contactPhone: f.contactPhone || "", countyId: f.countyId });
  }
  const cls = "rounded-md border border-gray-300 px-3 py-2 text-sm";

  return (
    <ProtectedRoute>
      <h1 className="mb-1 text-2xl font-bold">Factories</h1>
      <p className="mb-6 text-sm text-gray-500">The factories that buy produce and make the payments. Link each one to the societies it pays (on the society page, or with the Factory column of the cooperatives sheet); the Farmer Disbursements dashboard then shows who paid what.</p>
      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

      {canManage && <ImportPanel isNA={isNA} counties={counties} onDone={load} />}

      {canManage && (
        <form onSubmit={save} className="mb-6 flex flex-wrap items-end gap-3 rounded-lg border border-gray-200 bg-white p-4">
          <div><label className="mb-1 block text-xs text-gray-500">Name</label><input required minLength={2} className={cls} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
          <div><label className="mb-1 block text-xs text-gray-500">Value chain</label>
            <select className={cls} value={form.valueChain} onChange={(e) => setForm({ ...form, valueChain: e.target.value })}>
              <option value="">Any</option>{CHAINS.map((c) => <option key={c}>{c}</option>)}
            </select></div>
          <div><label className="mb-1 block text-xs text-gray-500">Location</label><input className={cls} value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} /></div>
          <div><label className="mb-1 block text-xs text-gray-500">Phone</label><input className={cls} value={form.contactPhone} onChange={(e) => setForm({ ...form, contactPhone: e.target.value })} /></div>
          {isNA && !editing && (
            <div><label className="mb-1 block text-xs text-gray-500">County</label>
              <select required className={cls} value={form.countyId} onChange={(e) => setForm({ ...form, countyId: e.target.value })}>
                <option value="">Choose…</option>{counties.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select></div>
          )}
          <button className="rounded-md bg-kenya-green px-4 py-2 text-sm font-medium text-white">{editing ? "Save" : "Add factory"}</button>
          {editing && <button type="button" className="text-sm text-gray-500" onClick={() => { setEditing(null); setForm(blank); }}>Cancel</button>}
        </form>
      )}

      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
            <tr><th className="px-4 py-2">Factory</th>{isNA && <th className="px-4 py-2">County</th>}<th className="px-4 py-2">Value chain</th><th className="px-4 py-2">Location</th><th className="px-4 py-2">Phone</th><th className="px-4 py-2">Societies paid</th><th className="px-4 py-2"></th></tr>
          </thead>
          <tbody>
            {rows.map((f) => (
              <tr key={f.id} className="border-t border-gray-100 align-top">
                <td className="px-4 py-2 font-medium">{f.name}</td>
                {isNA && <td className="px-4 py-2">{counties.find((c) => c.id === f.countyId)?.name || "—"}</td>}
                <td className="px-4 py-2">{f.valueChain || "—"}</td>
                <td className="px-4 py-2">{f.location || "—"}</td>
                <td className="px-4 py-2">{f.contactPhone || "—"}</td>
                <td className="px-4 py-2 text-xs">{(f.cooperatives || []).length === 0 ? <span className="text-gray-400">none linked</span> : (f.cooperatives || []).map((c) => c.name).join(", ")}</td>
                <td className="whitespace-nowrap px-4 py-2 text-xs">
                  {canManage && <><button className="mr-3 text-kenya-green" onClick={() => edit(f)}>Edit</button><button className="text-kenya-red" onClick={() => del(f)}>Delete</button></>}
                </td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={7} className="px-4 py-6 text-center text-gray-400">No factories yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </ProtectedRoute>
  );
}

function ImportPanel({ isNA, counties, onDone }) {
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState(null);
  const [countyId, setCountyId] = useState("");
  const [useSuggested, setUseSuggested] = useState(false);
  const [skipUnknown, setSkipUnknown] = useState(false);
  const [rep, setRep] = useState(null);
  const [done, setDone] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  async function send(preview) {
    setErr(""); setDone(""); setBusy(true);
    const fd = new FormData();
    fd.append("file", file); fd.append("valueChain", "COFFEE"); fd.append("preview", String(preview));
    fd.append("useSuggested", String(useSuggested)); fd.append("skipUnknown", String(skipUnknown));
    if (isNA && countyId) fd.append("countyId", countyId);
    try {
      const r = await api.post("/factories/import", fd);
      if (preview) setRep(r.data);
      else { setRep(null); setFile(null); setDone(`Saved: ${r.data.createdFactories} factories created and ${r.data.createdLinks} links to societies made.`); onDone(); }
    } catch (e) {
      const b = e?.response?.data;
      if (b?.problems) setRep(b); else setErr(b?.error || "Could not read the file");
    } finally { setBusy(false); }
  }
  if (!open) return <button className="mb-4 rounded-md border border-gray-300 px-3 py-2 text-sm" onClick={() => setOpen(true)}>Import factories from Excel</button>;
  return (
    <div className="mb-6 rounded-lg border border-gray-200 bg-white p-4 text-sm">
      <p className="mb-2 font-semibold">Import coffee factories and link them to their societies</p>
      <p className="mb-3 text-xs text-gray-600">Columns: COOPERATIVE, SUBCOUNTY, FACTORY, ZONE. A blank cooperative cell means the same society as the row above. This only adds factories and links; nothing is removed or changed. Check the file first, then confirm.</p>
      <div className="flex flex-wrap items-center gap-3">
        <input type="file" accept=".xlsx,.csv" onChange={(e) => { setFile(e.target.files?.[0] || null); setRep(null); }} />
        {isNA && <select className="rounded-md border border-gray-300 px-2 py-1" value={countyId} onChange={(e) => setCountyId(e.target.value)}><option value="">County…</option>{counties.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>}
        <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={useSuggested} onChange={(e) => { setUseSuggested(e.target.checked); setRep(null); }} /> Use the closest registered name when spelling differs</label>
        <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={skipUnknown} onChange={(e) => { setSkipUnknown(e.target.checked); setRep(null); }} /> Skip societies I haven&apos;t registered</label>
        <button disabled={busy || !file} onClick={() => send(true)} className="rounded-md border border-gray-300 px-3 py-2 disabled:opacity-50">Check file</button>
      </div>
      {err && <p className="mt-3 text-red-600">{err}</p>}
      {done && <p className="mt-3 text-green-700">{done}</p>}
      {rep && !rep.ok && (
        <div className="mt-3 rounded-md bg-red-50 p-3 text-red-800">
          <p className="font-medium">{rep.error}</p>
          <ul className="mt-1 list-disc pl-5 text-xs">{rep.problems.map((p, i) => <li key={i}>Row {p.row}: {p.message}</li>)}</ul>
        </div>
      )}
      {rep && rep.ok && (
        <div className="mt-3 rounded-md bg-green-50 p-3 text-green-900">
          <p><strong>{rep.societies}</strong> societies, <strong>{rep.factoriesInSheet}</strong> factories: <strong>{rep.newFactories.length}</strong> new, <strong>{rep.linksToCreate}</strong> links to make, {rep.alreadyLinked} already linked.</p>
          {rep.skipped > 0 && <p className="mt-1 text-xs">Skipped (not registered): {rep.unmatched.map((u) => u.name).join(", ")}</p>}
          {rep.notes.length > 0 && <ul className="mt-1 list-disc pl-5 text-xs">{rep.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>}
          {rep.sharedFactories.length > 0 && <p className="mt-1 text-xs">Paying more than one society: {rep.sharedFactories.join(", ")}</p>}
          <details className="mt-2 text-xs"><summary className="cursor-pointer">See what will be linked</summary>
            <ul className="mt-1 space-y-0.5">{rep.preview_rows.map((r) => <li key={r.society}><strong>{r.society}</strong>: {r.factories.join(", ")}</li>)}</ul></details>
          <button disabled={busy} onClick={() => send(false)} className="mt-3 rounded-md bg-kenya-green px-4 py-2 font-medium text-white disabled:opacity-50">{busy ? "Saving…" : "Confirm and save"}</button>
        </div>
      )}
    </div>
  );
}
