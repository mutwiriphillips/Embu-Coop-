"use client";

import { Fragment, useEffect, useState } from "react";
import ProtectedRoute from "../../components/ProtectedRoute";
import { useAuth } from "../../context/AuthContext";
import api from "../../lib/api";
import { AuthedImage, openFile, useFileList, ACCEPT, HINT } from "../../lib/files";

export default function FieldOpsPage() {
  const { user } = useAuth();
  const [visits, setVisits] = useState([]);
  const [cooperatives, setCooperatives] = useState([]);
  const [form, setForm] = useState({ cooperativeId: "", plannedDate: "", purpose: "" });
  const [error, setError] = useState("");
  const [openVisit, setOpenVisit] = useState(null);

  function load() {
    api.get("/field-ops/visits").then((res) => setVisits(res.data)).catch(() => {});
    api.get("/cooperatives").then((res) => setCooperatives(res.data)).catch(() => {});
  }

  useEffect(load, []);

  async function planVisit(e) {
    e.preventDefault();
    setError("");
    try {
      await api.post("/field-ops/visits", form);
      setForm({ cooperativeId: "", plannedDate: "", purpose: "" });
      load();
    } catch (err) {
      setError(err?.response?.data?.error || "Failed to plan visit");
    }
  }

  async function decide(id, approve) {
    await api.post(`/field-ops/visits/${id}/decision`, { approve });
    load();
  }

  const canApprove = user?.role === "DIRECTOR" || user?.role === "SUBCOUNTY_OFFICER";

  return (
    <ProtectedRoute>
      <h1 className="mb-6 text-2xl font-bold">Field Visit Planner</h1>

      <form onSubmit={planVisit} className="mb-6 grid grid-cols-2 gap-3 rounded-lg border border-gray-200 bg-white p-4 md:grid-cols-4">
        <select required className="rounded-md border border-gray-300 px-3 py-2 text-sm md:col-span-2"
          value={form.cooperativeId} onChange={(e) => setForm({ ...form, cooperativeId: e.target.value })}>
          <option value="">Select cooperative…</option>
          {cooperatives.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <input required type="date" className="rounded-md border border-gray-300 px-3 py-2 text-sm"
          value={form.plannedDate} onChange={(e) => setForm({ ...form, plannedDate: e.target.value })} />
        <input required placeholder="Purpose of visit" className="rounded-md border border-gray-300 px-3 py-2 text-sm"
          value={form.purpose} onChange={(e) => setForm({ ...form, purpose: e.target.value })} />
        <button type="submit" className="rounded-md bg-kenya-green px-3 py-2 text-sm font-semibold text-white md:col-span-4">
          Plan Visit
        </button>
      </form>
      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
            <tr>
              <th className="px-4 py-2">Officer</th>
              <th className="px-4 py-2">Cooperative</th>
              <th className="px-4 py-2">Date</th>
              <th className="px-4 py-2">Purpose</th>
              <th className="px-4 py-2">Status</th>
              {canApprove && <th className="px-4 py-2">Actions</th>}
            </tr>
          </thead>
          <tbody>
            {visits.map((v) => (
              <Fragment key={v.id}>
              <tr className="border-t border-gray-100">
                <td className="px-4 py-2">{v.officer?.fullName}</td>
                <td className="px-4 py-2">{v.cooperative?.name}</td>
                <td className="px-4 py-2">{new Date(v.plannedDate).toLocaleDateString()}</td>
                <td className="px-4 py-2">{v.purpose}</td>
                <td className="px-4 py-2">
                  {v.status}
                  {["AUTHORIZED", "COMPLETED"].includes(v.status) && (
                    <button onClick={() => setOpenVisit(openVisit === v.id ? null : v.id)}
                      className="ml-2 text-xs font-medium text-kenya-green hover:underline">
                      {openVisit === v.id ? "Close" : v.status === "COMPLETED" ? "Report & photos" : v.officer?.id === user?.id ? "File report" : "Details"}
                    </button>
                  )}
                </td>
                {canApprove && (
                  <td className="px-4 py-2 space-x-2">
                    {v.status === "PLANNED" && v.officer?.id !== user?.id && (
                      <>
                        <button onClick={() => decide(v.id, true)} className="text-xs font-medium text-kenya-green hover:underline">Authorize</button>
                        <button onClick={() => decide(v.id, false)} className="text-xs font-medium text-red-600 hover:underline">Reject</button>
                      </>
                    )}
                  </td>
                )}
              </tr>
              {openVisit === v.id && (
                <tr className="border-t border-gray-100 bg-gray-50">
                  <td colSpan={6} className="px-4 py-3">
                    <VisitReportPanel visit={v} isOfficer={v.officer?.id === user?.id} onChange={load} />
                  </td>
                </tr>
              )}
              </Fragment>
            ))}
            {visits.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-6 text-center text-gray-400">No field visits planned.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </ProtectedRoute>
  );
}

// A visit's report and photos. The visiting officer files the report once the
// visit is authorised, and adds photos as evidence; reviewers can read both.
function VisitReportPanel({ visit, isOfficer, onChange }) {
  const { files, reload } = useFileList(api, { visitId: visit.id }, [visit.id]);
  const [form, setForm] = useState({ narrative: "", achievements: "", nextActions: "" });
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  async function fileReport(e) {
    e.preventDefault();
    setMsg(""); setBusy(true);
    try {
      await api.post(`/field-ops/visits/${visit.id}/report`, {
        narrative: form.narrative,
        ...(form.achievements ? { achievements: form.achievements } : {}),
        ...(form.nextActions ? { nextActions: form.nextActions } : {}),
      });
      onChange();
    } catch (err) {
      setMsg(err?.response?.data?.error || "Failed to file the report");
    } finally { setBusy(false); }
  }

  async function addPhotos(list) {
    if (!list?.length) return;
    setMsg(""); setBusy(true);
    try {
      const data = new FormData();
      Array.from(list).slice(0, 5).forEach((f) => data.append("photos", f));
      await api.post(`/field-ops/visits/${visit.id}/photos`, data);
      reload();
    } catch (err) {
      setMsg(err?.response?.data?.error || "Upload failed");
    } finally { setBusy(false); }
  }

  const r = visit.report;
  return (
    <div className="space-y-3 text-sm">
      {r ? (
        <div>
          <p className="text-xs font-semibold text-gray-600">Report</p>
          <p className="whitespace-pre-line">{r.narrative}</p>
          {r.achievements && <p className="mt-1"><span className="text-xs font-semibold text-gray-600">Achievements: </span>{r.achievements}</p>}
          {r.nextActions && <p className="mt-1"><span className="text-xs font-semibold text-gray-600">Next actions: </span>{r.nextActions}</p>}
        </div>
      ) : isOfficer ? (
        <form onSubmit={fileReport} className="grid gap-2">
          <textarea required rows={3} placeholder="What happened on the visit?" className="rounded-md border border-gray-300 px-3 py-2"
            value={form.narrative} onChange={(e) => setForm({ ...form, narrative: e.target.value })} />
          <input placeholder="Achievements (optional)" className="rounded-md border border-gray-300 px-3 py-2"
            value={form.achievements} onChange={(e) => setForm({ ...form, achievements: e.target.value })} />
          <input placeholder="Next actions (optional)" className="rounded-md border border-gray-300 px-3 py-2"
            value={form.nextActions} onChange={(e) => setForm({ ...form, nextActions: e.target.value })} />
          <button disabled={busy} className="justify-self-start rounded-md bg-kenya-green px-4 py-2 font-semibold text-white disabled:opacity-50">File report</button>
        </form>
      ) : (
        <p className="text-gray-400">The visiting officer hasn&apos;t filed a report yet.</p>
      )}

      <div>
        <p className="mb-1 text-xs font-semibold text-gray-600">Photos</p>
        <div className="flex flex-wrap items-center gap-2">
          {files.map((f) => (
            <button key={f.id} onClick={() => openFile(api, f.id)} title={f.fileName}>
              <AuthedImage client={api} fileId={f.id} alt="Visit photo" className="h-20 w-24 rounded" />
            </button>
          ))}
          {isOfficer && (
            <label className="flex h-20 w-24 cursor-pointer flex-col items-center justify-center rounded border border-dashed border-gray-300 text-center text-[11px] text-gray-500 hover:border-kenya-green hover:text-kenya-green">
              {busy ? "Uploading…" : "+ Add photos"}
              <input type="file" multiple accept={ACCEPT.photo} className="hidden" onChange={(e) => addPhotos(e.target.files)} />
            </label>
          )}
          {!isOfficer && files.length === 0 && <span className="text-xs text-gray-400">No photos.</span>}
        </div>
        {isOfficer && <p className="mt-1 text-[11px] text-gray-400">{HINT.photo}, up to 5 at a time</p>}
      </div>
      {msg && <p className="text-xs text-red-600">{msg}</p>}
    </div>
  );
}
