"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import ProtectedRoute from "../../../components/ProtectedRoute";
import api from "../../../lib/api";

const TABS = ["Members", "Documents", "Governance", "AGM"];

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
      <p className="mb-6 text-sm text-gray-500">
        {coop.registrationNumber} · {coop.county?.name ? `${coop.county.name} County · ` : ""}{coop.subCounty} / {coop.ward}
      </p>

      <div className="mb-6 flex gap-2 border-b border-gray-200">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium ${
              tab === t ? "border-b-2 border-kenya-green text-kenya-green" : "text-gray-500"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "Members" && <MembersTab coop={coop} onChange={reload} />}
      {tab === "Documents" && <DocumentsTab coop={coop} onChange={reload} />}
      {tab === "Governance" && <GovernanceTab coop={coop} onChange={reload} />}
      {tab === "AGM" && <AGMTab coop={coop} onChange={reload} />}
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

const DOC_TYPES = ["BY_LAWS", "MEETING_MINUTES", "CODE_OF_CONDUCT", "AUDIT_REPORT", "SPOT_CHECK_REPORT", "OTHER"];

function DocumentsTab({ coop, onChange }) {
  const [form, setForm] = useState({ docType: "BY_LAWS", title: "" });
  const [error, setError] = useState("");

  async function upload(e) {
    e.preventDefault();
    setError("");
    try {
      // NOTE: storageKey/fileSizeBytes would normally come from a pre-signed
      // upload step against object storage; stubbed here for the scaffold.
      await api.post(`/cooperatives/${coop.id}/documents`, {
        ...form,
        storageKey: `docs/${coop.id}/${Date.now()}-${form.title.replace(/\s+/g, "_")}.pdf`,
        fileSizeBytes: 1024,
      });
      setForm({ docType: "BY_LAWS", title: "" });
      onChange();
    } catch (err) {
      setError(err?.response?.data?.error || "Failed to upload document");
    }
  }

  async function review(docId, approve) {
    await api.post(`/cooperatives/${coop.id}/documents/${docId}/review`, { approve });
    onChange();
  }

  async function approve(docId, approve) {
    await api.post(`/cooperatives/${coop.id}/documents/${docId}/approve`, { approve });
    onChange();
  }

  return (
    <div>
      <form onSubmit={upload} className="mb-4 grid grid-cols-2 gap-3 rounded-lg border border-gray-200 bg-white p-4 md:grid-cols-4">
        <select className="rounded-md border border-gray-300 px-3 py-2 text-sm"
          value={form.docType} onChange={(e) => setForm({ ...form, docType: e.target.value })}>
          {DOC_TYPES.map((t) => <option key={t} value={t}>{t.replace(/_/g, " ")}</option>)}
        </select>
        <input required placeholder="Document title" className="rounded-md border border-gray-300 px-3 py-2 text-sm md:col-span-2"
          value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
        <button type="submit" className="rounded-md bg-kenya-green px-3 py-2 text-sm font-semibold text-white">
          Upload
        </button>
      </form>
      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
            <tr>
              <th className="px-4 py-2">Title</th>
              <th className="px-4 py-2">Type</th>
              <th className="px-4 py-2">Status</th>
              <th className="px-4 py-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {(coop.documents || []).map((d) => (
              <tr key={d.id} className="border-t border-gray-100">
                <td className="px-4 py-2 font-medium">{d.title}</td>
                <td className="px-4 py-2">{d.docType.replace(/_/g, " ")}</td>
                <td className="px-4 py-2">
                  <StatusBadge status={d.status} />
                </td>
                <td className="px-4 py-2 space-x-2">
                  {d.status === "PENDING" && (
                    <>
                      <button onClick={() => review(d.id, true)} className="text-xs font-medium text-kenya-green hover:underline">Review ✓</button>
                      <button onClick={() => review(d.id, false)} className="text-xs font-medium text-red-600 hover:underline">Reject</button>
                    </>
                  )}
                  {d.status === "REVIEWED" && (
                    <>
                      <button onClick={() => approve(d.id, true)} className="text-xs font-medium text-kenya-green hover:underline">Director Approve</button>
                      <button onClick={() => approve(d.id, false)} className="text-xs font-medium text-red-600 hover:underline">Reject</button>
                    </>
                  )}
                </td>
              </tr>
            ))}
            {(coop.documents || []).length === 0 && (
              <tr><td colSpan={4} className="px-4 py-6 text-center text-gray-400">No documents uploaded.</td></tr>
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
  };
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${colors[status] || "bg-gray-100 text-gray-700"}`}>
      {status.replace(/_/g, " ")}
    </span>
  );
}

const ROLES = ["CHAIRPERSON", "VICE_CHAIRPERSON", "SECRETARY", "TREASURER", "BOARD_MEMBER", "EXECUTIVE_MANAGER"];

function GovernanceTab({ coop, onChange }) {
  const [members, setMembers] = useState([{ fullName: "", gender: "MALE", role: "CHAIRPERSON", electionDate: "" }]);
  const [error, setError] = useState("");
  const [complianceWarning, setComplianceWarning] = useState(null);

  function updateMember(idx, field, value) {
    setMembers((prev) => prev.map((m, i) => (i === idx ? { ...m, [field]: value } : m)));
  }

  function addRow() {
    setMembers((prev) => [...prev, { fullName: "", gender: "MALE", role: "BOARD_MEMBER", electionDate: "" }]);
  }

  async function saveCommittee(e, overrideJustification) {
    e?.preventDefault?.();
    setError("");
    setComplianceWarning(null);
    try {
      await api.post(`/cooperatives/${coop.id}/governance/committees`, {
        committeeType: "MANAGEMENT",
        termLengthYears: 3,
        members,
        ...(overrideJustification ? { overrideJustification } : {}),
      });
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
      <h3 className="mb-2 font-semibold">Submit / Update Management Committee</h3>
      <form onSubmit={(e) => saveCommittee(e)} className="mb-4 space-y-2 rounded-lg border border-gray-200 bg-white p-4">
        {members.map((m, i) => (
          <div key={i} className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <input required placeholder="Full name" className="rounded-md border border-gray-300 px-3 py-2 text-sm"
              value={m.fullName} onChange={(e) => updateMember(i, "fullName", e.target.value)} />
            <select className="rounded-md border border-gray-300 px-3 py-2 text-sm"
              value={m.gender} onChange={(e) => updateMember(i, "gender", e.target.value)}>
              <option value="MALE">Male</option>
              <option value="FEMALE">Female</option>
            </select>
            <select className="rounded-md border border-gray-300 px-3 py-2 text-sm"
              value={m.role} onChange={(e) => updateMember(i, "role", e.target.value)}>
              {ROLES.map((r) => <option key={r} value={r}>{r.replace(/_/g, " ")}</option>)}
            </select>
            <input required type="date" className="rounded-md border border-gray-300 px-3 py-2 text-sm"
              value={m.electionDate} onChange={(e) => updateMember(i, "electionDate", e.target.value)} />
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
      </form>

      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

      {complianceWarning && (
        <div className="mb-4 rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-800">
          <p className="font-semibold">{complianceWarning.error}</p>
          <p className="mt-1">{complianceWarning.detail?.reason}</p>
          <p className="mt-2 text-xs">A Director can override this with a logged justification.</p>
          <OverrideForm onOverride={(justification) => saveCommittee(null, justification)} />
        </div>
      )}

      <h3 className="mb-2 mt-6 font-semibold">Existing Committees</h3>
      <div className="space-y-3">
        {(coop.committees || []).map((c) => (
          <div key={c.id} className="rounded-lg border border-gray-200 bg-white p-4">
            <div className="mb-2 flex items-center gap-2">
              <span className="text-sm font-medium">{c.committeeType} Committee</span>
              <StatusBadge status={c.status} />
              {c.complianceOverride && <span className="text-xs text-amber-600">(Director override logged)</span>}
            </div>
            <ul className="text-sm text-gray-600">
              {c.members?.map((m) => (
                <li key={m.id}>
                  {m.fullName} — {m.role.replace(/_/g, " ")} ({m.gender}) · re-election due{" "}
                  {new Date(m.reelectionDueDate).toLocaleDateString()}
                </li>
              ))}
            </ul>
          </div>
        ))}
        {(coop.committees || []).length === 0 && <p className="text-gray-400">No committees recorded yet.</p>}
      </div>
    </div>
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
        onClick={() => onOverride(justification)}
        disabled={justification.length < 10}
        className="rounded-md bg-red-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
      >
        Override & Submit
      </button>
    </div>
  );
}

function AGMTab({ coop, onChange }) {
  const [form, setForm] = useState({ agmType: "ANNUAL", meetingDate: "" });
  const [error, setError] = useState("");

  async function record(e) {
    e.preventDefault();
    setError("");
    try {
      await api.post(`/cooperatives/${coop.id}/governance/agms`, form);
      setForm({ agmType: "ANNUAL", meetingDate: "" });
      onChange();
    } catch (err) {
      setError(err?.response?.data?.error || "Failed to record AGM");
    }
  }

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
        <button type="submit" className="rounded-md bg-kenya-green px-3 py-2 text-sm font-semibold text-white">
          Record AGM
        </button>
      </form>
      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

      <div className="space-y-2">
        {(coop.agms || []).map((a) => (
          <div key={a.id} className="rounded-lg border border-gray-200 bg-white p-3 text-sm">
            <span className="font-medium">{a.agmType}</span> — {new Date(a.meetingDate).toLocaleDateString()}
          </div>
        ))}
        {(coop.agms || []).length === 0 && <p className="text-gray-400">No AGMs recorded yet.</p>}
      </div>
    </div>
  );
}
