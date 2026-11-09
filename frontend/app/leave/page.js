"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import ProtectedRoute from "../../components/ProtectedRoute";
import { useAuth } from "../../context/AuthContext";
import api from "../../lib/api";

const inputCls = "mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900";
const fmt = (d) => (d ? new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }) : "—");
const STATUS = { PENDING: "bg-amber-100 text-amber-800", APPROVED: "bg-green-100 text-green-800", REJECTED: "bg-red-100 text-red-800", CANCELLED: "bg-gray-100 text-gray-600" };
const STATUS_LABEL = { PENDING: "In progress", APPROVED: "Approved", REJECTED: "Not approved", CANCELLED: "Withdrawn" };

export default function LeavePage() {
  const { user } = useAuth();
  const senior = user?.role === "NATIONAL_ADMIN" || user?.role === "DIRECTOR";
  const tabs = [["mine", "My leave"], ["inbox", "For my action"], ["involved", "Involved in"], ...(senior ? [["all", "Everyone"]] : [])];
  const [view, setView] = useState("mine");
  const [rows, setRows] = useState(null);
  const [counts, setCounts] = useState(0);
  const [error, setError] = useState("");
  const load = () => { setRows(null); api.get(`/leave?view=${view}`).then((r) => setRows(r.data)).catch((e) => setError(e?.response?.data?.error || "Could not load leave.")); };
  useEffect(load, [view]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { api.get("/leave?view=inbox").then((r) => setCounts(r.data.length)).catch(() => {}); }, [view]);

  return (
    <ProtectedRoute>
      <h1 className="mb-1 text-2xl font-bold">Leave</h1>
      <p className="mb-4 text-sm text-gray-600">Applications follow the chain of command in the Staff Directory: each supervisor recommends, then the Head of Department approves.</p>
      <Apply onDone={() => { setView("mine"); load(); }} />
      <div className="mb-3 mt-6 flex gap-1 border-b border-gray-200">
        {tabs.map(([k, l]) => (
          <button key={k} onClick={() => setView(k)} className={`px-3 py-2 text-sm font-medium ${view === k ? "border-b-2 border-kenya-green text-kenya-green" : "text-gray-600"}`}>
            {l}{k === "inbox" && counts > 0 && <span className="ml-1 rounded-full bg-red-600 px-1.5 text-xs text-white">{counts}</span>}
          </button>
        ))}
      </div>
      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}
      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500"><tr>
            <th className="px-4 py-2">Applicant</th><th className="px-4 py-2">Type</th><th className="px-4 py-2">Dates</th><th className="px-4 py-2">Days</th><th className="px-4 py-2">Status</th><th className="px-4 py-2">Waiting for</th><th className="px-4 py-2" />
          </tr></thead>
          <tbody>
            {!rows && <tr><td className="px-4 py-4 text-gray-500" colSpan={7}>Loading…</td></tr>}
            {rows && rows.length === 0 && <tr><td className="px-4 py-4 text-gray-500" colSpan={7}>Nothing here.</td></tr>}
            {rows && rows.map((l) => (
              <tr key={l.id} className="border-t border-gray-100">
                <td className="px-4 py-2">{l.applicant.name}</td>
                <td className="px-4 py-2">{l.leaveType}</td>
                <td className="px-4 py-2">{fmt(l.startDate)} – {fmt(l.endDate)}</td>
                <td className="px-4 py-2">{l.days}</td>
                <td className="px-4 py-2"><span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS[l.status]}`}>{STATUS_LABEL[l.status]}</span></td>
                <td className="px-4 py-2 text-gray-600">{l.waitingFor ? `${l.waitingFor.name}` : "—"}</td>
                <td className="px-4 py-2 text-right"><Link className="font-medium text-kenya-green hover:underline" href={`/leave/${l.id}`}>{l.canAct ? "Review" : "Open"}</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </ProtectedRoute>
  );
}

function Apply({ onDone }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ leaveType: "Annual", startDate: "", endDate: "", mobile: "", outsideKenyaAck: false });
  const [pv, setPv] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) api.get("/leave/preview", { params: { leaveType: form.leaveType, startDate: form.startDate || "2000-01-01", endDate: form.endDate || "2000-01-01" } }).then((r) => setPv(r.data)).catch(() => {}); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!open || !form.startDate || !form.endDate) return;
    api.get("/leave/preview", { params: { leaveType: form.leaveType, startDate: form.startDate, endDate: form.endDate } }).then((r) => setPv(r.data)).catch(() => {});
  }, [open, form.leaveType, form.startDate, form.endDate]);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value });
  const bal = pv?.balance;
  const over = form.leaveType === "Annual" && pv?.days != null && bal && pv.days > bal.available;
  const ready = useMemo(() => form.startDate && form.endDate && form.mobile && form.outsideKenyaAck && !over, [form, over]);
  async function submit(e) {
    e.preventDefault(); setError(""); setBusy(true);
    try { await api.post("/leave", form); setOpen(false); setForm({ leaveType: "Annual", startDate: "", endDate: "", mobile: "", outsideKenyaAck: false }); onDone(); }
    catch (err) { setError(err?.response?.data?.error || (err?.response?.data?.issues && "Please check the form.") || "Could not submit."); } finally { setBusy(false); }
  }
  if (!open) return <button onClick={() => setOpen(true)} className="rounded-md bg-kenya-green px-4 py-2 text-sm font-semibold text-white">Apply for leave</button>;
  return (
    <form onSubmit={submit} className="max-w-3xl space-y-4 rounded-lg border border-gray-200 bg-white p-5">
      <h2 className="text-sm font-semibold">Leave application: Part I</h2>
      {pv && pv.linked === false && <p className="rounded-md bg-amber-50 p-3 text-sm text-amber-800">{pv.message}</p>}
      {pv?.linked && <p className="text-sm text-gray-700">{pv.staff.name} · P/No. {pv.staff.pNo} · {pv.staff.designation}</p>}
      {bal && form.leaveType === "Annual" && (
        <div className="rounded-md bg-gray-50 p-3 text-sm text-gray-700">
          {bal.year}: <strong>{bal.available}</strong> days available ({bal.broughtForward} brought forward + {bal.entitlement} entitlement, {bal.taken} taken, {bal.pending} awaiting approval).
          <div className="mt-1 text-xs text-gray-500">Existing regulations allow carrying forward no more than half the entitlement ({bal.carryCap} days) and never more than {bal.maxCarryDays}; the excess is forfeited automatically.</div>
        </div>
      )}
      <div className="grid gap-3 md:grid-cols-4">
        <label className="text-xs text-gray-600">Leave type
          <select className={inputCls} value={form.leaveType} onChange={set("leaveType")}><option>Annual</option><option>Maternity</option><option>Paternity</option></select>
        </label>
        <label className="text-xs text-gray-600">Beginning on<input required type="date" className={inputCls} value={form.startDate} onChange={set("startDate")} /></label>
        <label className="text-xs text-gray-600">To<input required type="date" className={inputCls} value={form.endDate} onChange={set("endDate")} /></label>
        <label className="text-xs text-gray-600">Mobile No. during leave<input required className={inputCls} placeholder="0712 345 678" value={form.mobile} onChange={set("mobile")} /></label>
      </div>
      {pv?.days != null && form.startDate && form.endDate && (
        <p className={`text-sm ${over ? "text-red-600" : "text-gray-700"}`}>
          {pv.days} {form.leaveType === "Annual" ? "working day(s)" : "calendar day(s)"}{over ? ` — more than the ${bal.available} available` : ""}
        </p>
      )}
      {pv?.thro && (
        <div className="text-sm text-gray-700">
          <div className="text-xs font-medium uppercase text-gray-500">Thro&apos; (your application will go to)</div>
          <ol className="mt-1 list-decimal pl-5">
            {pv.thro.map((s, i) => <li key={i}>{s.name}{s.designation ? ` — ${s.designation}` : ""} <span className="text-xs text-gray-500">({s.kind === "HEAD" ? "approves" : "recommends"})</span></li>)}
          </ol>
          {pv.skipped?.length > 0 && <p className="mt-1 text-xs text-amber-700">No login on the system, so passed over: {pv.skipped.join(", ")}.</p>}
        </div>
      )}
      {pv?.chainError && <p className="text-sm text-red-600">{pv.chainError}</p>}
      <label className="flex items-start gap-2 text-sm text-gray-700">
        <input type="checkbox" className="mt-1" checked={form.outsideKenyaAck} onChange={set("outsideKenyaAck")} />
        <span>I understand that I will require permission should I desire to spend leave outside Kenya in terms of Personnel Circular No. 6 of 15 January 1967.</span>
      </label>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex gap-2">
        <button disabled={busy || !ready || pv?.linked === false} className="rounded-md bg-kenya-green px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy ? "Submitting…" : "Submit application"}</button>
        <button type="button" onClick={() => setOpen(false)} className="rounded-md border border-gray-300 px-4 py-2 text-sm">Cancel</button>
      </div>
    </form>
  );
}
