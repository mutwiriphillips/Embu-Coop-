"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import ProtectedRoute from "../../../components/ProtectedRoute";
import StatusBadge, { STATUS_OPTIONS } from "../../../components/StatusBadge";
import api from "../../../lib/api";

const fmtDate = (d) => (d ? new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "—");
const LEVEL = { SUB_COUNTY_OFFICE: "Sub-county office", COUNTY_OFFICE: "County office", MINISTRY: "Ministry" };
const inputCls = "mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900";
const FIELD_LABEL = { jobGroup: "job group", age: "age", phoneNumber: "phone number", email: "email", yearEmployed: "year employed", qualifications: "qualifications" };

export default function StaffProfilePage() {
  const { id } = useParams();
  const [p, setP] = useState(null);
  const [error, setError] = useState("");
  const load = () => api.get(`/staff-directory/${id}`).then((r) => setP(r.data)).catch((e) => setError(e?.response?.data?.error || "Could not load this profile."));
  useEffect(() => { load(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <ProtectedRoute>
      <Link href="/staff-directory" className="text-xs font-medium text-kenya-green hover:underline">← Staff Directory</Link>
      {!p ? <p className="mt-3 text-sm text-gray-500">{error || "Loading…"}</p> : (
        <div className="mt-2 max-w-3xl space-y-6">
          <ProfileCard p={p} onSaved={load} />
          <StatusPanel p={p} onSaved={load} />
          <TransferPanel p={p} onSaved={load} />
        </div>
      )}
    </ProtectedRoute>
  );
}

function Row({ label, children }) {
  return <div className="grid grid-cols-3 gap-2 border-t border-gray-100 py-2 text-sm first:border-0"><dt className="text-gray-500">{label}</dt><dd className="col-span-2 break-words text-gray-900">{children || <span className="text-gray-400">Not recorded</span>}</dd></div>;
}

function ProfileCard({ p, onSaved }) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({});
  const [error, setError] = useState("");
  const start = () => { setForm({ jobGroup: p.jobGroup || "", age: p.age ?? "", phoneNumber: p.phoneNumber || "", email: p.email || "", yearEmployed: p.yearEmployed ?? "", qualifications: p.qualifications || "", remarks: p.remarks || "" }); setEditing(true); setError(""); };
  async function save(e) {
    e.preventDefault(); setError("");
    const body = {
      jobGroup: form.jobGroup || null, age: form.age === "" ? null : Number(form.age), phoneNumber: form.phoneNumber || null, email: form.email || null,
      yearEmployed: form.yearEmployed === "" ? null : Number(form.yearEmployed), qualifications: form.qualifications || null,
      ...(p.remarks !== undefined ? { remarks: form.remarks || null } : {}),
    };
    try { await api.patch(`/staff-directory/${p.id}`, body); setEditing(false); onSaved(); }
    catch (err) { setError(err?.response?.data?.error || "Could not save."); }
  }
  return (
    <section className="rounded-lg border border-gray-200 bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold">{p.fullName}</h1>
          <p className="text-sm text-gray-600">{p.designation}</p>
        </div>
        {p.canEdit && !editing && <button onClick={start} className="text-xs font-medium text-kenya-green hover:underline">Edit details</button>}
      </div>
      {p.missing.length > 0 && !editing && (
        <p className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">Still missing: {p.missing.map((m) => FIELD_LABEL[m]).join(", ")}.{p.canEdit ? " Use Edit details to fill them in." : ""}</p>
      )}
      {!editing ? (
        <dl className="mt-3">
          <Row label="P/No">{p.pNo}</Row>
          <Row label="Job group">{p.jobGroup}</Row>
          <Row label="Age">{p.age}</Row>
          <Row label="Duty station">{p.dutyStation} <span className="text-xs text-gray-500">({LEVEL[p.dutyLevel]})</span></Row>
          <Row label="Phone">{p.phoneNumber}</Row>
          <Row label="Email">{p.email}</Row>
          <Row label="Year employed">{p.yearEmployed}</Row>
          <Row label="Qualifications">{p.qualifications}</Row>
          {p.remarks !== undefined && <Row label="Remarks">{p.remarks}</Row>}
          <Row label="Sign-in account">{p.hasAccount ? "Linked" : <span className="text-gray-500">None yet</span>}</Row>
        </dl>
      ) : (
        <form onSubmit={save} className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="text-xs text-gray-600">Job group<input className={inputCls} value={form.jobGroup} onChange={(e) => setForm({ ...form, jobGroup: e.target.value })} maxLength={5} /></label>
          <label className="text-xs text-gray-600">Age<input type="number" className={inputCls} value={form.age} onChange={(e) => setForm({ ...form, age: e.target.value })} /></label>
          <label className="text-xs text-gray-600">Phone (10 digits, starts with 0)<input className={inputCls} value={form.phoneNumber} onChange={(e) => setForm({ ...form, phoneNumber: e.target.value })} /></label>
          <label className="text-xs text-gray-600">Email<input type="email" className={inputCls} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></label>
          <label className="text-xs text-gray-600">Year employed<input type="number" className={inputCls} value={form.yearEmployed} onChange={(e) => setForm({ ...form, yearEmployed: e.target.value })} /></label>
          <label className="text-xs text-gray-600 sm:col-span-2">Qualifications<textarea rows={2} className={inputCls} value={form.qualifications} onChange={(e) => setForm({ ...form, qualifications: e.target.value })} /></label>
          {p.remarks !== undefined && <label className="text-xs text-gray-600 sm:col-span-2">Remarks (restricted to Director and National Admin)<input className={inputCls} value={form.remarks} onChange={(e) => setForm({ ...form, remarks: e.target.value })} /></label>}
          {error && <p className="text-sm text-red-600 sm:col-span-2">{error}</p>}
          <div className="flex gap-3 sm:col-span-2"><button className="rounded-md bg-kenya-green px-4 py-2 text-sm font-semibold text-white">Save</button><button type="button" onClick={() => setEditing(false)} className="text-sm text-gray-500 hover:underline">Cancel</button></div>
        </form>
      )}
    </section>
  );
}

function StatusPanel({ p, onSaved }) {
  const [form, setForm] = useState({ status: p.status, note: "", until: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function save(e) {
    e.preventDefault(); setError(""); setBusy(true);
    try { await api.put(`/staff-directory/${p.id}/status`, form); setForm({ ...form, note: "", until: "" }); onSaved(); }
    catch (err) { setError(err?.response?.data?.error || "Could not update the status."); }
    finally { setBusy(false); }
  }
  const today = new Date().toISOString().slice(0, 10);
  return (
    <section className="rounded-lg border border-gray-200 bg-white p-5">
      <h2 className="text-sm font-semibold">Current status</h2>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <StatusBadge status={p.status} />
        <span className="text-xs text-gray-500">since {fmtDate(p.statusSince)}{p.statusUntil && p.status !== "ACTIVE_OFFICE" ? ` · until ${fmtDate(p.statusUntil)}` : ""}</span>
      </div>
      {p.statusNote && <p className="mt-1 text-sm text-gray-700">{p.statusNote}</p>}
      {p.statusEnded && <p className="mt-1 text-xs text-gray-500">The recorded leave or fieldwork has ended, so they show as back at the office.</p>}
      {p.canManage ? (
        <form onSubmit={save} className="mt-4 grid gap-3 sm:grid-cols-3">
          <label className="text-xs text-gray-600">Change to
            <select className={inputCls} value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
              {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </label>
          <label className="text-xs text-gray-600">Until (optional)
            <input type="date" min={today} disabled={form.status === "ACTIVE_OFFICE"} className={inputCls} value={form.until} onChange={(e) => setForm({ ...form, until: e.target.value })} />
          </label>
          <label className="text-xs text-gray-600">Note (optional)
            <input maxLength={200} placeholder="e.g. audits in Siakago" className={inputCls} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
          </label>
          {error && <p className="text-sm text-red-600 sm:col-span-3">{error}</p>}
          <div className="sm:col-span-3"><button disabled={busy} className="rounded-md bg-kenya-green px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy ? "Saving…" : "Update status"}</button></div>
        </form>
      ) : <p className="mt-3 text-xs text-gray-500">Only the Director, the National Admin, or the Sub-County Officer for this person's sub-county can change this.</p>}
      {p.history.length > 0 && (
        <details className="mt-4 text-xs text-gray-600">
          <summary className="cursor-pointer font-medium">Status history ({p.history.length})</summary>
          <ul className="mt-2 space-y-1">{p.history.map((h) => <li key={h.id}>{fmtDate(h.since)}: <strong>{STATUS_OPTIONS.find((o) => o.value === h.status)?.label}</strong>{h.until ? ` until ${fmtDate(h.until)}` : ""}{h.note ? ` · ${h.note}` : ""}</li>)}</ul>
        </details>
      )}
    </section>
  );
}

function MeritBars({ merit }) {
  const parts = [["Years of service", merit.parts.service], ["Qualifications", merit.parts.qualifications], ["Job group", merit.parts.grade], ["Appraisal", merit.parts.appraisal]];
  return (
    <div className="space-y-2">
      {parts.map(([label, x]) => (
        <div key={label}>
          <div className="flex justify-between text-xs"><span>{label} <span className="text-gray-400">({x.label})</span></span><span className="font-medium">{x.points} / {x.max}</span></div>
          <div className="mt-0.5 h-1.5 rounded bg-gray-100"><div className="h-1.5 rounded bg-kenya-green" style={{ width: `${Math.min(100, (x.points / x.max) * 100)}%` }} /></div>
        </div>
      ))}
    </div>
  );
}

function TransferPanel({ p, onSaved }) {
  const t = p.transfer;
  const [form, setForm] = useState({ toStation: t.options[0] || "", appraisalScore: "", justification: "", effectiveDate: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const toLabel = t.nextLevel === "MINISTRY" ? "the Ministry" : "a county office";
  async function propose(e) {
    e.preventDefault(); setError(""); setBusy(true);
    try {
      await api.post(`/staff-directory/${p.id}/transfers`, { toStation: form.toStation, justification: form.justification, effectiveDate: form.effectiveDate || "", appraisalScore: form.appraisalScore === "" ? null : Number(form.appraisalScore) });
      onSaved();
    } catch (err) { setError(err?.response?.data?.error || "Could not propose the transfer."); } finally { setBusy(false); }
  }
  async function cancel() { try { await api.post(`/staff-directory/transfers/${t.open.id}/cancel`); onSaved(); } catch (err) { setError(err?.response?.data?.error || "Could not cancel."); } }

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-5">
      <h2 className="text-sm font-semibold">Transfer and merit</h2>
      {!t.nextLevel ? (
        <p className="mt-2 text-sm text-gray-600">Posted at the Ministry: there is no higher level to transfer to.</p>
      ) : (
        <>
          <p className="mt-1 text-xs text-gray-500">{LEVEL[p.dutyLevel]} → {t.nextLevel === "MINISTRY" ? "Ministry" : "County office"}. Merit so far: <strong>{t.merit.total} / 100</strong> (the appraisal part is added when a transfer is proposed).</p>
          <div className="mt-3 max-w-md"><MeritBars merit={t.merit} /></div>
          {t.open ? (
            <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm">
              <p className="font-medium">Transfer waiting for a decision</p>
              <p className="mt-1">{t.open.fromStation} → {t.open.toStation} · merit {t.open.meritScore}/100</p>
              <p className="mt-1 text-xs text-gray-600">{t.open.justification}</p>
              <p className="mt-1 text-xs text-gray-500">{t.open.toLevel === "MINISTRY" ? "The National Admin decides this one." : "The county Director (or the National Admin) decides this one."} Decisions are made under <Link href="/staff-directory" className="underline">Transfers</Link>.</p>
              <button onClick={cancel} className="mt-2 text-xs font-medium text-kenya-red hover:underline">Cancel this proposal</button>
            </div>
          ) : t.canPropose ? (
            <form onSubmit={propose} className="mt-4 grid gap-3 sm:grid-cols-2">
              <p className="text-xs font-medium text-gray-700 sm:col-span-2">Propose a transfer to {toLabel}</p>
              <label className="text-xs text-gray-600">Posting
                {t.nextLevel === "MINISTRY" ? <input readOnly className={`${inputCls} bg-gray-50`} value={t.options[0]} /> : (
                  <select className={inputCls} value={form.toStation} onChange={(e) => setForm({ ...form, toStation: e.target.value })}>{t.options.map((o) => <option key={o}>{o}</option>)}</select>
                )}
              </label>
              <label className="text-xs text-gray-600">Appraisal rating (0 to 20, optional)
                <input type="number" min={0} max={20} step="0.5" className={inputCls} value={form.appraisalScore} onChange={(e) => setForm({ ...form, appraisalScore: e.target.value })} />
              </label>
              <label className="text-xs text-gray-600 sm:col-span-2">Reason for the transfer
                <textarea rows={2} required minLength={10} className={inputCls} value={form.justification} onChange={(e) => setForm({ ...form, justification: e.target.value })} />
              </label>
              <label className="text-xs text-gray-600">Intended date (optional)
                <input type="date" className={inputCls} value={form.effectiveDate} onChange={(e) => setForm({ ...form, effectiveDate: e.target.value })} />
              </label>
              {error && <p className="text-sm text-red-600 sm:col-span-2">{error}</p>}
              <div className="sm:col-span-2"><button disabled={busy} className="rounded-md bg-kenya-green px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy ? "Sending…" : "Propose transfer"}</button></div>
            </form>
          ) : <p className="mt-3 text-xs text-gray-500">You can view the merit score here, but only someone responsible for this person can propose a transfer.</p>}
        </>
      )}
      {p.transfers.filter((x) => x.status !== "PROPOSED").length > 0 && (
        <details className="mt-4 text-xs text-gray-600">
          <summary className="cursor-pointer font-medium">Past transfers</summary>
          <ul className="mt-2 space-y-1">{p.transfers.filter((x) => x.status !== "PROPOSED").map((x) => <li key={x.id}>{fmtDate(x.createdAt)}: {x.fromStation} → {x.toStation} · <strong>{x.status.toLowerCase()}</strong>{x.decisionNote ? ` · ${x.decisionNote}` : ""}</li>)}</ul>
        </details>
      )}
    </section>
  );
}
