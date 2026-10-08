"use client";

import { Fragment, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import ProtectedRoute from "../../../components/ProtectedRoute";
import api from "../../../lib/api";
import PdfListImport, { uploadSupportingPdf } from "../../../components/PdfListImport";
import { useAuth } from "../../../context/AuthContext";
import { AuthedImage, openFile, useFileList, ACCEPT, HINT, formatBytes } from "../../../lib/files";

// Documents and AGM papers store their file as "file:<id>" in storageKey.
const fileIdOf = (key) => (typeof key === "string" && key.startsWith("file:") ? key.slice(5) : null);

const ASSET_TRACKED_VALUE_CHAINS = ["LIVESTOCK", "POULTRY", "HOUSING", "TRANSPORT"];
const BASE_TABS = ["Members", "Contributions", "Produce", "Input Credits", "Payouts", "Documents", "Governance", "Supervisory Board", "AGM", "Credit Score"];

// Dates are stored as calendar dates (midnight UTC). Showing them in UTC keeps
// "5 Mar 2026" from turning into "4 Mar" on a computer set behind UTC.
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }) : "—");
const toInputDate = (d) => (d ? new Date(d).toISOString().slice(0, 10) : "");
const todayInput = () => new Date().toISOString().slice(0, 10);
const prettyRole = (r) => r.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
const STAFF_DELETE_ROLES = ["NATIONAL_ADMIN", "DIRECTOR", "SUBCOUNTY_OFFICER"];

const inputCls = "mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm font-normal text-gray-900";
function Field({ label, hint, className = "", children }) {
  return (
    <label className={`block text-xs font-medium text-gray-600 ${className}`}>
      {label}
      {children}
      {hint && <span className="mt-0.5 block font-normal text-gray-400">{hint}</span>}
    </label>
  );
}

// Date on the Certificate of Registration. Shown to everyone; county staff
// can set or correct it (a Cooperative Manager cannot, as with the reg. number).
function RegistrationDate({ coop, onSaved }) {
  const { user } = useAuth();
  const canEdit = user?.role && user.role !== "COOPERATIVE_MANAGER";
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function save(e) {
    e.preventDefault();
    if (!value) return setError("Pick the date of registration");
    setBusy(true);
    setError("");
    try {
      await api.patch(`/cooperatives/${coop.id}`, { registrationDate: value });
      setEditing(false);
      onSaved();
    } catch (err) {
      setError(err?.response?.data?.error || "Could not save the date");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mb-6 text-sm text-gray-500">
      {!editing ? (
        <>
          Registered: <span className="text-gray-800">{coop.registrationDate ? fmtDate(coop.registrationDate) : "date not recorded"}</span>
          {canEdit && (
            <button
              onClick={() => { setValue(toInputDate(coop.registrationDate)); setEditing(true); }}
              className="ml-2 text-xs text-kenya-green hover:underline"
            >
              {coop.registrationDate ? "Edit" : "Add date"}
            </button>
          )}
        </>
      ) : (
        <form onSubmit={save} className="flex flex-wrap items-center gap-2">
          <span>Registered:</span>
          <input type="date" min="1900-01-01" max={todayInput()} value={value} onChange={(e) => setValue(e.target.value)}
            className="rounded-md border border-gray-300 px-2 py-1 text-sm text-gray-900" />
          <button disabled={busy} className="rounded-md bg-kenya-green px-3 py-1 text-xs font-semibold text-white disabled:opacity-60">{busy ? "Saving…" : "Save"}</button>
          <button type="button" onClick={() => setEditing(false)} className="text-xs text-gray-500 hover:underline">Cancel</button>
          {error && <span className="text-xs text-red-600">{error}</span>}
        </form>
      )}
    </div>
  );
}

export default function CooperativeDetailPage() {
  const { id } = useParams();
  const [coop, setCoop] = useState(null);
  const [tab, setTab] = useState("Members");
  const [error, setError] = useState("");

  function reload() {
    api
      .get(`/cooperatives/${id}`)
      .then((res) => setCoop(res.data))
      .catch((err) => setError(err?.response?.data?.error || "Failed to load cooperative"));
  }

  useEffect(reload, [id]);

  if (error) {
    return (
      <ProtectedRoute>
        <p className="text-sm text-red-600">{error}</p>
      </ProtectedRoute>
    );
  }

  if (!coop) {
    return (
      <ProtectedRoute>
        <p className="text-gray-500">Loading…</p>
      </ProtectedRoute>
    );
  }

  return (
    <ProtectedRoute>
      <div className="mb-1 text-xs font-medium uppercase text-kenya-gold">{coop.valueChain}</div>
      <h1 className="mb-1 text-2xl font-bold">{coop.name}</h1>
      <p className="mb-1 text-sm text-gray-500">
        {coop.registrationNumber} · {coop.county?.name ? `${coop.county.name} County · ` : ""}{coop.subCounty} / {coop.ward}
      </p>
      <RegistrationDate coop={coop} onSaved={reload} />

      <div className="mb-6 flex gap-2 overflow-x-auto whitespace-nowrap border-b border-gray-200">
        {(ASSET_TRACKED_VALUE_CHAINS.includes(coop.valueChain)
          ? [...BASE_TABS.slice(0, 3), "Assets", ...BASE_TABS.slice(3)]
          : BASE_TABS
        ).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`shrink-0 px-4 py-2 text-sm font-medium ${
              tab === t ? "border-b-2 border-kenya-green text-kenya-green" : "text-gray-500"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "Members" && <MembersTab coop={coop} onChange={reload} />}
      {tab === "Contributions" && <ContributionsTab coop={coop} />}
      {tab === "Produce" && <ProduceTab coop={coop} />}
      {tab === "Assets" && <AssetsTab coop={coop} />}
      {tab === "Input Credits" && <InputCreditsTab coop={coop} />}
      {tab === "Payouts" && <PayoutsTab coop={coop} />}
      {tab === "Documents" && <DocumentsTab coop={coop} onChange={reload} />}
      {tab === "Governance" && <GovernanceTab coop={coop} onChange={reload} />}
      {tab === "Supervisory Board" && <SupervisoryBoardTab coop={coop} />}
      {tab === "AGM" && <AGMTab coop={coop} onChange={reload} />}
      {tab === "Credit Score" && <CreditScoreTab coop={coop} />}
    </ProtectedRoute>
  );
}

function MembersTab({ coop, onChange }) {
  const [form, setForm] = useState({ legalName: "", nationalId: "", phoneNumber: "", gender: "MALE", shareCapital: 0 });
  const [error, setError] = useState("");

  async function addMember(e) {
    e.preventDefault();
    setError("");
    try {
      await api.post(`/cooperatives/${coop.id}/members`, { ...form, shareCapital: Number(form.shareCapital) });
      setForm({ legalName: "", nationalId: "", phoneNumber: "", gender: "MALE", shareCapital: 0 });
      onChange();
    } catch (err) {
      setError(err?.response?.data?.error || "Failed to add member");
    }
  }

  return (
    <div>
      <PdfListImport coop={coop} kind="MEMBERS" onImported={onChange} />
      <form onSubmit={addMember} className="mb-4 grid grid-cols-2 gap-3 rounded-lg border border-gray-200 bg-white p-4 md:grid-cols-5">
        <input required placeholder="Legal Name" className="rounded-md border border-gray-300 px-3 py-2 text-sm md:col-span-2"
          value={form.legalName} onChange={(e) => setForm({ ...form, legalName: e.target.value })} />
        <input required placeholder="National ID" className="rounded-md border border-gray-300 px-3 py-2 text-sm"
          value={form.nationalId} onChange={(e) => setForm({ ...form, nationalId: e.target.value })} />
        <input placeholder="Phone" className="rounded-md border border-gray-300 px-3 py-2 text-sm"
          value={form.phoneNumber} onChange={(e) => setForm({ ...form, phoneNumber: e.target.value })} />
        <select className="rounded-md border border-gray-300 px-3 py-2 text-sm"
          value={form.gender} onChange={(e) => setForm({ ...form, gender: e.target.value })}>
          <option value="MALE">Male</option>
          <option value="FEMALE">Female</option>
        </select>
        <input type="number" min="0" step="0.01" placeholder="Share Capital (KES)" className="rounded-md border border-gray-300 px-3 py-2 text-sm md:col-span-2"
          value={form.shareCapital} onChange={(e) => setForm({ ...form, shareCapital: e.target.value })} />
        <button type="submit" className="rounded-md bg-kenya-green px-3 py-2 text-sm font-semibold text-white md:col-span-3">
          Add Member
        </button>
      </form>
      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
            <tr>
              <th className="px-4 py-2">Name</th>
              <th className="px-4 py-2">National ID</th>
              <th className="px-4 py-2">Gender</th>
              <th className="px-4 py-2">Share Capital</th>
            </tr>
          </thead>
          <tbody>
            {(coop.members || []).map((m) => (
              <tr key={m.id} className="border-t border-gray-100">
                <td className="px-4 py-2 font-medium">{m.legalName}</td>
                <td className="px-4 py-2">{m.nationalId}</td>
                <td className="px-4 py-2">{m.gender}</td>
                <td className="px-4 py-2">KES {Number(m.shareCapital).toLocaleString()}</td>
              </tr>
            ))}
            {(coop.members || []).length === 0 && (
              <tr><td colSpan={4} className="px-4 py-6 text-center text-gray-400">No members yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const DOC_LABELS = {
  REGISTRATION_CERTIFICATE: "Registration certificate",
  BY_LAWS: "By-laws",
  MEETING_MINUTES: "Meeting minutes",
  CODE_OF_CONDUCT: "Code of conduct",
  AUDIT_REPORT: "Audit report",
  SPOT_CHECK_REPORT: "Spot-check report",
  OTHER: "Other",
};
const DOC_TYPES = Object.keys(DOC_LABELS);
const REVIEW_ROLES = ["NATIONAL_ADMIN", "DIRECTOR", "SUBCOUNTY_OFFICER"];
const APPROVE_ROLES = ["NATIONAL_ADMIN", "DIRECTOR"];
const certTitle = (coop) => `Certificate of Registration ${coop.registrationNumber}`;

function DocumentsTab({ coop, onChange }) {
  const { user } = useAuth();
  const docs = coop.documents || [];
  // A rejected certificate doesn't count: a replacement may be uploaded.
  const cert = docs.find((d) => d.docType === "REGISTRATION_CERTIFICATE" && d.status !== "REJECTED");
  const [form, setForm] = useState({ docType: cert ? "BY_LAWS" : "REGISTRATION_CERTIFICATE", title: cert ? "" : certTitle(coop) });
  const [file, setFile] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  // Picking the certificate fills in its usual title (unless one was typed).
  function pickType(docType) {
    setForm((f) => {
      const untouched = !f.title.trim() || f.title === certTitle(coop);
      return { docType, title: untouched ? (docType === "REGISTRATION_CERTIFICATE" ? certTitle(coop) : "") : f.title };
    });
  }

  // The real file goes up with the form (PDF or a clear photo, up to 10 MB).
  async function upload(e) {
    e.preventDefault();
    const formEl = e.currentTarget;
    setError("");
    if (!file) { setError("Choose the document file first."); return; }
    setBusy(true);
    try {
      const data = new FormData();
      data.append("docType", form.docType);
      data.append("title", form.title.trim());
      data.append("file", file);
      await api.post(`/cooperatives/${coop.id}/documents`, data);
      setForm({ docType: form.docType === "REGISTRATION_CERTIFICATE" ? "BY_LAWS" : form.docType, title: "" });
      setFile(null);
      formEl.reset();
      onChange();
    } catch (err) {
      setError(err?.response?.data?.error || "Failed to upload document");
    } finally {
      setBusy(false);
    }
  }

  async function act(fn) {
    setError("");
    try {
      await fn();
      onChange();
    } catch (err) {
      setError(err?.response?.data?.error || "That didn't work. Please try again.");
    }
  }

  // A rejection needs a reason the cooperative can read and act on.
  function decide(kind, docId, approve) {
    let note;
    if (!approve) {
      note = window.prompt("Why is this document being rejected? The cooperative will see this reason.");
      if (note === null) return;
      if (note.trim().length < 3) { setError("Give a short reason for rejecting the document."); return; }
    }
    act(() => api.post(`/cooperatives/${coop.id}/documents/${docId}/${kind}`, { approve, ...(note ? { note: note.trim() } : {}) }));
  }

  function remove(d) {
    if (!window.confirm(`Delete "${d.title}"? The file is removed too and this can't be undone.`)) return;
    act(() => api.delete(`/cooperatives/${coop.id}/documents/${d.id}`));
  }

  const canReview = REVIEW_ROLES.includes(user?.role);
  const canApprove = APPROVE_ROLES.includes(user?.role);
  const canDelete = STAFF_DELETE_ROLES.includes(user?.role);

  return (
    <div>
      {cert ? (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-800">
          <span className="font-semibold">Registration certificate on file</span>
          <StatusBadge status={cert.status} />
          {fileIdOf(cert.storageKey) && (
            <button onClick={() => openFile(api, fileIdOf(cert.storageKey))} className="text-xs font-medium underline">View certificate</button>
          )}
        </div>
      ) : (
        <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <span className="font-semibold">Registration certificate not on file.</span> Upload the society&apos;s certificate of registration below.
        </div>
      )}

      <form onSubmit={upload} className="mb-4 grid grid-cols-2 gap-3 rounded-lg border border-gray-200 bg-white p-4 md:grid-cols-4">
        <Field label="Document type">
          <select className={inputCls} value={form.docType} onChange={(e) => pickType(e.target.value)}>
            {DOC_TYPES.map((t) => (
              <option key={t} value={t} disabled={t === "REGISTRATION_CERTIFICATE" && Boolean(cert)}>
                {DOC_LABELS[t]}{t === "REGISTRATION_CERTIFICATE" && cert ? " (already on file)" : ""}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Title" className="md:col-span-2">
          <input required className={inputCls} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
        </Field>
        <div className="flex items-end">
          <button type="submit" disabled={busy} className="w-full rounded-md bg-kenya-green px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">
            {busy ? "Uploading…" : "Upload"}
          </button>
        </div>
        <div className="col-span-2 md:col-span-4">
          <input required type="file" accept={ACCEPT.document} onChange={(e) => setFile(e.target.files?.[0] || null)}
            className="block w-full text-xs file:mr-3 file:rounded-md file:border-0 file:bg-kenya-green/10 file:px-3 file:py-1.5 file:text-kenya-green" />
          <p className="mt-1 text-xs text-gray-400">{HINT.document}. Every upload waits for Sub-County review and Director sign-off.</p>
        </div>
      </form>
      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
            <tr>
              <th className="px-4 py-2">Title</th>
              <th className="px-4 py-2">Type</th>
              <th className="px-4 py-2">Uploaded</th>
              <th className="px-4 py-2">Status</th>
              <th className="px-4 py-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {docs.map((d) => (
              <tr key={d.id} className="border-t border-gray-100 align-top">
                <td className="px-4 py-2 font-medium">
                  {d.title}
                  <div className="text-xs font-normal">
                    {fileIdOf(d.storageKey) ? (
                      <button onClick={() => openFile(api, fileIdOf(d.storageKey))} className="text-kenya-green hover:underline">
                        View file ({formatBytes(d.fileSizeBytes)})
                      </button>
                    ) : (
                      <span className="text-gray-400">No file stored (recorded before uploads were enabled)</span>
                    )}
                  </div>
                  {d.status === "REJECTED" && d.rejectionNote && (
                    <div className="mt-1 text-xs font-normal text-red-600">Rejected: {d.rejectionNote}</div>
                  )}
                </td>
                <td className="px-4 py-2">{DOC_LABELS[d.docType] || d.docType.replace(/_/g, " ")}</td>
                <td className="px-4 py-2 whitespace-nowrap">{fmtDate(d.createdAt)}</td>
                <td className="px-4 py-2">
                  <StatusBadge status={d.status} />
                </td>
                <td className="space-x-2 px-4 py-2 whitespace-nowrap">
                  {d.status === "PENDING" && canReview && (
                    <>
                      <button onClick={() => decide("review", d.id, true)} className="text-xs font-medium text-kenya-green hover:underline">Review ✓</button>
                      <button onClick={() => decide("review", d.id, false)} className="text-xs font-medium text-red-600 hover:underline">Reject</button>
                    </>
                  )}
                  {d.status === "REVIEWED" && canApprove && (
                    <>
                      <button onClick={() => decide("approve", d.id, true)} className="text-xs font-medium text-kenya-green hover:underline">Director Approve</button>
                      <button onClick={() => decide("approve", d.id, false)} className="text-xs font-medium text-red-600 hover:underline">Reject</button>
                    </>
                  )}
                  {canDelete && (d.status !== "APPROVED" || canApprove) && (
                    <button onClick={() => remove(d)} className="text-xs font-medium text-gray-500 hover:text-red-600 hover:underline">Delete</button>
                  )}
                </td>
              </tr>
            ))}
            {docs.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-6 text-center text-gray-400">No documents uploaded.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StatusBadge({ status }) {
  const colors = {
    PENDING: "bg-yellow-100 text-yellow-800",
    REVIEWED: "bg-blue-100 text-blue-800",
    APPROVED: "bg-green-100 text-green-800",
    REJECTED: "bg-red-100 text-red-800",
    TERM_EXPIRING: "bg-yellow-100 text-yellow-800",
    TERM_EXPIRED: "bg-red-100 text-red-800",
    COMPLIANT: "bg-green-100 text-green-800",
    NON_COMPLIANT: "bg-red-100 text-red-800",
    UPCOMING: "bg-gray-100 text-gray-700",
    SERVING: "bg-green-100 text-green-800",
    RETIRED: "bg-gray-100 text-gray-600",
  };
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${colors[status] || "bg-gray-100 text-gray-700"}`}>
      {status.replace(/_/g, " ")}
    </span>
  );
}

const MGMT_ROLES = ["CHAIRPERSON", "VICE_CHAIRPERSON", "SECRETARY", "TREASURER", "BOARD_MEMBER", "EXECUTIVE_MANAGER"];
const OVERRIDE_ROLES = ["NATIONAL_ADMIN", "DIRECTOR"];
const blankMember = (role = "BOARD_MEMBER") => ({
  fullName: "", gender: "MALE", role, nationalId: "", phoneNumber: "", appointmentDate: "", retirementDate: "",
});

function GovernanceTab({ coop, onChange }) {
  const { user } = useAuth();
  const canOverride = OVERRIDE_ROLES.includes(user?.role);
  const [members, setMembers] = useState([blankMember("CHAIRPERSON")]);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const [complianceWarning, setComplianceWarning] = useState(null);
  // A PDF whose names filled the form; filed under Documents once the committee is saved.
  const [sourcePdf, setSourcePdf] = useState(null);
  // Unknown until the server answers; treat as "not enforced" so nothing is shown that could be wrong.
  const [enforced, setEnforced] = useState(false);
  useEffect(() => {
    api.get(`/cooperatives/${coop.id}/governance/rules`).then((r) => setEnforced(!!r.data.genderRuleEnforced)).catch(() => {});
  }, [coop.id]);

  const committees = coop.committees || [];
  const current = committees.filter((c) => c.current);
  const previous = committees.filter((c) => !c.current);

  function updateMember(idx, field, value) {
    setMembers((prev) =>
      prev.map((m, i) => {
        if (i !== idx) return m;
        return { ...m, [field]: value };
      })
    );
  }
  const addRow = () => setMembers((prev) => [...prev, blankMember()]);
  const removeRow = (idx) => setMembers((prev) => prev.filter((_, i) => i !== idx));

  // Start from the committee in force, keeping only people still serving, so
  // a change of one office-holder doesn't mean typing everyone again.
  function copyCurrent() {
    const live = (current[0]?.members || []).filter((m) => !m.retirementDate || new Date(m.retirementDate) > new Date());
    if (!live.length) return;
    setMembers(
      live.map((m) => ({
        fullName: m.fullName, gender: m.gender, role: m.role, nationalId: m.nationalId || "", phoneNumber: m.phoneNumber || "",
        appointmentDate: toInputDate(m.appointmentDate || m.electionDate), retirementDate: toInputDate(m.retirementDate),
      }))
    );
    setSaved("");
    setError("");
  }

  async function saveCommittee(e, overrideJustification) {
    e?.preventDefault?.();
    setError("");
    setSaved("");
    setComplianceWarning(null);
    try {
      const res = await api.post(`/cooperatives/${coop.id}/governance/committees`, {
        committeeType: "MANAGEMENT",
        termLengthYears: 3,
        members,
        ...(overrideJustification ? { overrideJustification } : {}),
      });
      setMembers([blankMember("CHAIRPERSON")]);
      const flagged = res.data?.genderRuleEnforced === false && res.data?.complianceCheck && !res.data.complianceCheck.compliant;
      let docNote = "";
      if (sourcePdf) {
        try {
          await uploadSupportingPdf(coop.id, sourcePdf, "COMMITTEE");
          docNote = " The PDF is kept under Documents as a supporting file.";
        } catch (e2) {
          docNote = ` The PDF itself could not be filed under Documents (${e2?.response?.data?.error || "upload failed"}); upload it there by hand.`;
        }
        setSourcePdf(null);
      }
      setSaved(
        "Committee saved. It is now the committee in force; the previous one is kept below as history." + docNote +
          (flagged ? " Note: it does not yet meet the 1/3 gender rule. This is recorded as Non-compliant but did not block saving." : "")
      );
      onChange();
    } catch (err) {
      if (err?.response?.status === 422) {
        setComplianceWarning(err.response.data);
      } else {
        setError(err?.response?.data?.error || "Failed to save committee");
      }
    }
  }

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-3">
        <h3 className="font-semibold">Submit / Update Management Committee</h3>
        {current.length > 0 && (
          <button type="button" onClick={copyCurrent} className="rounded-md border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50">
            Start from the current committee
          </button>
        )}
      </div>
      <PdfListImport coop={coop} kind="COMMITTEE" label="Import committee from PDF"
        onUseRows={(rows, f) => { setMembers(rows); setSourcePdf(f); setSaved("Filled the form from the PDF. Check each person, then press Save Committee."); setError(""); setComplianceWarning(null); }} />
      {sourcePdf && (
        <p className="mb-2 text-xs text-gray-600">
          Supporting file: <b>{sourcePdf.name}</b> will be kept under Documents when you save.{" "}
          <button type="button" onClick={() => setSourcePdf(null)} className="text-kenya-green hover:underline">Don&apos;t keep it</button>
        </p>
      )}
      <form onSubmit={(e) => saveCommittee(e)} className="mb-4 space-y-3 rounded-lg border border-gray-200 bg-white p-4">
        {members.map((m, i) => (
          <div key={i} className="rounded-md border border-gray-100 bg-gray-50/60 p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-semibold text-gray-500">Member {i + 1}</span>
              {members.length > 1 && (
                <button type="button" onClick={() => removeRow(i)} className="text-xs text-red-600 hover:underline">Remove</button>
              )}
            </div>
            <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
              <Field label="Full name">
                <input required className={inputCls} value={m.fullName} onChange={(e) => updateMember(i, "fullName", e.target.value)} />
              </Field>
              <Field label="Gender">
                <select className={inputCls} value={m.gender} onChange={(e) => updateMember(i, "gender", e.target.value)}>
                  <option value="MALE">Male</option>
                  <option value="FEMALE">Female</option>
                </select>
              </Field>
              <Field label="Role">
                <select className={inputCls} value={m.role} onChange={(e) => updateMember(i, "role", e.target.value)}>
                  {MGMT_ROLES.map((r) => <option key={r} value={r}>{prettyRole(r)}</option>)}
                </select>
              </Field>
              <Field label="ID number">
                <input required inputMode="numeric" autoComplete="off" className={inputCls} value={m.nationalId} onChange={(e) => updateMember(i, "nationalId", e.target.value)} />
              </Field>
              <Field label="Phone number">
                <input required type="tel" placeholder="0712 345 678" className={inputCls} value={m.phoneNumber} onChange={(e) => updateMember(i, "phoneNumber", e.target.value)} />
              </Field>
              <Field label="Date appointed" hint="Also recorded as the election date">
                <input required type="date" max={todayInput()} className={inputCls} value={m.appointmentDate} onChange={(e) => updateMember(i, "appointmentDate", e.target.value)} />
              </Field>
              <Field label="Retirement date" hint="Leave blank while serving">
                <input type="date" min={m.appointmentDate || undefined} className={inputCls} value={m.retirementDate} onChange={(e) => updateMember(i, "retirementDate", e.target.value)} />
              </Field>
            </div>
          </div>
        ))}
        <div className="flex gap-2">
          <button type="button" onClick={addRow} className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium">
            + Add Member
          </button>
          <button type="submit" className="rounded-md bg-kenya-green px-3 py-1.5 text-xs font-semibold text-white">
            Save Committee
          </button>
        </div>
        <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
          {enforced
            ? "The 1/3 gender rule is enforced: no gender may hold more than two-thirds of the elected seats, or the committee is blocked (a Director can override with a justification)."
            : "The 1/3 gender rule is not being enforced at registration for now. A committee that falls short is still saved and shown as Non-compliant, so the gap stays on record for when enforcement starts."}
        </p>
        <p className="text-xs text-gray-400">
          The term (3 years) runs from the date elected. Someone whose retirement date has passed no longer counts toward the 1/3 gender rule.
        </p>
      </form>

      {saved && <p className="mb-3 text-sm text-green-700">{saved}</p>}
      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

      {complianceWarning && (
        <div className="mb-4 rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-800">
          <p className="font-semibold">{complianceWarning.error}</p>
          <p className="mt-1">{complianceWarning.detail?.reason}</p>
          {canOverride ? (
            <>
              <p className="mt-2 text-xs">As Director you can override this with a logged justification.</p>
              <OverrideForm onOverride={(justification) => saveCommittee(null, justification)} />
            </>
          ) : (
            <p className="mt-2 text-xs">Only your County Director can override this rule. Adjust the committee so no gender holds more than two-thirds of the elected seats, or ask the Director to submit it.</p>
          )}
        </div>
      )}

      <h3 className="mb-2 mt-6 font-semibold">Committee in force</h3>
      <div className="space-y-3">
        {current.map((c) => <CommitteeCard key={c.id} coop={coop} committee={c} onChange={onChange} />)}
        {committees.length === 0 && <p className="text-gray-400">No committees recorded yet.</p>}
      </div>

      {previous.length > 0 && (
        <details className="mt-6">
          <summary className="cursor-pointer text-sm font-semibold text-gray-600">Previous committees ({previous.length}), kept as history</summary>
          <div className="mt-3 space-y-3">
            {previous.map((c) => <CommitteeCard key={c.id} coop={coop} committee={c} onChange={onChange} history />)}
          </div>
        </details>
      )}
    </div>
  );
}

function CommitteeCard({ coop, committee: c, onChange, history }) {
  return (
    <div className={`rounded-lg border border-gray-200 bg-white p-4 ${history ? "opacity-80" : ""}`}>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">{prettyRole(c.committeeType)} Committee</span>
        <StatusBadge status={c.status} />
        {c.complianceOverride && <span className="text-xs text-amber-600">(Director override logged)</span>}
        <span className="text-xs text-gray-400">Submitted {fmtDate(c.createdAt)}{history ? " · superseded" : ""}</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase text-gray-400">
            <tr>
              <th className="py-1 pr-3">Name</th>
              <th className="py-1 pr-3">Role</th>
              <th className="py-1 pr-3">ID number</th>
              <th className="py-1 pr-3">Phone</th>
              <th className="py-1 pr-3">Date appointed</th>
              <th className="py-1 pr-3">Elected</th>
              <th className="py-1 pr-3">Re-election due</th>
              <th className="py-1 pr-3">Retirement</th>
              <th className="py-1" />
            </tr>
          </thead>
          <tbody>
            {(c.members || []).map((m) => (
              <CommitteeMemberRow key={m.id} coop={coop} committee={c} m={m} onChange={onChange} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CommitteeMemberRow({ coop, committee, m, onChange }) {
  const [editing, setEditing] = useState(false);
  const [f, setF] = useState({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const retired = m.retirementDate && new Date(m.retirementDate) <= new Date();
  const missing = <span className="text-amber-600">missing</span>;

  function start() {
    setF({
      fullName: m.fullName, nationalId: m.nationalId || "", phoneNumber: m.phoneNumber || "",
      appointmentDate: toInputDate(m.appointmentDate), retirementDate: toInputDate(m.retirementDate),
    });
    setError("");
    setEditing(true);
  }

  async function save(e) {
    e.preventDefault();
    // Send only what changed; fields never filled in (older records) are left alone.
    const body = {};
    if (f.fullName.trim() && f.fullName.trim() !== m.fullName) body.fullName = f.fullName.trim();
    if (f.nationalId.trim() && f.nationalId.trim() !== (m.nationalId || "")) body.nationalId = f.nationalId.trim();
    if (f.phoneNumber.trim() && f.phoneNumber.trim() !== (m.phoneNumber || "")) body.phoneNumber = f.phoneNumber.trim();
    if (f.appointmentDate && f.appointmentDate !== toInputDate(m.appointmentDate)) body.appointmentDate = f.appointmentDate;
    if (f.retirementDate !== toInputDate(m.retirementDate)) body.retirementDate = f.retirementDate || null;
    if (!Object.keys(body).length) { setEditing(false); return; }
    setBusy(true);
    setError("");
    try {
      await api.patch(`/cooperatives/${coop.id}/governance/committees/${committee.id}/members/${m.id}`, body);
      setEditing(false);
      onChange();
    } catch (err) {
      setError(err?.response?.data?.error || "Couldn't save the changes");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <tr className={`border-t border-gray-100 ${retired ? "text-gray-400" : "text-gray-700"}`}>
        <td className="py-1.5 pr-3 font-medium">
          {m.fullName} <span className="font-normal text-gray-400">({m.gender === "FEMALE" ? "F" : "M"})</span>
          {retired && <span className="ml-2"><StatusBadge status="RETIRED" /></span>}
        </td>
        <td className="py-1.5 pr-3">{prettyRole(m.role)}</td>
        <td className="py-1.5 pr-3">{m.nationalId || missing}</td>
        <td className="py-1.5 pr-3 whitespace-nowrap">{m.phoneNumber || missing}</td>
        <td className="py-1.5 pr-3 whitespace-nowrap">{m.appointmentDate ? fmtDate(m.appointmentDate) : missing}</td>
        <td className="py-1.5 pr-3 whitespace-nowrap text-gray-500">{fmtDate(m.electionDate)}</td>
        <td className="py-1.5 pr-3 whitespace-nowrap">{fmtDate(m.reelectionDueDate)}</td>
        <td className="py-1.5 pr-3 whitespace-nowrap">{m.retirementDate ? fmtDate(m.retirementDate) : "Serving"}</td>
        <td className="py-1.5 text-right">
          <button onClick={start} className="text-xs font-medium text-kenya-green hover:underline">Edit</button>
        </td>
      </tr>
      {editing && (
        <tr className="bg-gray-50/70">
          <td colSpan={9} className="p-3">
            <form onSubmit={save} className="grid grid-cols-2 gap-2 md:grid-cols-5">
              <Field label="Full name"><input className={inputCls} value={f.fullName} onChange={(e) => setF({ ...f, fullName: e.target.value })} /></Field>
              <Field label="ID number"><input className={inputCls} value={f.nationalId} onChange={(e) => setF({ ...f, nationalId: e.target.value })} /></Field>
              <Field label="Phone number"><input type="tel" className={inputCls} value={f.phoneNumber} onChange={(e) => setF({ ...f, phoneNumber: e.target.value })} /></Field>
              <Field label="Date appointed"><input type="date" max={todayInput()} className={inputCls} value={f.appointmentDate} onChange={(e) => setF({ ...f, appointmentDate: e.target.value })} /></Field>
              <Field label="Retirement date" hint="Blank = still serving"><input type="date" min={f.appointmentDate || undefined} className={inputCls} value={f.retirementDate} onChange={(e) => setF({ ...f, retirementDate: e.target.value })} /></Field>
              <div className="col-span-2 flex items-center gap-2 md:col-span-5">
                <button type="submit" disabled={busy} className="rounded-md bg-kenya-green px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">{busy ? "Saving…" : "Save"}</button>
                <button type="button" onClick={() => setEditing(false)} className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium">Cancel</button>
                {error && <span className="text-xs text-red-600">{error}</span>}
              </div>
            </form>
          </td>
        </tr>
      )}
    </>
  );
}

function OverrideForm({ onOverride }) {
  const [justification, setJustification] = useState("");
  return (
    <div className="mt-3 flex gap-2">
      <input
        placeholder="Director justification (min. 10 characters)"
        className="flex-1 rounded-md border border-gray-300 px-3 py-1.5 text-sm"
        value={justification}
        onChange={(e) => setJustification(e.target.value)}
      />
      <button
        onClick={() => onOverride(justification.trim())}
        disabled={justification.trim().length < 10}
        className="rounded-md bg-red-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
      >
        Override & Submit
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Supervisory Board: Chairman, Honorary Secretary, Member
// ---------------------------------------------------------------------------
const BOARD_SEATS = [
  { position: "CHAIRMAN", label: "Chairman" },
  { position: "HONORARY_SECRETARY", label: "Honorary Secretary" },
  { position: "MEMBER", label: "Member" },
];
const BOARD_STATUS = {
  SERVING: { text: "Serving", cls: "bg-green-100 text-green-800" },
  TERM_EXPIRING: { text: "Term ends soon", cls: "bg-yellow-100 text-yellow-800" },
  TERM_EXPIRED: { text: "Term ended: re-election due", cls: "bg-red-100 text-red-800" },
  RETIRED: { text: "Retired", cls: "bg-gray-100 text-gray-600" },
};
const BoardBadge = ({ status }) => {
  const b = BOARD_STATUS[status] || { text: status, cls: "bg-gray-100 text-gray-700" };
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${b.cls}`}>{b.text}</span>;
};

function SupervisoryBoardTab({ coop }) {
  const { user } = useAuth();
  const base = `/cooperatives/${coop.id}/governance/supervisory-board`;
  const [rows, setRows] = useState(null);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(null); // { kind: "appoint" | "edit" | "retire", position?, id? }
  const canDelete = STAFF_DELETE_ROLES.includes(user?.role);

  function load() {
    return api.get(base).then((res) => { setRows(res.data); setError(""); })
      .catch((err) => setError(err?.response?.data?.error || "Failed to load the Supervisory Board"));
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [coop.id]);

  async function remove(r) {
    if (!window.confirm(`Delete ${r.fullName} (${r.positionLabel}) from the record? Use this only for an entry made by mistake. For someone who served and left, record a retirement date instead.`)) return;
    try { await api.delete(`${base}/${r.id}`); await load(); }
    catch (err) { setError(err?.response?.data?.error || "Couldn't delete that entry"); }
  }

  if (!rows) return error ? <p className="text-sm text-red-600">{error}</p> : <p className="text-gray-500">Loading…</p>;

  const serving = (pos) => rows.filter((r) => r.position === pos && r.status !== "RETIRED").sort((a, b) => new Date(b.appointmentDate) - new Date(a.appointmentDate))[0];
  const past = rows.filter((r) => r.status === "RETIRED").sort((a, b) => new Date(b.retirementDate) - new Date(a.retirementDate));
  const filled = BOARD_SEATS.filter((s) => serving(s.position)).length;

  return (
    <div>
      <div className="mb-4 rounded-lg border border-gray-200 bg-white p-4">
        <div className="flex flex-wrap items-center gap-3">
          <h3 className="font-semibold">Supervisory Board</h3>
          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${filled === 3 ? "bg-green-100 text-green-800" : "bg-amber-100 text-amber-800"}`}>
            {filled} of 3 seats filled
          </span>
        </div>
        <p className="mt-1 text-xs text-gray-500">
          Every society has a supervisory committee of three members, each elected for three years, with one retiring each year (Co-operative Societies Rules, 2004, rule 28(1)).
          Its duties are kept separate from the Management Committee.
        </p>
      </div>
      <PdfListImport coop={coop} kind="BOARD" label="Import board from PDF" onImported={load} />
      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

      <div className="grid gap-4 md:grid-cols-3">
        {BOARD_SEATS.map((seat) => {
          const holder = serving(seat.position);
          const succeeding = holder && holder.retirementDate; // retires on a future date; a successor may be lined up
          return (
            <div key={seat.position} className="flex flex-col rounded-lg border border-gray-200 bg-white p-4">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wide text-kenya-gold">{seat.label}</span>
                {holder && <BoardBadge status={holder.status} />}
              </div>

              {holder ? (
                <div className="flex-1 text-sm">
                  <p className="text-base font-semibold">{holder.fullName}</p>
                  <dl className="mt-2 space-y-0.5 text-gray-600">
                    <div><dt className="inline text-gray-400">ID number: </dt><dd className="inline">{holder.nationalId}</dd></div>
                    <div><dt className="inline text-gray-400">Phone: </dt><dd className="inline">{holder.phoneNumber}</dd></div>
                    <div><dt className="inline text-gray-400">Appointed: </dt><dd className="inline">{fmtDate(holder.appointmentDate)}</dd></div>
                    <div><dt className="inline text-gray-400">Term ends: </dt><dd className="inline">{fmtDate(holder.termEndsOn)}</dd></div>
                    {holder.retirementDate && <div><dt className="inline text-gray-400">Retires: </dt><dd className="inline">{fmtDate(holder.retirementDate)}</dd></div>}
                  </dl>
                  {holder.alsoOnManagementCommittee && (
                    <p className="mt-2 rounded-md bg-amber-50 p-2 text-xs text-amber-800">
                      This person is also serving on the Management Committee. Rule 28(4) keeps the supervisory committee&apos;s duties separate from the committee&apos;s, so check this is intended.
                    </p>
                  )}
                </div>
              ) : (
                <p className="flex-1 text-sm text-gray-400">Seat vacant.</p>
              )}

              <div className="mt-3 flex flex-wrap gap-3 text-xs font-medium">
                {holder ? (
                  <>
                    <button onClick={() => setOpen({ kind: "edit", id: holder.id })} className="text-kenya-green hover:underline">Edit</button>
                    <button onClick={() => setOpen({ kind: "retire", id: holder.id })} className="text-kenya-green hover:underline">Record retirement</button>
                    {succeeding && <button onClick={() => setOpen({ kind: "appoint", position: seat.position })} className="text-kenya-green hover:underline">Appoint successor</button>}
                    {canDelete && <button onClick={() => remove(holder)} className="text-gray-400 hover:text-red-600 hover:underline">Delete</button>}
                  </>
                ) : (
                  <button onClick={() => setOpen({ kind: "appoint", position: seat.position })} className="rounded-md bg-kenya-green px-3 py-1.5 text-white">Appoint {seat.label}</button>
                )}
              </div>

              {open?.kind === "appoint" && open.position === seat.position && (
                <BoardForm title={`Appoint ${seat.label}`} fields={{ fullName: "", nationalId: "", phoneNumber: "", appointmentDate: "", retirementDate: "" }}
                  submitLabel="Appoint" onCancel={() => setOpen(null)}
                  onSubmit={async (v) => { await api.post(base, { position: seat.position, ...v }); setOpen(null); await load(); }} />
              )}
              {holder && open?.kind === "edit" && open.id === holder.id && (
                <BoardForm title="Edit details" editing fields={editFields(holder)} submitLabel="Save" onCancel={() => setOpen(null)}
                  onSubmit={async (v) => { await api.patch(`${base}/${holder.id}`, diffBoard(holder, v)); setOpen(null); await load(); }} />
              )}
              {holder && open?.kind === "retire" && open.id === holder.id && (
                <BoardForm title={`Record retirement of ${holder.fullName}`} retireOnly fields={{ retirementDate: todayInput() }} submitLabel="Record retirement"
                  min={toInputDate(holder.appointmentDate)} onCancel={() => setOpen(null)}
                  onSubmit={async (v) => { await api.patch(`${base}/${holder.id}`, { retirementDate: v.retirementDate }); setOpen(null); await load(); }} />
              )}
            </div>
          );
        })}
      </div>

      <h3 className="mb-2 mt-6 font-semibold">Past holders</h3>
      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
            <tr>
              <th className="px-4 py-2">Position</th><th className="px-4 py-2">Name</th><th className="px-4 py-2">ID number</th>
              <th className="px-4 py-2">Phone</th><th className="px-4 py-2">Appointed</th><th className="px-4 py-2">Retired</th><th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody>
            {past.map((r) => (
              <Fragment key={r.id}>
                <tr className="border-t border-gray-100 text-gray-600">
                  <td className="px-4 py-2">{r.positionLabel}</td>
                  <td className="px-4 py-2 font-medium">{r.fullName}</td>
                  <td className="px-4 py-2">{r.nationalId}</td>
                  <td className="px-4 py-2 whitespace-nowrap">{r.phoneNumber}</td>
                  <td className="px-4 py-2 whitespace-nowrap">{fmtDate(r.appointmentDate)}</td>
                  <td className="px-4 py-2 whitespace-nowrap">{fmtDate(r.retirementDate)}</td>
                  <td className="space-x-3 px-4 py-2 text-right text-xs font-medium whitespace-nowrap">
                    <button onClick={() => setOpen({ kind: "edit", id: r.id })} className="text-kenya-green hover:underline">Edit</button>
                    {canDelete && <button onClick={() => remove(r)} className="text-gray-400 hover:text-red-600 hover:underline">Delete</button>}
                  </td>
                </tr>
                {open?.kind === "edit" && open.id === r.id && (
                  <tr><td colSpan={7} className="bg-gray-50/70 p-3">
                    <BoardForm title="Edit details" editing fields={editFields(r)} submitLabel="Save" onCancel={() => setOpen(null)}
                      onSubmit={async (v) => { await api.patch(`${base}/${r.id}`, diffBoard(r, v)); setOpen(null); await load(); }} />
                  </td></tr>
                )}
              </Fragment>
            ))}
            {past.length === 0 && <tr><td colSpan={7} className="px-4 py-6 text-center text-gray-400">No one has retired from the board yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const editFields = (r) => ({
  fullName: r.fullName, nationalId: r.nationalId, phoneNumber: r.phoneNumber,
  appointmentDate: toInputDate(r.appointmentDate), retirementDate: toInputDate(r.retirementDate),
});
// Send only what changed; clearing the retirement date sends null.
function diffBoard(r, v) {
  const was = editFields(r);
  const body = {};
  for (const k of ["fullName", "nationalId", "phoneNumber", "appointmentDate"]) if (v[k].trim() && v[k].trim() !== was[k]) body[k] = v[k].trim();
  if (v.retirementDate !== was.retirementDate) body.retirementDate = v.retirementDate || null;
  return body;
}

// One small form for appointing, editing and recording a retirement.
function BoardForm({ title, fields, submitLabel, onSubmit, onCancel, editing, retireOnly, min }) {
  const [v, setV] = useState(fields);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await onSubmit(v);
    } catch (err) {
      setError(err?.response?.data?.error || "Couldn't save that");
      setBusy(false);
    }
  }
  const set = (k) => (e) => setV({ ...v, [k]: e.target.value });

  return (
    <form onSubmit={submit} className="mt-3 space-y-2 rounded-md border border-gray-100 bg-gray-50/70 p-3">
      <p className="text-xs font-semibold text-gray-600">{title}</p>
      {!retireOnly && (
        <>
          <Field label="Full name"><input required className={inputCls} value={v.fullName} onChange={set("fullName")} /></Field>
          <Field label="ID number"><input required inputMode="numeric" autoComplete="off" className={inputCls} value={v.nationalId} onChange={set("nationalId")} /></Field>
          <Field label="Phone number"><input required type="tel" placeholder="0712 345 678" className={inputCls} value={v.phoneNumber} onChange={set("phoneNumber")} /></Field>
          <Field label="Date of appointment"><input required type="date" className={inputCls} value={v.appointmentDate} onChange={set("appointmentDate")} /></Field>
        </>
      )}
      {(editing || retireOnly) && (
        <Field label="Retirement date" hint={retireOnly ? undefined : "Blank = still serving"}>
          <input required={retireOnly} type="date" min={min || v.appointmentDate || undefined} className={inputCls} value={v.retirementDate} onChange={set("retirementDate")} />
        </Field>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <button type="submit" disabled={busy} className="rounded-md bg-kenya-green px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">{busy ? "Saving…" : submitLabel}</button>
        <button type="button" onClick={onCancel} className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium">Cancel</button>
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </form>
  );
}

function AGMTab({ coop, onChange }) {
  const [form, setForm] = useState({ agmType: "ANNUAL", meetingDate: "" });
  const [notice, setNotice] = useState(null);
  const [minutes, setMinutes] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  // An AGM can be recorded with its notice letter (and minutes, if the
  // meeting has already happened); either can also be added afterwards.
  async function record(e) {
    e.preventDefault();
    setError(""); setBusy(true);
    try {
      const data = new FormData();
      data.append("agmType", form.agmType);
      data.append("meetingDate", form.meetingDate);
      if (notice) data.append("notice", notice);
      if (minutes) data.append("minutes", minutes);
      await api.post(`/cooperatives/${coop.id}/governance/agms`, data);
      setForm({ agmType: "ANNUAL", meetingDate: "" });
      setNotice(null); setMinutes(null); e.target.reset();
      onChange();
    } catch (err) {
      setError(err?.response?.data?.error || "Failed to record AGM");
    } finally { setBusy(false); }
  }

  const fileInput = "block w-full text-xs file:mr-3 file:rounded-md file:border-0 file:bg-kenya-green/10 file:px-3 file:py-1.5 file:text-kenya-green";

  return (
    <div>
      <form onSubmit={record} className="mb-4 grid grid-cols-2 gap-3 rounded-lg border border-gray-200 bg-white p-4 md:grid-cols-4">
        <select className="rounded-md border border-gray-300 px-3 py-2 text-sm"
          value={form.agmType} onChange={(e) => setForm({ ...form, agmType: e.target.value })}>
          <option value="ANNUAL">Annual</option>
          <option value="EXTRAORDINARY">Extraordinary</option>
        </select>
        <input required type="date" className="rounded-md border border-gray-300 px-3 py-2 text-sm"
          value={form.meetingDate} onChange={(e) => setForm({ ...form, meetingDate: e.target.value })} />
        <button type="submit" disabled={busy} className="rounded-md bg-kenya-green px-3 py-2 text-sm font-semibold text-white disabled:opacity-50 md:col-span-2">
          {busy ? "Saving…" : "Record AGM"}
        </button>
        <label className="col-span-2 text-xs text-gray-600">Letter calling the AGM (optional)
          <input type="file" accept={ACCEPT.document} onChange={(e) => setNotice(e.target.files?.[0] || null)} className={`mt-1 ${fileInput}`} />
        </label>
        <label className="col-span-2 text-xs text-gray-600">Signed minutes (optional, or add after the meeting)
          <input type="file" accept={ACCEPT.document} onChange={(e) => setMinutes(e.target.files?.[0] || null)} className={`mt-1 ${fileInput}`} />
        </label>
        <p className="col-span-2 text-xs text-gray-400 md:col-span-4">{HINT.document}</p>
      </form>
      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

      <div className="space-y-2">
        {(coop.agms || []).map((a) => <AGMRow key={a.id} coop={coop} agm={a} onChange={onChange} />)}
        {(coop.agms || []).length === 0 && <p className="text-gray-400">No AGMs recorded yet.</p>}
      </div>
    </div>
  );
}

function AGMRow({ coop, agm, onChange }) {
  const noticeId = fileIdOf(agm.noticeStorageKey);
  const minutesId = fileIdOf(agm.minutesStorageKey);
  const [msg, setMsg] = useState("");

  async function attach(field, file) {
    if (!file) return;
    setMsg("");
    try {
      const data = new FormData();
      data.append(field, file);
      await api.post(`/cooperatives/${coop.id}/governance/agms/${agm.id}/files`, data);
      onChange();
    } catch (err) {
      setMsg(err?.response?.data?.error || "Upload failed");
    }
  }

  const doc = (id, label, field) => id ? (
    <button onClick={() => openFile(api, id)} className="text-xs font-medium text-kenya-green hover:underline">View {label}</button>
  ) : (
    <label className="cursor-pointer text-xs font-medium text-gray-500 hover:text-kenya-green">
      + Add {label}
      <input type="file" accept={ACCEPT.document} className="hidden" onChange={(e) => attach(field, e.target.files?.[0])} />
    </label>
  );

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-gray-200 bg-white p-3 text-sm">
      <span><span className="font-medium">{agm.agmType}</span> — {new Date(agm.meetingDate).toLocaleDateString()}</span>
      <span className="flex items-center gap-4">
        {doc(noticeId, "notice", "notice")}
        {doc(minutesId, "minutes", "minutes")}
      </span>
      {msg && <p className="w-full text-xs text-red-600">{msg}</p>}
    </div>
  );
}

const CONTRIBUTION_TYPES = ["MONTHLY_CONTRIBUTION", "SHARE_CAPITAL_TOPUP", "LOAN_REPAYMENT", "OTHER"];
const CONTRIBUTION_METHODS = ["MPESA", "CASH", "BANK_TRANSFER", "OTHER"];

function ContributionsTab({ coop }) {
  const [contributions, setContributions] = useState([]);
  const [summary, setSummary] = useState(null);
  const [form, setForm] = useState({
    memberId: "",
    amount: "",
    type: "MONTHLY_CONTRIBUTION",
    method: "CASH",
    contributionDate: new Date().toISOString().slice(0, 10),
  });
  const [error, setError] = useState("");

  function load() {
    api.get(`/cooperatives/${coop.id}/contributions`).then((res) => setContributions(res.data)).catch(() => {});
    api.get(`/cooperatives/${coop.id}/contributions/summary`).then((res) => setSummary(res.data)).catch(() => {});
  }

  useEffect(load, [coop.id]);

  async function recordContribution(e) {
    e.preventDefault();
    setError("");
    try {
      await api.post(`/cooperatives/${coop.id}/contributions`, { ...form, amount: Number(form.amount) });
      setForm({ ...form, memberId: "", amount: "" });
      load();
    } catch (err) {
      setError(err?.response?.data?.error || "Failed to record contribution");
    }
  }

  return (
    <div>
      <p className="mb-4 rounded-md bg-kenya-green/5 px-4 py-2 text-xs text-gray-600">
        This records staff-assisted contributions (cash or bank transfer confirmed in person).
        M-Pesa self-service contributions from the member&apos;s own dashboard are on the roadmap —
        this ledger is the same one that integration will write to, via the <code>method</code> and{" "}
        <code>externalRef</code> fields already in place.
      </p>

      {summary && (
        <div className="mb-4 grid grid-cols-2 gap-4 md:grid-cols-3">
          <div className="rounded-lg border border-gray-200 bg-white p-4">
            <p className="text-xs uppercase text-gray-500">Total Entries</p>
            <p className="mt-1 text-xl font-bold text-kenya-green">{summary.totalContributions}</p>
          </div>
          <div className="rounded-lg border border-gray-200 bg-white p-4">
            <p className="text-xs uppercase text-gray-500">This Month</p>
            <p className="mt-1 text-xl font-bold text-kenya-green">KES {summary.thisMonthTotal.toLocaleString()}</p>
          </div>
          <div className="rounded-lg border border-gray-200 bg-white p-4">
            <p className="text-xs uppercase text-gray-500">Share Capital Total</p>
            <p className="mt-1 text-xl font-bold text-kenya-green">
              KES {(summary.totalsByType.SHARE_CAPITAL_TOPUP || 0).toLocaleString()}
            </p>
          </div>
        </div>
      )}

      <form onSubmit={recordContribution} className="mb-4 grid grid-cols-2 gap-3 rounded-lg border border-gray-200 bg-white p-4 md:grid-cols-6">
        <select required className="rounded-md border border-gray-300 px-3 py-2 text-sm md:col-span-2"
          value={form.memberId} onChange={(e) => setForm({ ...form, memberId: e.target.value })}>
          <option value="">Select member…</option>
          {(coop.members || []).map((m) => <option key={m.id} value={m.id}>{m.legalName}</option>)}
        </select>
        <input required type="number" min="1" step="0.01" placeholder="Amount (KES)"
          className="rounded-md border border-gray-300 px-3 py-2 text-sm"
          value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
        <select className="rounded-md border border-gray-300 px-3 py-2 text-sm"
          value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
          {CONTRIBUTION_TYPES.map((t) => <option key={t} value={t}>{t.replace(/_/g, " ")}</option>)}
        </select>
        <select className="rounded-md border border-gray-300 px-3 py-2 text-sm"
          value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value })}>
          {CONTRIBUTION_METHODS.map((m) => <option key={m} value={m}>{m.replace(/_/g, " ")}</option>)}
        </select>
        <input required type="date" className="rounded-md border border-gray-300 px-3 py-2 text-sm"
          value={form.contributionDate} onChange={(e) => setForm({ ...form, contributionDate: e.target.value })} />
        <button type="submit" className="rounded-md bg-kenya-green px-3 py-2 text-sm font-semibold text-white md:col-span-6">
          Record Contribution
        </button>
      </form>
      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
            <tr>
              <th className="px-4 py-2">Member</th>
              <th className="px-4 py-2">Amount</th>
              <th className="px-4 py-2">Type</th>
              <th className="px-4 py-2">Method</th>
              <th className="px-4 py-2">Date</th>
            </tr>
          </thead>
          <tbody>
            {contributions.map((c) => (
              <tr key={c.id} className="border-t border-gray-100">
                <td className="px-4 py-2 font-medium">{c.member?.legalName}</td>
                <td className="px-4 py-2">KES {Number(c.amount).toLocaleString()}</td>
                <td className="px-4 py-2">{c.type.replace(/_/g, " ")}</td>
                <td className="px-4 py-2">{c.method.replace(/_/g, " ")}</td>
                <td className="px-4 py-2">{new Date(c.contributionDate).toLocaleDateString()}</td>
              </tr>
            ))}
            {contributions.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-6 text-center text-gray-400">No contributions recorded yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const PRODUCE_UNITS = ["KG", "LITERS", "BAGS", "CRATES", "OTHER"];
const PRODUCE_TYPE_SUGGESTIONS = {
  COFFEE: "Coffee Cherries",
  DAIRY: "Whole Milk",
  TEA: "Tea Leaf (Green Leaf)",
  SUGARCANE: "Sugarcane",
  COTTON: "Raw Cotton",
  CASHEWNUT: "Raw Cashewnuts",
  FISHERIES: "Fresh Fish",
  LIVESTOCK: "Livestock",
  POULTRY: "Eggs",
  MIRAA: "Miraa",
};

function ProduceTab({ coop }) {
  const suggestedType = PRODUCE_TYPE_SUGGESTIONS[coop.valueChain] || "Produce";
  const [deliveries, setDeliveries] = useState([]);
  const [unpaidSummary, setUnpaidSummary] = useState([]);
  const [form, setForm] = useState({
    memberId: "",
    produceType: suggestedType,
    quantity: "",
    unit: "KG",
    qualityGrade: "",
    ratePerUnit: "",
    deliveryDate: new Date().toISOString().slice(0, 10),
  });
  const [error, setError] = useState("");

  function load() {
    api.get(`/cooperatives/${coop.id}/produce`).then((res) => setDeliveries(res.data)).catch(() => {});
    api.get(`/cooperatives/${coop.id}/produce/unpaid-summary`).then((res) => setUnpaidSummary(res.data)).catch(() => {});
  }

  useEffect(load, [coop.id]);

  async function recordDelivery(e) {
    e.preventDefault();
    setError("");
    try {
      await api.post(`/cooperatives/${coop.id}/produce`, {
        ...form,
        quantity: Number(form.quantity),
        ratePerUnit: form.ratePerUnit ? Number(form.ratePerUnit) : undefined,
        qualityGrade: form.qualityGrade || undefined,
      });
      setForm({ ...form, memberId: "", quantity: "", qualityGrade: "" });
      load();
    } catch (err) {
      setError(err?.response?.data?.error || "Failed to record delivery");
    }
  }

  return (
    <div>
      {unpaidSummary.length > 0 && (
        <div className="mb-4 rounded-lg border border-kenya-gold/40 bg-kenya-gold/5 p-4">
          <p className="mb-2 text-sm font-semibold text-kenya-black">Outstanding balances owed to farmers</p>
          <div className="flex flex-wrap gap-3">
            {unpaidSummary.map((m) => (
              <div key={m.memberId} className="rounded-md bg-white px-3 py-2 text-xs shadow-sm">
                <span className="font-medium">{m.memberName}</span>: KES {m.totalOwed.toLocaleString()} ({m.deliveryCount} deliveries)
              </div>
            ))}
          </div>
          <p className="mt-2 text-xs text-gray-500">Settle these from the Payouts tab.</p>
        </div>
      )}

      <form onSubmit={recordDelivery} className="mb-4 grid grid-cols-2 gap-3 rounded-lg border border-gray-200 bg-white p-4 md:grid-cols-7">
        <select required className="rounded-md border border-gray-300 px-3 py-2 text-sm md:col-span-2"
          value={form.memberId} onChange={(e) => setForm({ ...form, memberId: e.target.value })}>
          <option value="">Select member…</option>
          {(coop.members || []).map((m) => <option key={m.id} value={m.id}>{m.legalName}</option>)}
        </select>
        <input required placeholder="Produce type" className="rounded-md border border-gray-300 px-3 py-2 text-sm"
          value={form.produceType} onChange={(e) => setForm({ ...form, produceType: e.target.value })} />
        <input required type="number" min="0.01" step="0.01" placeholder="Quantity" className="rounded-md border border-gray-300 px-3 py-2 text-sm"
          value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} />
        <select className="rounded-md border border-gray-300 px-3 py-2 text-sm"
          value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })}>
          {PRODUCE_UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
        </select>
        <input placeholder="Grade (optional)" className="rounded-md border border-gray-300 px-3 py-2 text-sm"
          value={form.qualityGrade} onChange={(e) => setForm({ ...form, qualityGrade: e.target.value })} />
        <input type="number" min="0" step="0.01" placeholder="Rate/unit KES (optional)" className="rounded-md border border-gray-300 px-3 py-2 text-sm"
          value={form.ratePerUnit} onChange={(e) => setForm({ ...form, ratePerUnit: e.target.value })} />
        <input required type="date" className="rounded-md border border-gray-300 px-3 py-2 text-sm"
          value={form.deliveryDate} onChange={(e) => setForm({ ...form, deliveryDate: e.target.value })} />
        <button type="submit" className="rounded-md bg-kenya-green px-3 py-2 text-sm font-semibold text-white md:col-span-7">
          Record Delivery
        </button>
      </form>
      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
            <tr>
              <th className="px-4 py-2">Member</th>
              <th className="px-4 py-2">Produce</th>
              <th className="px-4 py-2">Quantity</th>
              <th className="px-4 py-2">Grade</th>
              <th className="px-4 py-2">Value</th>
              <th className="px-4 py-2">Date</th>
              <th className="px-4 py-2">Paid</th>
            </tr>
          </thead>
          <tbody>
            {deliveries.map((d) => (
              <tr key={d.id} className="border-t border-gray-100">
                <td className="px-4 py-2 font-medium">{d.member?.legalName}</td>
                <td className="px-4 py-2">{d.produceType}</td>
                <td className="px-4 py-2">{Number(d.quantity).toLocaleString()} {d.unit}</td>
                <td className="px-4 py-2">{d.qualityGrade || "—"}</td>
                <td className="px-4 py-2">{d.totalValue ? `KES ${Number(d.totalValue).toLocaleString()}` : "—"}</td>
                <td className="px-4 py-2">{new Date(d.deliveryDate).toLocaleDateString()}</td>
                <td className="px-4 py-2">{d.paid ? "✓ Paid" : "Pending"}</td>
              </tr>
            ))}
            {deliveries.length === 0 && (
              <tr><td colSpan={7} className="px-4 py-6 text-center text-gray-400">No produce deliveries recorded yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const ASSET_TYPES = ["LIVESTOCK", "POULTRY", "VEHICLE", "PROPERTY_UNIT", "OTHER"];
const ASSET_TYPE_SUGGESTIONS = {
  LIVESTOCK: { type: "LIVESTOCK", label: "e.g. Dairy Cow, Goat" },
  POULTRY: { type: "POULTRY", label: "e.g. Layer Chicken flock" },
  HOUSING: { type: "PROPERTY_UNIT", label: "e.g. Housing Unit / Plot" },
  TRANSPORT: { type: "VEHICLE", label: "e.g. Boda Boda, Matatu" },
};
const ASSET_EVENT_TYPES = ["ACQUIRED", "TRANSFERRED", "SOLD", "DECEASED", "WRITTEN_OFF", "VALUATION_UPDATE", "HEALTH_CHECK"];
const ASSET_STATUS_LABELS = {
  ACTIVE: "Active",
  TRANSFERRED: "Transferred",
  SOLD: "Sold",
  DECEASED: "Deceased",
  WRITTEN_OFF: "Written Off",
};

// Photos of one asset (the cow, the boda boda, the housing unit), shown and
// added inside the asset's expanded row.
function AssetPhotos({ coopId, assetId }) {
  const { files, reload } = useFileList(api, { assetId }, [assetId]);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  async function add(list) {
    if (!list?.length) return;
    setMsg(""); setBusy(true);
    try {
      const data = new FormData();
      Array.from(list).slice(0, 5).forEach((f) => data.append("photos", f));
      await api.post(`/cooperatives/${coopId}/assets/${assetId}/photos`, data);
      reload();
    } catch (err) {
      setMsg(err?.response?.data?.error || "Upload failed");
    } finally { setBusy(false); }
  }
  return (
    <div className="mt-3 border-t border-gray-200 pt-3">
      <p className="mb-2 text-xs font-semibold text-gray-600">Photos</p>
      <div className="flex flex-wrap items-center gap-2">
        {files.map((f) => (
          <button key={f.id} onClick={() => openFile(api, f.id)} title={f.fileName}>
            <AuthedImage client={api} fileId={f.id} alt="Asset photo" className="h-16 w-20 rounded" />
          </button>
        ))}
        <label className="flex h-16 w-20 cursor-pointer flex-col items-center justify-center rounded border border-dashed border-gray-300 text-center text-[10px] text-gray-500 hover:border-kenya-green hover:text-kenya-green">
          {busy ? "Uploading…" : "+ Add photos"}
          <input type="file" multiple accept={ACCEPT.photo} className="hidden" onChange={(e) => add(e.target.files)} />
        </label>
      </div>
      <p className="mt-1 text-[11px] text-gray-400">{HINT.photo}, up to 5 at a time</p>
      {msg && <p className="mt-1 text-xs text-red-600">{msg}</p>}
    </div>
  );
}

function AssetsTab({ coop }) {
  const suggestion = ASSET_TYPE_SUGGESTIONS[coop.valueChain];
  const [assets, setAssets] = useState([]);
  const [form, setForm] = useState({
    memberId: "",
    assetType: suggestion?.type || "OTHER",
    identifier: "",
    description: "",
    acquisitionDate: new Date().toISOString().slice(0, 10),
    acquisitionValue: "",
  });
  const [expandedAssetId, setExpandedAssetId] = useState(null);
  const [eventForm, setEventForm] = useState({ eventType: "HEALTH_CHECK", eventDate: new Date().toISOString().slice(0, 10), notes: "", valueAtEvent: "" });
  const [statementMemberId, setStatementMemberId] = useState("");
  const [error, setError] = useState("");

  function load() {
    api.get(`/cooperatives/${coop.id}/assets`).then((res) => setAssets(res.data)).catch(() => {});
  }
  useEffect(load, [coop.id]);

  async function recordAsset(e) {
    e.preventDefault();
    setError("");
    try {
      await api.post(`/cooperatives/${coop.id}/assets`, {
        ...form,
        acquisitionValue: form.acquisitionValue ? Number(form.acquisitionValue) : undefined,
        description: form.description || undefined,
      });
      setForm({ ...form, memberId: "", identifier: "", description: "", acquisitionValue: "" });
      load();
    } catch (err) {
      setError(err?.response?.data?.error || "Failed to record asset");
    }
  }

  async function recordEvent(assetId) {
    setError("");
    try {
      await api.post(`/cooperatives/${coop.id}/assets/${assetId}/events`, {
        ...eventForm,
        valueAtEvent: eventForm.valueAtEvent ? Number(eventForm.valueAtEvent) : undefined,
        notes: eventForm.notes || undefined,
      });
      setExpandedAssetId(null);
      setEventForm({ eventType: "HEALTH_CHECK", eventDate: new Date().toISOString().slice(0, 10), notes: "", valueAtEvent: "" });
      load();
    } catch (err) {
      setError(err?.response?.data?.error || "Failed to record event");
    }
  }

  async function downloadStatement() {
    if (!statementMemberId) return;
    setError("");
    try {
      const { data } = await api.get(`/cooperatives/${coop.id}/assets/statement`, { params: { memberId: statementMemberId } });
      const rows = [
        ["Asset Statement", data.member.legalName, data.member.nationalId, `Generated ${new Date(data.generatedAt).toLocaleString()}`],
        [],
        ["Type", "Identifier", "Description", "Acquired", "Status", "Current Value"],
        ...data.assets.map((a) => [
          a.assetType, a.identifier, a.description || "", new Date(a.acquisitionDate).toLocaleDateString(),
          ASSET_STATUS_LABELS[a.status] || a.status, a.currentValue || a.acquisitionValue || 0,
        ]),
        [],
        ["Total Active Assets", data.totalActiveAssets],
        ["Total Current Value (KES)", data.totalCurrentValue],
      ];
      const csv = rows.map((r) => r.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
      const blob = new Blob([csv], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `asset-statement-${data.member.legalName.replace(/\s+/g, "_")}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err?.response?.data?.error || "Failed to generate statement");
    }
  }

  return (
    <div>
      <div className="mb-4 rounded-md bg-kenya-green/5 px-4 py-2 text-xs text-gray-600">
        One asset model covers Livestock, Poultry, Housing units, and Transport SACCO vehicles — a dairy cow,
        a boda boda, and a housing unit are all: something a member owns, with a status and a lifecycle of events.
        Feeds directly into the Asset Stability credit factor for this value chain.
      </div>

      <form onSubmit={recordAsset} className="mb-4 grid grid-cols-2 gap-3 rounded-lg border border-gray-200 bg-white p-4 md:grid-cols-6">
        <select required className="rounded-md border border-gray-300 px-3 py-2 text-sm md:col-span-2"
          value={form.memberId} onChange={(e) => setForm({ ...form, memberId: e.target.value })}>
          <option value="">Select member…</option>
          {(coop.members || []).map((m) => <option key={m.id} value={m.id}>{m.legalName}</option>)}
        </select>
        <select className="rounded-md border border-gray-300 px-3 py-2 text-sm"
          value={form.assetType} onChange={(e) => setForm({ ...form, assetType: e.target.value })}>
          {ASSET_TYPES.map((t) => <option key={t} value={t}>{t.replace(/_/g, " ")}</option>)}
        </select>
        <input required placeholder={suggestion ? `Tag/ID (${suggestion.label})` : "Tag / Identifier"} className="rounded-md border border-gray-300 px-3 py-2 text-sm md:col-span-2"
          value={form.identifier} onChange={(e) => setForm({ ...form, identifier: e.target.value })} />
        <input required type="date" className="rounded-md border border-gray-300 px-3 py-2 text-sm"
          value={form.acquisitionDate} onChange={(e) => setForm({ ...form, acquisitionDate: e.target.value })} />
        <input type="number" min="0" step="0.01" placeholder="Value (KES, optional)" className="rounded-md border border-gray-300 px-3 py-2 text-sm"
          value={form.acquisitionValue} onChange={(e) => setForm({ ...form, acquisitionValue: e.target.value })} />
        <input placeholder="Description (breed, model, unit details — optional)" className="rounded-md border border-gray-300 px-3 py-2 text-sm md:col-span-4"
          value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        <button type="submit" className="rounded-md bg-kenya-green px-3 py-2 text-sm font-semibold text-white md:col-span-2">
          Record Asset
        </button>
      </form>
      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

      <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-gray-200 bg-white p-3">
        <span className="text-xs font-medium text-gray-500">Export statement for:</span>
        <select className="rounded-md border border-gray-300 px-2 py-1 text-xs"
          value={statementMemberId} onChange={(e) => setStatementMemberId(e.target.value)}>
          <option value="">Select member…</option>
          {(coop.members || []).map((m) => <option key={m.id} value={m.id}>{m.legalName}</option>)}
        </select>
        <button onClick={downloadStatement} disabled={!statementMemberId}
          className="rounded-md border border-kenya-green px-3 py-1 text-xs font-medium text-kenya-green disabled:opacity-40">
          Download CSV
        </button>
      </div>

      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
            <tr>
              <th className="px-4 py-2">Member</th>
              <th className="px-4 py-2">Type</th>
              <th className="px-4 py-2">ID / Tag</th>
              <th className="px-4 py-2">Acquired</th>
              <th className="px-4 py-2">Value</th>
              <th className="px-4 py-2">Status</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {assets.map((a) => (
              <Fragment key={a.id}>
                <tr className="border-t border-gray-100">
                  <td className="px-4 py-2 font-medium">{a.member?.legalName}</td>
                  <td className="px-4 py-2">{a.assetType.replace(/_/g, " ")}</td>
                  <td className="px-4 py-2">{a.identifier}</td>
                  <td className="px-4 py-2">{new Date(a.acquisitionDate).toLocaleDateString()}</td>
                  <td className="px-4 py-2">{a.currentValue || a.acquisitionValue ? `KES ${Number(a.currentValue || a.acquisitionValue).toLocaleString()}` : "—"}</td>
                  <td className="px-4 py-2">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${a.status === "ACTIVE" ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-600"}`}>
                      {ASSET_STATUS_LABELS[a.status] || a.status}
                    </span>
                  </td>
                  <td className="px-4 py-2">
                    <button onClick={() => setExpandedAssetId(expandedAssetId === a.id ? null : a.id)} className="text-xs font-medium text-kenya-green hover:underline">
                      {expandedAssetId === a.id ? "Cancel" : "Log Event"}
                    </button>
                  </td>
                </tr>
                {expandedAssetId === a.id && (
                  <tr className="border-t border-gray-100 bg-gray-50">
                    <td colSpan={7} className="px-4 py-3">
                      <div className="flex flex-wrap items-end gap-2">
                        <select className="rounded-md border border-gray-300 px-2 py-1 text-xs"
                          value={eventForm.eventType} onChange={(e) => setEventForm({ ...eventForm, eventType: e.target.value })}>
                          {ASSET_EVENT_TYPES.filter((t) => t !== "ACQUIRED").map((t) => <option key={t} value={t}>{t.replace(/_/g, " ")}</option>)}
                        </select>
                        <input type="date" className="rounded-md border border-gray-300 px-2 py-1 text-xs"
                          value={eventForm.eventDate} onChange={(e) => setEventForm({ ...eventForm, eventDate: e.target.value })} />
                        <input type="number" min="0" step="0.01" placeholder="Value (optional)" className="w-32 rounded-md border border-gray-300 px-2 py-1 text-xs"
                          value={eventForm.valueAtEvent} onChange={(e) => setEventForm({ ...eventForm, valueAtEvent: e.target.value })} />
                        <input placeholder="Notes (optional)" className="flex-1 rounded-md border border-gray-300 px-2 py-1 text-xs"
                          value={eventForm.notes} onChange={(e) => setEventForm({ ...eventForm, notes: e.target.value })} />
                        <button onClick={() => recordEvent(a.id)} className="rounded-md bg-kenya-green px-3 py-1 text-xs font-semibold text-white">
                          Save Event
                        </button>
                      </div>
                      <AssetPhotos coopId={coop.id} assetId={a.id} />
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
            {assets.length === 0 && (
              <tr><td colSpan={7} className="px-4 py-6 text-center text-gray-400">No assets recorded yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const CREDIT_STATUS_BADGE = {
  ACTIVE: "bg-green-100 text-green-800",
  EXHAUSTED: "bg-gray-100 text-gray-600",
  EXPIRED: "bg-red-100 text-red-800",
  CANCELLED: "bg-red-100 text-red-800",
};

function InputCreditsTab({ coop }) {
  const [credits, setCredits] = useState([]);
  const [form, setForm] = useState({ memberId: "", programName: "", totalAmount: "", allocatedDate: new Date().toISOString().slice(0, 10), expiryDate: "" });
  const [error, setError] = useState("");

  function load() {
    api.get(`/cooperatives/${coop.id}/input-credits`).then((res) => setCredits(res.data)).catch(() => {});
  }
  useEffect(load, [coop.id]);

  async function allocate(e) {
    e.preventDefault();
    setError("");
    try {
      await api.post(`/cooperatives/${coop.id}/input-credits`, {
        ...form,
        totalAmount: Number(form.totalAmount),
        expiryDate: form.expiryDate || undefined,
      });
      setForm({ ...form, memberId: "", programName: "", totalAmount: "", expiryDate: "" });
      load();
    } catch (err) {
      setError(err?.response?.data?.error || "Failed to allocate credit");
    }
  }

  return (
    <div>
      <div className="mb-4 rounded-md bg-kenya-green/5 px-4 py-2 text-xs text-gray-600">
        Record a government-sourced input credit here (e.g. a fertilizer subsidy round). The farmer
        draws it down as farm inputs at any approved agrovet shop — recorded on the shop's own
        portal, never here — and the shop is reimbursed later from the Agrovet Shops page.
      </div>

      <form onSubmit={allocate} className="mb-4 grid grid-cols-2 gap-3 rounded-lg border border-gray-200 bg-white p-4 md:grid-cols-5">
        <select required className="rounded-md border border-gray-300 px-3 py-2 text-sm md:col-span-2"
          value={form.memberId} onChange={(e) => setForm({ ...form, memberId: e.target.value })}>
          <option value="">Select member…</option>
          {(coop.members || []).map((m) => <option key={m.id} value={m.id}>{m.legalName}</option>)}
        </select>
        <input required placeholder="Programme name (e.g. NARIGP Fertilizer Subsidy)" className="rounded-md border border-gray-300 px-3 py-2 text-sm md:col-span-2"
          value={form.programName} onChange={(e) => setForm({ ...form, programName: e.target.value })} />
        <input required type="number" min="0" step="0.01" placeholder="Amount (KES)" className="rounded-md border border-gray-300 px-3 py-2 text-sm"
          value={form.totalAmount} onChange={(e) => setForm({ ...form, totalAmount: e.target.value })} />
        <input required type="date" className="rounded-md border border-gray-300 px-3 py-2 text-sm"
          value={form.allocatedDate} onChange={(e) => setForm({ ...form, allocatedDate: e.target.value })} />
        <input type="date" placeholder="Expiry (optional)" className="rounded-md border border-gray-300 px-3 py-2 text-sm"
          value={form.expiryDate} onChange={(e) => setForm({ ...form, expiryDate: e.target.value })} />
        <button type="submit" className="rounded-md bg-kenya-green px-3 py-2 text-sm font-semibold text-white md:col-span-2">
          Allocate Credit
        </button>
      </form>
      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
            <tr>
              <th className="px-4 py-2">Member</th>
              <th className="px-4 py-2">Programme</th>
              <th className="px-4 py-2">Allocated</th>
              <th className="px-4 py-2">Remaining</th>
              <th className="px-4 py-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {credits.map((c) => (
              <tr key={c.id} className="border-t border-gray-100">
                <td className="px-4 py-2 font-medium">{c.member?.legalName}</td>
                <td className="px-4 py-2">{c.programName}</td>
                <td className="px-4 py-2">KES {Number(c.totalAmount).toLocaleString()}</td>
                <td className="px-4 py-2">KES {Number(c.remainingAmount).toLocaleString()}</td>
                <td className="px-4 py-2">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${CREDIT_STATUS_BADGE[c.status] || "bg-gray-100"}`}>{c.status}</span>
                </td>
              </tr>
            ))}
            {credits.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-6 text-center text-gray-400">No input credits allocated yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const PAYOUT_TYPES = ["PRODUCE_PAYMENT", "DIVIDEND", "BONUS", "OTHER"];
const PAYOUT_METHODS = ["MPESA", "CASH", "BANK_TRANSFER", "OTHER"];

function PayoutsTab({ coop }) {
  const [payouts, setPayouts] = useState([]);
  const [unpaidSummary, setUnpaidSummary] = useState([]);
  const [unpaidDeliveries, setUnpaidDeliveries] = useState([]);
  const [form, setForm] = useState({
    memberId: "",
    amount: "",
    type: "PRODUCE_PAYMENT",
    method: "CASH",
    periodLabel: "",
    payoutDate: new Date().toISOString().slice(0, 10),
  });
  const [selectedDeliveryIds, setSelectedDeliveryIds] = useState([]);
  const [error, setError] = useState("");

  function load() {
    api.get(`/cooperatives/${coop.id}/payouts`).then((res) => setPayouts(res.data)).catch(() => {});
    api.get(`/cooperatives/${coop.id}/produce/unpaid-summary`).then((res) => setUnpaidSummary(res.data)).catch(() => {});
  }

  useEffect(load, [coop.id]);

  useEffect(() => {
    if (!form.memberId) {
      setUnpaidDeliveries([]);
      setSelectedDeliveryIds([]);
      return;
    }
    api
      .get(`/cooperatives/${coop.id}/produce`, { params: { memberId: form.memberId, paid: "false" } })
      .then((res) => setUnpaidDeliveries(res.data))
      .catch(() => {});
  }, [form.memberId, coop.id]);

  function toggleDelivery(id) {
    setSelectedDeliveryIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  const selectedTotal = unpaidDeliveries
    .filter((d) => selectedDeliveryIds.includes(d.id))
    .reduce((sum, d) => sum + Number(d.totalValue || 0), 0);

  async function recordPayout(e) {
    e.preventDefault();
    setError("");
    try {
      await api.post(`/cooperatives/${coop.id}/payouts`, {
        ...form,
        amount: Number(form.amount),
        produceDeliveryIds: selectedDeliveryIds.length > 0 ? selectedDeliveryIds : undefined,
      });
      setForm({ ...form, memberId: "", amount: "", periodLabel: "" });
      setSelectedDeliveryIds([]);
      load();
    } catch (err) {
      setError(err?.response?.data?.error || "Failed to record payout");
    }
  }

  return (
    <div>
      <div className="mb-4 rounded-md bg-kenya-green/5 px-4 py-2 text-xs text-gray-600">
        This is what feeds the Director&apos;s national disbursement report — every payout recorded here
        shows up in the trickle-down view of how much individual farmers were compensated.
      </div>

      {unpaidSummary.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-2 text-xs text-gray-600">
          <span className="font-medium">Outstanding:</span>
          {unpaidSummary.map((m) => (
            <span key={m.memberId} className="rounded-full bg-gray-100 px-2 py-1">{m.memberName}: KES {m.totalOwed.toLocaleString()}</span>
          ))}
        </div>
      )}

      <form onSubmit={recordPayout} className="mb-4 rounded-lg border border-gray-200 bg-white p-4">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
          <select required className="rounded-md border border-gray-300 px-3 py-2 text-sm md:col-span-2"
            value={form.memberId} onChange={(e) => setForm({ ...form, memberId: e.target.value })}>
            <option value="">Select member…</option>
            {(coop.members || []).map((m) => <option key={m.id} value={m.id}>{m.legalName}</option>)}
          </select>
          <input required type="number" min="1" step="0.01" placeholder="Amount (KES)" className="rounded-md border border-gray-300 px-3 py-2 text-sm"
            value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
          <select className="rounded-md border border-gray-300 px-3 py-2 text-sm"
            value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
            {PAYOUT_TYPES.map((t) => <option key={t} value={t}>{t.replace(/_/g, " ")}</option>)}
          </select>
          <select className="rounded-md border border-gray-300 px-3 py-2 text-sm"
            value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value })}>
            {PAYOUT_METHODS.map((m) => <option key={m} value={m}>{m.replace(/_/g, " ")}</option>)}
          </select>
          <input required type="date" className="rounded-md border border-gray-300 px-3 py-2 text-sm"
            value={form.payoutDate} onChange={(e) => setForm({ ...form, payoutDate: e.target.value })} />
        </div>
        <input placeholder="Period label (e.g. 'July 2026')" className="mt-3 w-full rounded-md border border-gray-300 px-3 py-2 text-sm md:w-64"
          value={form.periodLabel} onChange={(e) => setForm({ ...form, periodLabel: e.target.value })} />

        {unpaidDeliveries.length > 0 && (
          <div className="mt-3 rounded-md border border-gray-100 bg-gray-50 p-3">
            <p className="mb-2 text-xs font-medium text-gray-600">Settle against unpaid deliveries (optional):</p>
            <div className="space-y-1">
              {unpaidDeliveries.map((d) => (
                <label key={d.id} className="flex items-center gap-2 text-xs">
                  <input type="checkbox" checked={selectedDeliveryIds.includes(d.id)} onChange={() => toggleDelivery(d.id)} />
                  {d.produceType} — {Number(d.quantity).toLocaleString()} {d.unit} on {new Date(d.deliveryDate).toLocaleDateString()}
                  {d.totalValue ? ` — KES ${Number(d.totalValue).toLocaleString()}` : ""}
                </label>
              ))}
            </div>
            {selectedDeliveryIds.length > 0 && (
              <p className="mt-2 text-xs font-medium text-kenya-green">Selected total: KES {selectedTotal.toLocaleString()}</p>
            )}
          </div>
        )}

        <button type="submit" className="mt-3 rounded-md bg-kenya-green px-3 py-2 text-sm font-semibold text-white">
          Record Payout
        </button>
      </form>
      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
            <tr>
              <th className="px-4 py-2">Member</th>
              <th className="px-4 py-2">Amount</th>
              <th className="px-4 py-2">Type</th>
              <th className="px-4 py-2">Period</th>
              <th className="px-4 py-2">Date</th>
            </tr>
          </thead>
          <tbody>
            {payouts.map((p) => (
              <tr key={p.id} className="border-t border-gray-100">
                <td className="px-4 py-2 font-medium">{p.member?.legalName}</td>
                <td className="px-4 py-2">KES {Number(p.amount).toLocaleString()}</td>
                <td className="px-4 py-2">{p.type.replace(/_/g, " ")}</td>
                <td className="px-4 py-2">{p.periodLabel || "—"}</td>
                <td className="px-4 py-2">{new Date(p.payoutDate).toLocaleDateString()}</td>
              </tr>
            ))}
            {payouts.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-6 text-center text-gray-400">No payouts recorded yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const BAND_COLORS = {
  AA: "bg-green-100 text-green-800 border-green-300",
  A: "bg-green-50 text-green-700 border-green-200",
  B: "bg-yellow-100 text-yellow-800 border-yellow-300",
  C: "bg-orange-100 text-orange-800 border-orange-300",
  D: "bg-red-100 text-red-800 border-red-300",
};

const FACTOR_LABELS = {
  contributionConsistency: "Contribution Consistency",
  produceConsistency: "Produce Consistency",
  governanceCompliance: "Governance Compliance",
  documentCompliance: "Document Compliance",
  membershipStability: "Membership Stability",
  shareCapitalTrajectory: "Share Capital Trajectory",
  assetStability: "Asset Stability",
};

function CreditScoreTab({ coop }) {
  const [latest, setLatest] = useState(undefined); // undefined = loading, null = none yet
  const [history, setHistory] = useState([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");

  function load() {
    api.get(`/cooperatives/${coop.id}/credit-assessment`).then((res) => setLatest(res.data)).catch((err) => {
      if (err?.response?.status === 403) setError("Your role cannot view credit assessments for this cooperative.");
    });
    api.get(`/cooperatives/${coop.id}/credit-assessment/history`).then((res) => setHistory(res.data)).catch(() => {});
  }

  useEffect(load, [coop.id]);

  async function runAssessment() {
    setRunning(true);
    setError("");
    try {
      await api.post(`/cooperatives/${coop.id}/credit-assessment`);
      load();
    } catch (err) {
      setError(err?.response?.data?.error || "Failed to run assessment");
    } finally {
      setRunning(false);
    }
  }

  if (error) return <p className="text-sm text-red-600">{error}</p>;

  return (
    <div>
      <div className="mb-4 rounded-md border border-kenya-gold/40 bg-kenya-gold/5 px-4 py-3 text-xs text-gray-700">
        <strong>This platform is a trust layer, not a lender.</strong> This score is a creditworthiness
        signal a cooperative can present to a bank or micro-lender — it is not a loan offer, pre-approval,
        or guarantee, and no funds are disbursed here.
      </div>

      <button
        onClick={runAssessment}
        disabled={running}
        className="mb-6 rounded-md bg-kenya-green px-4 py-2 text-sm font-semibold text-white hover:bg-kenya-green/90 disabled:opacity-50"
      >
        {running ? "Running assessment…" : "Run New Assessment"}
      </button>

      {latest === undefined && <p className="text-gray-400">Loading…</p>}
      {latest === null && <p className="text-gray-400">No assessment has been run yet. Click &quot;Run New Assessment&quot; to generate one.</p>}

      {latest && (
        <div className="mb-6 rounded-xl border border-gray-200 bg-white p-6">
          <div className="flex items-center gap-4">
            <div className={`flex h-20 w-20 items-center justify-center rounded-full border-4 text-2xl font-extrabold ${BAND_COLORS[latest.band]}`}>
              {latest.band}
            </div>
            <div>
              <p className="text-3xl font-bold text-kenya-black">{latest.score}<span className="text-base font-normal text-gray-400"> / 100</span></p>
              <p className="text-sm text-gray-500">{latest.breakdown?.bandLabel}</p>
              <p className="mt-1 text-xs text-gray-400">
                Assessed {new Date(latest.createdAt).toLocaleDateString()} by {latest.computedBy?.fullName || "—"}
              </p>
            </div>
          </div>

          <div className="mt-6 space-y-3">
            {latest.breakdown?.factors && Object.entries(latest.breakdown.factors).map(([key, factor]) => (
              <div key={key}>
                <div className="mb-1 flex justify-between text-xs">
                  <span className="font-medium text-gray-700">{FACTOR_LABELS[key] || key}</span>
                  {factor.applicable === false ? (
                    <span className="italic text-gray-400">Not applicable — {coop.valueChain} has no tracked asset</span>
                  ) : (
                    <span className="text-gray-500">{factor.score} / 100 · weight {Math.round((latest.breakdown.weights?.[key] || 0) * 100)}%</span>
                  )}
                </div>
                {factor.applicable === false ? (
                  <div className="h-2 w-full rounded-full bg-gray-50" />
                ) : (
                  <div className="h-2 w-full rounded-full bg-gray-100">
                    <div
                      className="h-2 rounded-full bg-kenya-green"
                      style={{ width: `${factor.score}%` }}
                    />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {history.length > 1 && (
        <div>
          <h3 className="mb-2 font-semibold">History</h3>
          <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
                <tr>
                  <th className="px-4 py-2">Date</th>
                  <th className="px-4 py-2">Score</th>
                  <th className="px-4 py-2">Band</th>
                </tr>
              </thead>
              <tbody>
                {history.map((h) => (
                  <tr key={h.id} className="border-t border-gray-100">
                    <td className="px-4 py-2">{new Date(h.createdAt).toLocaleDateString()}</td>
                    <td className="px-4 py-2">{h.score}</td>
                    <td className="px-4 py-2">{h.band}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
