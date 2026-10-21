"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import ProtectedRoute from "../../components/ProtectedRoute";
import { useAuth } from "../../context/AuthContext";
import api from "../../lib/api";
import LocationPicker from "../../components/LocationPicker";
import ComplianceBadge, { LEVELS } from "../../components/ComplianceBadge";

const VALUE_CHAINS = [
  "COFFEE", "DAIRY", "MIRAA", "IRRIGATION", "TEA", "SUGARCANE", "COTTON",
  "CASHEWNUT", "FISHERIES", "LIVESTOCK", "POULTRY", "SACCO", "HOUSING",
  "TRANSPORT", "HANDICRAFTS", "OTHER",
];

export default function CooperativesPage() {
  const { user } = useAuth();
  const isNationalAdmin = user?.role === "NATIONAL_ADMIN";
  const isSubCountyOfficer = user?.role === "SUBCOUNTY_OFFICER";
  const canDelete = user?.role === "NATIONAL_ADMIN" || user?.role === "DIRECTOR";

  const [counties, setCounties] = useState([]);
  const [cooperatives, setCooperatives] = useState([]);
  const [filters, setFilters] = useState({ q: "", valueChain: "", countyId: "", subCountyId: "", wardId: "" });
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    name: "",
    registrationNumber: "",
    registrationDate: "",
    valueChain: "COFFEE",
    countyId: "",
    subCountyId: "",
    wardId: "",
  });
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [problems, setProblems] = useState([]);
  const [busy, setBusy] = useState(false);
  const [level, setLevel] = useState("");
  const canSheet = user?.role === "NATIONAL_ADMIN" || user?.role === "DIRECTOR";

  async function downloadSheet() {
    setError(""); setNotice("");
    try {
      const res = await api.get("/cooperatives/sheet", { responseType: "blob" });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement("a"); a.href = url; a.download = "cooperatives-sheet.xlsx"; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch { setError("Could not download the sheet."); }
  }
  function summarise(r, what) {
    const flagged = r.locationNotMatched?.length ? ` ${r.locationNotMatched.length} society name(s) have a ward that doesn't match the official list and are flagged: ${r.locationNotMatched.slice(0, 6).join(", ")}${r.locationNotMatched.length > 6 ? "…" : ""}.` : "";
    return `${what}: ${r.created} added, ${r.updated} updated, ${r.unchanged} unchanged.${flagged}`;
  }
  async function uploadSheet(ev) {
    const file = ev.target.files?.[0]; ev.target.value = "";
    if (!file) return;
    setBusy(true); setError(""); setNotice(""); setProblems([]);
    try {
      const fd = new FormData(); fd.append("file", file);
      const { data: r } = await api.post("/cooperatives/sheet", fd);
      setNotice(summarise(r, "Sheet loaded")); load();
    } catch (e) { const d = e?.response?.data; setError(d?.error || "Could not load the sheet."); setProblems(d?.errors || []); }
    finally { setBusy(false); }
  }
  async function loadRoster() {
    setBusy(true); setError(""); setNotice(""); setProblems([]);
    try { const { data: r } = await api.post("/cooperatives/import-roster"); setNotice(summarise(r, "County list loaded") + " Nothing existing was overwritten."); load(); }
    catch (e) { setError(e?.response?.data?.error || "Could not load the county list."); }
    finally { setBusy(false); }
  }

  useEffect(() => {
    api.get("/counties").then((res) => setCounties(res.data)).catch(() => {});
  }, []);

  async function load() {
    const params = {};
    if (filters.q) params.q = filters.q;
    if (filters.valueChain) params.valueChain = filters.valueChain;
    if (isNationalAdmin && filters.countyId) params.countyId = filters.countyId;
    if (filters.subCountyId) params.subCountyId = filters.subCountyId;
    if (filters.wardId) params.wardId = filters.wardId;
    const res = await api.get("/cooperatives", { params });
    setCooperatives(res.data);
  }

  useEffect(() => {
    load().catch((err) => setError(err?.response?.data?.error || "Failed to load"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters]);

  async function handleCreate(e) {
    e.preventDefault();
    setError("");
    try {
      await api.post("/cooperatives", { ...form, countyId: isNationalAdmin ? form.countyId : user?.countyId });
      setShowForm(false);
      setForm({ name: "", registrationNumber: "", registrationDate: "", valueChain: "COFFEE", countyId: "", subCountyId: "", wardId: "" });
      load();
    } catch (err) {
      setError(err?.response?.data?.error || "Failed to create cooperative");
    }
  }

  async function handleDelete(c) {
    const ok = window.confirm(
      `Delete "${c.name}"${c.registrationNumber ? ` (${c.registrationNumber})` : ""}?\n\nThis only works for a cooperative with no members, documents, contributions or other records. It cannot be undone.`
    );
    if (!ok) return;
    setError("");
    try {
      await api.delete(`/cooperatives/${c.id}`);
      await load();
    } catch (err) {
      setError(err?.response?.data?.error || "Failed to delete cooperative");
    }
  }

  return (
    <ProtectedRoute>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Cooperative Registry</h1>
        {user?.role !== "COOPERATIVE_MANAGER" && (
          <button
            onClick={() => setShowForm((s) => !s)}
            className="rounded-md bg-kenya-green px-4 py-2 text-sm font-semibold text-white hover:bg-kenya-green/90"
          >
            {showForm ? "Cancel" : "+ New Cooperative"}
          </button>
        )}
      </div>

      {showForm && (
        <form onSubmit={handleCreate} className="mb-6 grid grid-cols-2 gap-3 rounded-lg border border-gray-200 bg-white p-4 md:grid-cols-5">
          <input
            required
            placeholder="Name"
            className="rounded-md border border-gray-300 px-3 py-2 text-sm md:col-span-2"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
          <input
            placeholder="Registration No. (add later if not known)"
            className="rounded-md border border-gray-300 px-3 py-2 text-sm"
            value={form.registrationNumber}
            onChange={(e) => setForm({ ...form, registrationNumber: e.target.value })}
          />
          <label className="block text-xs text-gray-500">
            Date of registration (optional)
            <input
              type="date"
              max={new Date().toISOString().slice(0, 10)}
              min="1900-01-01"
              className="mt-0.5 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900"
              value={form.registrationDate}
              onChange={(e) => setForm({ ...form, registrationDate: e.target.value })}
            />
          </label>
          <select
            className="rounded-md border border-gray-300 px-3 py-2 text-sm"
            value={form.valueChain}
            onChange={(e) => setForm({ ...form, valueChain: e.target.value })}
          >
            {VALUE_CHAINS.map((v) => (
              <option key={v} value={v}>{v}</option>
            ))}
          </select>
          {isNationalAdmin && (
            <select
              required
              className="rounded-md border border-gray-300 px-3 py-2 text-sm"
              value={form.countyId}
              onChange={(e) => setForm({ ...form, countyId: e.target.value })}
            >
              <option value="">Select county…</option>
              {counties.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          )}
          <LocationPicker
            required
            countyId={isNationalAdmin ? form.countyId : user?.countyId}
            lockedSubCountyId={isSubCountyOfficer ? user?.subCountyId : undefined}
            value={{ subCountyId: form.subCountyId, wardId: form.wardId }}
            onChange={(loc) => setForm({ ...form, subCountyId: loc.subCountyId, wardId: loc.wardId })}
            selectClassName="rounded-md border border-gray-300 px-3 py-2 text-sm disabled:bg-gray-50"
          />
          <button type="submit" className="rounded-md bg-kenya-green px-3 py-2 text-sm font-semibold text-white md:col-span-5">
            Save Cooperative
          </button>
        </form>
      )}

      {notice && <p className="mb-3 rounded-md bg-green-50 px-3 py-2 text-sm text-green-800">{notice}</p>}
      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}
      {problems.length > 0 && (
        <ul className="mb-3 max-h-48 list-disc space-y-0.5 overflow-auto rounded-md bg-red-50 py-2 pl-7 pr-3 text-xs text-red-800">
          {problems.map((p, i) => <li key={i}>Row {p.row}{p.name ? ` (${p.name})` : ""}: {p.error}</li>)}
        </ul>
      )}
      {canSheet && (
        <div className="mb-3 flex flex-wrap items-center gap-3 rounded-md border border-gray-200 bg-white p-3 text-sm">
          <span className="text-gray-600">Register many in Excel:</span>
          <button onClick={downloadSheet} className="rounded-md border border-kenya-green px-3 py-1.5 text-xs font-semibold text-kenya-green">Download cooperatives sheet</button>
          <label className={`cursor-pointer rounded-md bg-kenya-green px-3 py-1.5 text-xs font-semibold text-white ${busy ? "opacity-50" : ""}`}>{busy ? "Loading…" : "Upload cooperatives sheet"}
            <input type="file" accept=".xlsx" className="hidden" disabled={busy} onChange={uploadSheet} />
          </label>
          <button onClick={loadRoster} disabled={busy} className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-semibold text-gray-700 disabled:opacity-50">Load Embu county list</button>
          <span className="text-xs text-gray-500">Blank cells change nothing; nothing is deleted. Details like members, committee and documents are added on each society's page.</span>
        </div>
      )}
      {cooperatives.length > 0 && (
        <div className="mb-3 grid grid-cols-3 gap-2 text-center sm:max-w-xl">
          {Object.entries(LEVELS).map(([k, l]) => (
            <button key={k} onClick={() => setLevel(level === k ? "" : k)} className={`rounded-lg border bg-white p-2 ${level === k ? "border-kenya-green ring-1 ring-kenya-green" : "border-gray-200"}`}>
              <span className="block text-xl font-bold">{cooperatives.filter((c) => c.compliance?.level === k).length}</span>
              <span className={`inline-flex items-center gap-1 text-xs font-semibold ${l.cls} rounded-full px-2`}>{l.label}</span>
            </button>
          ))}
        </div>
      )}

      <div className="mb-4 flex flex-wrap gap-3">
        <input
          placeholder="Search by name…"
          className="rounded-md border border-gray-300 px-3 py-2 text-sm"
          value={filters.q}
          onChange={(e) => setFilters({ ...filters, q: e.target.value })}
        />
        <select
          className="rounded-md border border-gray-300 px-3 py-2 text-sm"
          value={filters.valueChain}
          onChange={(e) => setFilters({ ...filters, valueChain: e.target.value })}
        >
          <option value="">All Value Chains</option>
          {VALUE_CHAINS.map((v) => (
            <option key={v} value={v}>{v}</option>
          ))}
        </select>
        {isNationalAdmin && (
          <select
            className="rounded-md border border-gray-300 px-3 py-2 text-sm"
            value={filters.countyId}
            onChange={(e) => setFilters({ ...filters, countyId: e.target.value, subCountyId: "", wardId: "" })}
          >
            <option value="">All Counties</option>
            {counties.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        )}
        {/* Drill down by sub-county and ward. A Sub-County Officer is held to
            their own sub-county (the server enforces this too). */}
        <LocationPicker
          allLabel
          countyId={isNationalAdmin ? filters.countyId : user?.countyId}
          lockedSubCountyId={isSubCountyOfficer ? user?.subCountyId : undefined}
          value={{ subCountyId: filters.subCountyId, wardId: filters.wardId }}
          onChange={(loc) => setFilters({ ...filters, subCountyId: loc.subCountyId, wardId: loc.wardId })}
          selectClassName="rounded-md border border-gray-300 px-3 py-2 text-sm disabled:bg-gray-50"
        />
      </div>

      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
            <tr>
              <th className="px-4 py-2">Name</th>
              <th className="px-4 py-2">Reg. No.</th>
              <th className="px-4 py-2">Registered</th>
              <th className="px-4 py-2">Compliance</th>
              <th className="px-4 py-2">Type</th>
              {isNationalAdmin && <th className="px-4 py-2">County</th>}
              <th className="px-4 py-2">Sub-County / Ward</th>
              <th className="px-4 py-2">Members</th>
              <th className="px-4 py-2">Documents</th>
              {canDelete && <th className="px-4 py-2"></th>}
            </tr>
          </thead>
          <tbody>
            {cooperatives.filter((c) => !level || c.compliance?.level === level).map((c) => (
              <tr key={c.id} className="border-t border-gray-100 hover:bg-gray-50">
                <td className="px-4 py-2 font-medium">
                  <Link href={`/cooperatives/${c.id}`} className="text-kenya-green hover:underline">
                    {c.name}
                  </Link>
                </td>
                <td className="px-4 py-2 text-gray-600">{c.registrationNumber || <span className="text-xs text-amber-700">Not yet recorded</span>}</td>
                <td className="px-4 py-2 whitespace-nowrap text-gray-600">{c.registrationDate ? new Date(c.registrationDate).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }) : "—"}</td>
                <td className="px-4 py-2"><ComplianceBadge compliance={c.compliance} /></td>
                <td className="px-4 py-2">{c.societyType || c.valueChain}</td>
                {isNationalAdmin && <td className="px-4 py-2">{c.county?.name}</td>}
                <td className="px-4 py-2">{c.subCounty} / {c.ward}</td>
                <td className="px-4 py-2">{c._count?.members ?? 0}</td>
                <td className="px-4 py-2">{c._count?.documents ?? 0}</td>
                {canDelete && (
                  <td className="px-4 py-2 text-right">
                    <button onClick={() => handleDelete(c)} className="text-xs text-red-600 hover:underline">
                      Delete
                    </button>
                  </td>
                )}
              </tr>
            ))}
            {cooperatives.length === 0 && (
              <tr>
                <td colSpan={8 + (isNationalAdmin ? 1 : 0) + (canDelete ? 1 : 0)} className="px-4 py-6 text-center text-gray-400">
                  {user?.role === "COOPERATIVE_MANAGER"
                    ? "Your account isn't linked to a cooperative yet. Ask your County Co-operative Office to assign you on the Staff & Access page."
                    : "No cooperatives found."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </ProtectedRoute>
  );
}
