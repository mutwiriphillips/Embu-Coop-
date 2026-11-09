"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import ProtectedRoute from "../../../components/ProtectedRoute";
import api from "../../../lib/api";

const fmt = (d) => (d ? new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric", timeZone: "UTC" }) : "");
const stamp = (d) => (d ? new Date(d).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }) : "");
const inputCls = "mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900";
const Dots = ({ children, w = "min-w-[8rem]" }) => <span className={`inline-block ${w} border-b border-dotted border-gray-500 px-1 align-baseline font-medium`}>{children || " "}</span>;
const WORD = { RECOMMENDED: "Recommended", NOT_RECOMMENDED: "Not recommended", APPROVED: "Approved", NOT_APPROVED: "Not approved", SKIPPED: "Passed over by Head of Department" };

export default function LeaveFormPage() {
  const { id } = useParams();
  const [l, setL] = useState(null);
  const [error, setError] = useState("");
  const load = () => api.get(`/leave/${id}`).then((r) => setL(r.data)).catch((e) => setError(e?.response?.data?.error || "Could not load this application."));
  useEffect(() => { load(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <ProtectedRoute>
      <style>{`@media print { aside, .no-print { display: none !important; } main { padding: 0 !important; } body { background: #fff; } }`}</style>
      <div className="no-print mb-3 flex items-center gap-4">
        <Link href="/leave" className="text-xs font-medium text-kenya-green hover:underline">← Leave</Link>
        {l && <button onClick={() => window.print()} className="rounded-md border border-gray-300 px-3 py-1 text-xs">Print / Save as PDF</button>}
      </div>
      {!l ? <p className="text-sm text-gray-500">{error || "Loading…"}</p> : (
        <div className="max-w-3xl space-y-6">
          <Actions l={l} onDone={load} />
          <Form l={l} />
        </div>
      )}
    </ProtectedRoute>
  );
}

function Actions({ l, onDone }) {
  const [remarks, setRemarks] = useState("");
  const [relief, setRelief] = useState({ name: "", pNo: "", designation: "" });
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const head = l.waitingFor?.kind === "HEAD";
  const needRelief = l.needsRelief && (head || l.firstSupervisorStep);
  async function run(fn) { setError(""); setBusy(true); try { await fn(); setRemarks(""); setReason(""); onDone(); } catch (e) { setError(e?.response?.data?.error || "That didn't work."); } finally { setBusy(false); } }
  const act = (decision) => run(() => api.post(`/leave/${l.id}/act`, { decision, remarks: remarks || undefined, relief: needRelief ? { name: relief.name, pNo: relief.pNo || undefined, designation: relief.designation } : undefined }));
  if (!l.canAct && !l.canCancel && !l.canSkip) return null;
  return (
    <section className="no-print space-y-3 rounded-lg border border-gray-200 bg-white p-5">
      {l.canAct && (
        <>
          <h2 className="text-sm font-semibold">{head ? "Part III: Head of Department" : "Part II: Immediate supervisor"}</h2>
          {needRelief && (
            <div className="grid gap-3 md:grid-cols-3">
              <label className="text-xs text-gray-600">His/her duties will be performed by (name)<input className={inputCls} value={relief.name} onChange={(e) => setRelief({ ...relief, name: e.target.value })} /></label>
              <label className="text-xs text-gray-600">P/No.<input className={inputCls} value={relief.pNo} onChange={(e) => setRelief({ ...relief, pNo: e.target.value })} /></label>
              <label className="text-xs text-gray-600">Designation<input className={inputCls} value={relief.designation} onChange={(e) => setRelief({ ...relief, designation: e.target.value })} /></label>
            </div>
          )}
          <label className="block text-xs text-gray-600">Remarks (required if not {head ? "approved" : "recommended"})<textarea rows={2} className={inputCls} value={remarks} onChange={(e) => setRemarks(e.target.value)} /></label>
          <div className="flex gap-2">
            <button disabled={busy} onClick={() => act(head ? "APPROVED" : "RECOMMENDED")} className="rounded-md bg-kenya-green px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{head ? "Approve" : "Recommend"}</button>
            <button disabled={busy} onClick={() => act(head ? "NOT_APPROVED" : "NOT_RECOMMENDED")} className="rounded-md border border-red-300 px-4 py-2 text-sm font-semibold text-red-700 disabled:opacity-50">{head ? "Not approved" : "Not recommended"}</button>
          </div>
          {!head && <p className="text-xs text-gray-500">Either way the application goes on to the next level with your remarks.</p>}
        </>
      )}
      {l.canSkip && (
        <div className="border-t border-gray-100 pt-3">
          <p className="text-xs text-gray-600">Waiting for {l.waitingFor.name}. If they can&apos;t act, the Head of Department can pass over this step.</p>
          <div className="mt-2 flex gap-2"><input className={`${inputCls} mt-0`} placeholder="Reason" value={reason} onChange={(e) => setReason(e.target.value)} />
            <button disabled={busy} onClick={() => run(() => api.post(`/leave/${l.id}/skip`, { reason }))} className="whitespace-nowrap rounded-md border border-gray-300 px-3 py-2 text-sm disabled:opacity-50">Pass over</button></div>
        </div>
      )}
      {l.canCancel && <button disabled={busy} onClick={() => run(() => api.post(`/leave/${l.id}/cancel`))} className="rounded-md border border-gray-300 px-3 py-2 text-sm">Withdraw application</button>}
      {error && <p className="text-sm text-red-600">{error}</p>}
    </section>
  );
}

function Sign({ s }) {
  if (!s || !s.decision) return <p className="text-sm text-gray-500">Awaiting {s?.approverName}.</p>;
  return <p className="text-sm">Signed electronically by <strong>{s.actedByName}</strong>, {s.actedByDesignation}, on {stamp(s.actedAt)}.</p>;
}

function Form({ l }) {
  const embu = !l.applicant.countyName || l.applicant.countyName.toLowerCase() === "embu";
  const sup = l.steps.filter((s) => s.kind === "SUPERVISOR");
  const head = l.steps.find((s) => s.kind === "HEAD");
  const c = l.computation;
  return (
    <article className="space-y-4 rounded-lg border border-gray-300 bg-white p-8 text-sm leading-7 text-gray-900">
      <header className="border-b-2 border-gray-700 pb-3 text-center">
        <div className="text-lg font-bold tracking-wide">{embu ? "EMBU COUNTY GOVERNMENT" : `${(l.applicant.countyName || "COUNTY").toUpperCase()} COUNTY GOVERNMENT`}</div>
        {embu ? (<>
          <div className="mt-1 text-xs font-bold">DEPARTMENT OF AGRICULTURE, LIVESTOCK, FISHERIES AND COOPERATIVE DEVELOPMENT</div>
          <div className="text-xs font-bold">P.O. BOX 36-60100 &nbsp; Tel: 068-30558-161</div>
          <div className="text-xs font-bold">Emails: cecalfc@gmail.com, agricultureco@yahoo.com</div>
        </>) : <div className="mt-1 text-xs font-bold">DEPARTMENT OF AGRICULTURE AND COOPERATIVE DEVELOPMENT</div>}
      </header>
      <div className="text-center text-xs tracking-wide">LEAVE APPLICATION FORM &nbsp;·&nbsp; <strong>{{ PENDING: "IN PROGRESS", APPROVED: "APPROVED", REJECTED: "NOT APPROVED", CANCELLED: "WITHDRAWN" }[l.status]}</strong></div>
      <div>The County Secretary<br />P O Box 36-60100<br /><u>{embu ? "EMBU" : (l.applicant.countyName || "").toUpperCase()}</u></div>
      <div>Thro&apos;{l.thro.length === 0 && <span className="ml-2 text-xs text-gray-500">(direct to the Head of Department)</span>}
        {l.thro.map((t, i) => <div key={i}><Dots w="min-w-[20rem]">{t.name}, {t.designation}</Dots></div>)}
      </div>

      <h3 className="pt-2 font-bold">PART I</h3>
      <p>Name <Dots w="min-w-[14rem]">{l.applicant.name}</Dots> P/No. <Dots>{l.applicant.pNo}</Dots></p>
      <p>Designation <Dots w="min-w-[12rem]">{l.applicant.designation}</Dots> Department <Dots w="min-w-[12rem]">{embu ? "Agriculture, Livestock, Fisheries & Cooperative Development" : "Agriculture & Cooperative Development"}</Dots></p>
      <p>I wish to apply for <strong>{l.leaveType}</strong> leave for <Dots w="min-w-[4rem]">{l.days}</Dots> days beginning on <Dots>{fmt(l.startDate)}</Dots> to <Dots>{fmt(l.endDate)}</Dots></p>
      <p>During my leave, my address will be (Mobile No.) <Dots>{l.mobile}</Dots></p>
      <p>I understand that I will require permission should I desire to spend leave outside Kenya in terms of Personnel Circular No. 6 of 15 January 1967 <span className="text-xs text-gray-500">{l.outsideKenyaAck ? "(acknowledged)" : ""}</span></p>
      <p>Signature of applicant <Dots w="min-w-[16rem]">Applied electronically by {l.applicant.name}</Dots> Date <Dots>{fmt(l.createdAt)}</Dots></p>

      <h3 className="pt-2 font-bold">PART II</h3>
      <p className="text-xs italic">(To be completed by immediate supervisor{sup.length > 1 ? "; each supervisor in turn recommends" : ""})</p>
      {sup.length === 0 && <p className="text-xs text-gray-500">No supervisor between the applicant and the Head of Department.</p>}
      {sup.map((s) => (
        <div key={s.stepNo} className="space-y-1 border-l-2 border-gray-200 pl-3">
          <p>Leave <strong>{s.decision === "RECOMMENDED" ? "Recommended" : s.decision === "NOT_RECOMMENDED" ? "Not Recommended" : s.decision === "SKIPPED" ? "— passed over" : "Recommended / Not Recommended"}</strong></p>
          <p>Remarks <Dots w="min-w-[24rem]">{s.remarks}</Dots></p>
          {s.stepNo === 1 && <p>His/her duties will be performed by: Name <Dots>{l.relief.name}</Dots> P/No. and Designation <Dots>{[l.relief.pNo, l.relief.designation].filter(Boolean).join(", ")}</Dots></p>}
          <p>Name <Dots>{s.approverName}</Dots> Designation <Dots>{s.approverDesignation}</Dots> Date <Dots>{fmt(s.actedAt)}</Dots></p>
          <p>Signature (immediate supervisor) <Sign s={s} /></p>
          {s.decision === "SKIPPED" && <p className="text-xs text-gray-500">{WORD.SKIPPED}: {s.remarks}</p>}
        </div>
      ))}
      {l.chainSkipped && <p className="text-xs text-gray-500">Passed over (no login on the system): {l.chainSkipped}.</p>}

      <h3 className="pt-2 font-bold">PART III: LEAVE APPROVAL</h3>
      <p className="text-xs italic">(To be completed by Head of Department)</p>
      <p>Leave <strong>{head?.decision === "APPROVED" ? "Approved" : head?.decision === "NOT_APPROVED" ? "Not Approved" : "Approval / Not Approved"}</strong></p>
      {head?.remarks && <p>Remarks <Dots w="min-w-[24rem]">{head.remarks}</Dots></p>}
      <p>Name <Dots w="min-w-[14rem]">{head?.actedByName || head?.approverName}</Dots> Date <Dots>{fmt(head?.actedAt)}</Dots></p>
      <p>Signature &amp; stamp <Sign s={head} /></p>

      <h3 className="pt-2 font-bold">PART IV: LEAVE COMPUTATION <span className="text-xs font-normal italic">(for official use only)</span></h3>
      {c ? (
        <div className="space-y-1">
          <p>Leave brought forward from the previous year <Dots>{c.broughtForward} days</Dots></p>
          <p>Leave entitlement current year <Dots>{c.entitlement} days</Dots></p>
          <p>Leave already taken within the current year <Dots>{c.taken} days</Dots></p>
          <p>Leave now approved with effect from <Dots>{fmt(l.startDate)}</Dots> <Dots>{c.deducted} days</Dots></p>
          <p>Balance carried forward <Dots>{c.carried} days</Dots> <span className="text-xs text-gray-600">(balance {c.balance}; {c.forfeited} forfeited)</span></p>
          <p className="text-xs text-gray-500">Computed by the system at approval on {stamp(l.decidedAt)}.</p>
        </div>
      ) : <p className="text-xs text-gray-500">Computed by the system when the Head of Department approves.</p>}

      <p className="border-t border-gray-300 pt-3 text-xs italic">
        Please note that existing civil service regulations do not allow a civil servant to carry forward more than half of his/her leave entitlement to the following leave year. Any leave day(s) carried forward in excess of fifteen (15 days) will automatically be forfeited.
      </p>
    </article>
  );
}
