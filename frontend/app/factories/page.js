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
