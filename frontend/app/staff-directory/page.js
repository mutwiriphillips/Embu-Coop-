"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import ProtectedRoute from "../../components/ProtectedRoute";
import StatusBadge from "../../components/StatusBadge";
import { useAuth } from "../../context/AuthContext";
import api from "../../lib/api";

const TABS = ["Staff", "Transfers", "Merit ranking"];
const LEVEL = { SUB_COUNTY_OFFICE: "Sub-county office", COUNTY_OFFICE: "County office", MINISTRY: "Ministry" };
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "—");

export default function StaffDirectoryPage() {
  const { user } = useAuth();
  const [tab, setTab] = useState("Staff");
  const canImport = ["NATIONAL_ADMIN", "DIRECTOR"].includes(user?.role);

  return (
    <ProtectedRoute>
      <h1 className="text-2xl font-bold">Staff Directory</h1>
      <p className="mb-4 text-sm text-gray-500">Cooperative section staff: designation, duty station, current status and transfers. This is the staff roster, separate from sign-in accounts.</p>
      <div className="mb-5 flex gap-2 overflow-x-auto border-b border-gray-200">
        {TABS.map((t) => (
          <button key={t} onClick={() => setTab(t)} className={`whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium ${tab === t ? "border-kenya-green text-kenya-green" : "border-transparent text-gray-500 hover:text-gray-800"}`}>{t}</button>
        ))}
      </div>
      {tab === "Staff" && <StaffTab canImport={canImport} />}
      {tab === "Transfers" && <TransfersTab />}
      {tab === "Merit ranking" && <MeritTab />}
    </ProtectedRoute>
  );
}

function StaffTab({ canImport }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [station, setStation] = useState("");
  const [busy, setBusy] = useState(false);

  const load = () => api.get("/staff-directory").then((r) => setData(r.data)).catch((e) => setError(e?.response?.data?.error || "Could not load the staff directory."));
  useEffect(() => { load(); }, []);

  async function importRoster() {
    setBusy(true); setError(""); setNotice("");
    try {
      const { data: r } = await api.post("/staff-directory/import-roster");
      setNotice(`Roster loaded: ${r.created} added, ${r.filled} filled in, ${r.unchanged} already up to date. Nothing existing was overwritten.`);
      load();
    } catch (e) { setError(e?.response?.data?.error || "Could not load the roster."); } finally { setBusy(false); }
  }

  const stations = useMemo(() => [...new Set((data?.staff || []).map((s) => s.dutyStation))].sort(), [data]);
  const rows = useMemo(() => (data?.staff || []).filter((s) =>
    (!status || s.status === status) && (!station || s.dutyStation === station) &&
    (!q || `${s.fullName} ${s.pNo} ${s.designation}`.toLowerCase().includes(q.toLowerCase()))), [data, q, status, station]);

  if (!data) return error ? <p className="text-sm text-red-600">{error}</p> : <p className="text-sm text-gray-500">Loading…</p>;
  const c = data.counts;
  return (
    <div>
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Tile label="Staff" value={data.total} />
        {[["ACTIVE_OFFICE", "At the office"], ["FIELDWORK", "On fieldwork"], ["ON_LEAVE", "On leave"]].map(([k, l]) => (
          <button key={k} onClick={() => setStatus(status === k ? "" : k)} className={`rounded-lg border bg-white p-3 text-left ${status === k ? "border-kenya-green ring-1 ring-kenya-green" : "border-gray-200"}`}>
            <p className="text-xs text-gray-500">{l}</p><p className="text-2xl font-bold">{c[k]}</p>
          </button>
        ))}
      </div>
      {notice && <p className="mb-3 rounded-md bg-green-50 px-3 py-2 text-sm text-green-800">{notice}</p>}
      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}
      {canImport && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-md border border-dashed border-gray-300 bg-white p-3 text-sm">
          <span className="text-gray-600">{data.total === 0 ? "The directory is empty." : "Reload the bundled Embu roster:"} It adds missing people and fills blanks only; it never overwrites.</span>
          <button onClick={importRoster} disabled={busy} className="rounded-md bg-kenya-green px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">{busy ? "Loading…" : "Load staff roster"}</button>
        </div>
      )}
      <div className="mb-3 flex flex-wrap gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, P/No or designation" className="w-64 rounded-md border border-gray-300 px-3 py-2 text-sm" />
        <select value={station} onChange={(e) => setStation(e.target.value)} className="rounded-md border border-gray-300 px-3 py-2 text-sm">
          <option value="">All duty stations</option>{stations.map((s) => <option key={s}>{s}</option>)}
        </select>
        {(q || status || station) && <button onClick={() => { setQ(""); setStatus(""); setStation(""); }} className="text-xs font-medium text-kenya-green hover:underline">Clear filters</button>}
      </div>
      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
            <tr><th className="px-3 py-2">#</th><th className="px-3 py-2">Name</th><th className="px-3 py-2">P/No</th><th className="px-3 py-2">Designation</th><th className="px-3 py-2">Group</th><th className="px-3 py-2">Duty station</th><th className="px-3 py-2">Status</th><th className="px-3 py-2"></th></tr>
          </thead>
          <tbody>
            {rows.map((s) => (
              <tr key={s.id} className="border-t border-gray-100">
                <td className="px-3 py-2 text-gray-400">{s.serialNo}</td>
                <td className="px-3 py-2 font-medium">{s.fullName}{s.missing.length > 0 && <span title={`Missing: ${s.missing.join(", ")}`} className="ml-1 text-xs text-amber-600">●</span>}</td>
                <td className="px-3 py-2 text-gray-600">{s.pNo}</td>
                <td className="px-3 py-2">{s.designation}</td>
                <td className="px-3 py-2">{s.jobGroup || "—"}</td>
                <td className="px-3 py-2 text-gray-600">{s.dutyStation}</td>
                <td className="px-3 py-2"><StatusBadge status={s.status} /></td>
                <td className="px-3 py-2 text-right"><Link href={`/staff-directory/${s.id}`} className="text-xs font-medium text-kenya-green hover:underline">Profile</Link></td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={8} className="px-3 py-6 text-center text-gray-400">{data.total === 0 ? "No staff yet." : "No staff match these filters."}</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-gray-500"><span className="text-amber-600">●</span> next to a name means some details are still missing; open the profile to see which.</p>
    </div>
  );
}

const Tile = ({ label, value }) => <div className="rounded-lg border border-gray-200 bg-white p-3"><p className="text-xs text-gray-500">{label}</p><p className="text-2xl font-bold">{value}</p></div>;

function TransfersTab() {
  const [status, setStatus] = useState("PROPOSED");
  const [rows, setRows] = useState(null);
  const [error, setError] = useState("");
  const [notes, setNotes] = useState({});
  const load = () => api.get("/staff-directory/transfers", { params: { status } }).then((r) => setRows(r.data)).catch((e) => setError(e?.response?.data?.error || "Could not load transfers."));
  useEffect(() => { setRows(null); load(); }, [status]); // eslint-disable-line react-hooks/exhaustive-deps

  async function decide(id, decision) {
    setError("");
    try { await api.post(`/staff-directory/transfers/${id}/decision`, { decision, note: notes[id] || "" }); load(); }
    catch (e) { setError(e?.response?.data?.error || "Could not record the decision."); }
  }
  return (
    <div>
      <div className="mb-3 flex gap-2 text-xs">
        {["PROPOSED", "APPROVED", "REJECTED", "CANCELLED"].map((s) => <button key={s} onClick={() => setStatus(s)} className={`rounded-full px-3 py-1 font-medium ${status === s ? "bg-kenya-green text-white" : "bg-gray-100 text-gray-600"}`}>{s === "PROPOSED" ? "Waiting for decision" : s.charAt(0) + s.slice(1).toLowerCase()}</button>)}
      </div>
      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}
      {!rows ? <p className="text-sm text-gray-500">Loading…</p> : rows.length === 0 ? <p className="text-sm text-gray-400">Nothing here.</p> : (
        <ul className="space-y-3">
          {rows.map((t) => (
            <li key={t.id} className="rounded-lg border border-gray-200 bg-white p-4 text-sm">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p><Link href={`/staff-directory/${t.staffId}`} className="font-semibold text-kenya-green hover:underline">{t.staffName}</Link> <span className="text-gray-500">({t.staffDesignation})</span></p>
                <p className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-semibold">Merit {t.meritScore}/100</p>
              </div>
              <p className="mt-1 text-gray-700">{t.fromStation} <span className="text-gray-400">→</span> {t.toStation}</p>
              <p className="mt-1 text-xs text-gray-500">{t.justification}</p>
              <p className="mt-1 text-xs text-gray-400">Proposed {fmtDate(t.createdAt)}{t.decidedAt ? ` · decided ${fmtDate(t.decidedAt)}` : ""}{t.decisionNote ? ` · ${t.decisionNote}` : ""}</p>
              {t.canDecide && (
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <input value={notes[t.id] || ""} onChange={(e) => setNotes({ ...notes, [t.id]: e.target.value })} placeholder="Note (required to reject)" className="w-64 rounded-md border border-gray-300 px-2 py-1.5 text-xs" />
                  <button onClick={() => decide(t.id, "APPROVE")} className="rounded-md bg-kenya-green px-3 py-1.5 text-xs font-semibold text-white">Approve and move</button>
                  <button onClick={() => decide(t.id, "REJECT")} className="rounded-md border border-kenya-red px-3 py-1.5 text-xs font-semibold text-kenya-red">Reject</button>
                </div>
              )}
              {t.status === "PROPOSED" && !t.canDecide && <p className="mt-2 text-xs text-gray-500">{t.toLevel === "MINISTRY" ? "Waiting for the National Admin." : "Waiting for the county Director or the National Admin."}</p>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function MeritTab() {
  const [level, setLevel] = useState("SUB_COUNTY_OFFICE");
  const [data, setData] = useState(null);
  useEffect(() => { setData(null); api.get("/staff-directory/merit", { params: { level } }).then((r) => setData(r.data)).catch(() => setData({ ranked: [] })); }, [level]);
  return (
    <div>
      <div className="mb-3 flex gap-2 text-xs">
        <button onClick={() => setLevel("SUB_COUNTY_OFFICE")} className={`rounded-full px-3 py-1 font-medium ${level === "SUB_COUNTY_OFFICE" ? "bg-kenya-green text-white" : "bg-gray-100 text-gray-600"}`}>Sub-county offices → County office</button>
        <button onClick={() => setLevel("COUNTY_OFFICE")} className={`rounded-full px-3 py-1 font-medium ${level === "COUNTY_OFFICE" ? "bg-kenya-green text-white" : "bg-gray-100 text-gray-600"}`}>County offices → Ministry</button>
      </div>
      <p className="mb-3 max-w-2xl text-xs text-gray-500">Ranked on the 80 points the record can show: years of service (30), qualifications (25) and job group (25). The 20-point appraisal rating is added when a transfer is proposed. This is a guide for the decision-maker, not the decision.</p>
      {!data ? <p className="text-sm text-gray-500">Loading…</p> : (
        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500"><tr><th className="px-3 py-2">Rank</th><th className="px-3 py-2">Name</th><th className="px-3 py-2">Designation</th><th className="px-3 py-2">Station</th><th className="px-3 py-2">Service</th><th className="px-3 py-2">Qualifications</th><th className="px-3 py-2">Grade</th><th className="px-3 py-2">Merit /80</th><th className="px-3 py-2"></th></tr></thead>
            <tbody>
              {data.ranked.map((r, i) => (
                <tr key={r.id} className="border-t border-gray-100">
                  <td className="px-3 py-2 text-gray-400">{i + 1}</td>
                  <td className="px-3 py-2 font-medium">{r.fullName}</td>
                  <td className="px-3 py-2">{r.designation}</td>
                  <td className="px-3 py-2 text-gray-600">{r.dutyStation}</td>
                  <td className="px-3 py-2">{r.merit.parts.service.points}</td>
                  <td className="px-3 py-2">{r.merit.parts.qualifications.points}</td>
                  <td className="px-3 py-2">{r.merit.parts.grade.points}</td>
                  <td className="px-3 py-2 font-bold">{r.merit.automatic}</td>
                  <td className="px-3 py-2 text-right">{r.pending ? <span className="text-xs text-amber-700">Transfer pending</span> : <Link href={`/staff-directory/${r.id}`} className="text-xs font-medium text-kenya-green hover:underline">Open</Link>}</td>
                </tr>
              ))}
              {data.ranked.length === 0 && <tr><td colSpan={9} className="px-3 py-6 text-center text-gray-400">Nobody at this level in your area.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
