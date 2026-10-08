"use client";

import { Fragment, useEffect, useState } from "react";
import ProtectedRoute from "../../components/ProtectedRoute";
import { useAuth } from "../../context/AuthContext";
import api from "../../lib/api";
import LocationPicker from "../../components/LocationPicker";

const ROLES = ["NATIONAL_ADMIN", "DIRECTOR", "SUBCOUNTY_OFFICER", "FIELD_OFFICER", "COOPERATIVE_MANAGER", "OTHER_STAFF"];
const ROLE_LABEL = {
  NATIONAL_ADMIN: "National Admin",
  DIRECTOR: "County Director",
  SUBCOUNTY_OFFICER: "Sub-County Officer",
  FIELD_OFFICER: "Field Officer",
  COOPERATIVE_MANAGER: "Cooperative Manager",
  OTHER_STAFF: "Other",
};
const roleLabel = (r) => ROLE_LABEL[r] || String(r || "").replace(/_/g, " ");

// Mirrors the server's reporting rules (backend/src/utils/hierarchy.js): a
// person reports to someone more senior; "Other" positions may also report
// to another "Other" position. The server enforces this; the form just
// avoids offering choices it would refuse.
const RANK = { NATIONAL_ADMIN: 0, DIRECTOR: 1, SUBCOUNTY_OFFICER: 2, FIELD_OFFICER: 3, COOPERATIVE_MANAGER: 3, OTHER_STAFF: 4 };
const mayReportTo = (sub, sup) => (sub === "OTHER_STAFF" && sup === "OTHER_STAFF") || (RANK[sup] !== undefined && RANK[sub] !== undefined && RANK[sup] < RANK[sub]);

const MODULES = [
  { key: "cooperatives", label: "Cooperatives & members" },
  { key: "documents", label: "Documents" },
  { key: "governance", label: "Governance" },
];
const fmtWhen = (d) => (d ? new Date(d).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "never");
const prettyAction = (a) => String(a || "").toLowerCase().replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

export default function StaffPage() {
  const { user } = useAuth();
  const isNationalAdmin = user?.role === "NATIONAL_ADMIN";
  const [staff, setStaff] = useState([]);
  const [counties, setCounties] = useState([]);
  const [form, setForm] = useState({
    fullName: "", email: "", password: "", role: "FIELD_OFFICER",
    countyId: "", designation: "", phoneNumber: "", subCountyId: "", wardId: "", reportsToId: "",
  });
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [cooperatives, setCooperatives] = useState([]);
  const [assigning, setAssigning] = useState({});

  function load() {
    api.get("/staff").then((res) => setStaff(res.data)).catch((err) =>
      setError(err?.response?.data?.error || "Failed to load staff")
    );
  }

  useEffect(() => {
    load();
    if (isNationalAdmin) api.get("/counties").then((res) => setCounties(res.data)).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Cooperatives for the manager picker: the Director's own county, or the
  // county a National Admin has selected in the form.
  const coopCountyId = isNationalAdmin ? form.countyId : user?.countyId;
  useEffect(() => {
    if (!coopCountyId) { setCooperatives([]); return; }
    api.get("/cooperatives", { params: { countyId: coopCountyId } })
      .then((res) => setCooperatives(res.data))
      .catch(() => setCooperatives([]));
  }, [coopCountyId]);
  const unmanagedCoops = cooperatives.filter((c) => !c.manager);

  // Who the new person can report to: active staff in the same county who are
  // more senior (or, for an "Other" position, another "Other" position).
  const supervisors = staff.filter(
    (s) => s.active && coopCountyId && s.countyId === coopCountyId && mayReportTo(form.role, s.role)
  );
  const isOther = form.role === "OTHER_STAFF";

  async function createStaff(e) {
    e.preventDefault();
    setError("");
    setNotice("");
    try {
      // Send only filled-in fields; blanks used to be sent as "" and rejected.
      const payload = Object.fromEntries(Object.entries(form).filter(([, v]) => v !== ""));
      await api.post("/staff", payload);
      setNotice(`${form.fullName} created as ${roleLabel(form.role)}${form.role === "OTHER_STAFF" && form.designation ? ` (${form.designation})` : ""}. They can log in now.`);
      setForm({ fullName: "", email: "", password: "", role: "FIELD_OFFICER", countyId: "", cooperativeId: "", designation: "", phoneNumber: "", subCountyId: "", wardId: "", reportsToId: "" });
      load();
    } catch (err) {
      setError(err?.response?.data?.error || "Failed to create staff account");
    }
  }

  // Give an existing Sub-County Officer their sub-county (officers created
  // before sub-counties became dropdowns don't have one yet).
  const [subAssign, setSubAssign] = useState({});
  async function assignSubCounty(staffId) {
    setError(""); setNotice("");
    try {
      await api.patch(`/staff/${staffId}`, { subCountyId: subAssign[staffId] });
      setNotice("Sub-county assigned. That officer now sees only their sub-county.");
      setSubAssign({ ...subAssign, [staffId]: "" });
      load();
    } catch (err) {
      setError(err?.response?.data?.error || "Failed to assign sub-county");
    }
  }

  async function assignCooperative(staffId) {
    const cooperativeId = assigning[staffId];
    if (!cooperativeId) return;
    setError(""); setNotice("");
    try {
      await api.patch(`/staff/${staffId}`, { cooperativeId });
      setNotice("Cooperative assigned. The manager can now open it.");
      setAssigning({ ...assigning, [staffId]: "" });
      load();
      api.get("/cooperatives", { params: { countyId: coopCountyId } }).then((res) => setCooperatives(res.data)).catch(() => {});
    } catch (err) {
      setError(err?.response?.data?.error || "Failed to assign cooperative");
    }
  }

  async function deactivate(s) {
    if (!window.confirm(`Deactivate ${s.fullName}? They will no longer be able to sign in. You can reactivate them later.`)) return;
    setError(""); setNotice("");
    try {
      await api.delete(`/staff/${s.id}`);
      setNotice(`${s.fullName} deactivated.`);
      load();
    } catch (err) {
      setError(err?.response?.data?.error || "Failed to deactivate");
    }
  }

  async function reactivate(s) {
    setError(""); setNotice("");
    try {
      await api.post(`/staff/${s.id}/reactivate`);
      setNotice(`${s.fullName} reactivated.`);
      load();
    } catch (err) {
      setError(err?.response?.data?.error || "Failed to reactivate");
    }
  }

  // Row panel: "activity" (what they have done) or "access" (what they can open).
  const [panel, setPanel] = useState({ id: null, kind: null });
  const togglePanel = (id, kind) => setPanel((p) => (p.id === id && p.kind === kind ? { id: null, kind: null } : { id, kind }));

  if (user?.role !== "NATIONAL_ADMIN" && user?.role !== "DIRECTOR" && user?.role !== "SUBCOUNTY_OFFICER") {
    return (
      <ProtectedRoute>
        <p className="text-gray-500">You don&apos;t have access to this section.</p>
      </ProtectedRoute>
    );
  }

  const canManage = user?.role === "NATIONAL_ADMIN" || user?.role === "DIRECTOR";
  const colCount = 5 + (isNationalAdmin ? 1 : 0) + (canManage ? 1 : 0);

  return (
    <ProtectedRoute>
      <h1 className="mb-6 text-2xl font-bold">Staff & Access Management</h1>

      {(user?.role === "NATIONAL_ADMIN" || user?.role === "DIRECTOR") && (
        <form onSubmit={createStaff} className="mb-6 grid grid-cols-2 gap-3 rounded-lg border border-gray-200 bg-white p-4 md:grid-cols-4">
          <input required placeholder="Full name" className="rounded-md border border-gray-300 px-3 py-2 text-sm"
            value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} />
          <input required type="email" placeholder="Email" className="rounded-md border border-gray-300 px-3 py-2 text-sm"
            value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          <input required type="password" placeholder="Temporary password" className="rounded-md border border-gray-300 px-3 py-2 text-sm"
            value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          <select className="rounded-md border border-gray-300 px-3 py-2 text-sm"
            value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value, cooperativeId: "", reportsToId: "" })}>
            {ROLES.filter((r) => isNationalAdmin || !["NATIONAL_ADMIN", "DIRECTOR"].includes(r)).map((r) => (
              <option key={r} value={r}>{roleLabel(r)}</option>
            ))}
          </select>
          {isNationalAdmin && (
            <select required className="rounded-md border border-gray-300 px-3 py-2 text-sm"
              value={form.countyId} onChange={(e) => setForm({ ...form, countyId: e.target.value })}>
              <option value="">Select county…</option>
              {counties.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          )}
          {form.role === "COOPERATIVE_MANAGER" && (
            <select required className="rounded-md border border-gray-300 px-3 py-2 text-sm"
              value={form.cooperativeId || ""} onChange={(e) => setForm({ ...form, cooperativeId: e.target.value })}>
              <option value="">
                {!coopCountyId ? "Select a county first…" : unmanagedCoops.length ? "Cooperative to manage…" : "No unmanaged cooperatives in this county"}
              </option>
              {unmanagedCoops.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          )}
          <input required={isOther} placeholder={isOther ? "Position, e.g. Accountant, Store Keeper" : "Designation"}
            className={`rounded-md border px-3 py-2 text-sm ${isOther ? "border-kenya-green" : "border-gray-300"}`}
            value={form.designation} onChange={(e) => setForm({ ...form, designation: e.target.value })} />
          {/* Reporting line. Required for "Other" positions, optional otherwise;
              the server checks it (same county, more senior, no loops). */}
          {form.role !== "NATIONAL_ADMIN" && (
            <select required={isOther} className="rounded-md border border-gray-300 px-3 py-2 text-sm"
              value={form.reportsToId} onChange={(e) => setForm({ ...form, reportsToId: e.target.value })}>
              <option value="">
                {!coopCountyId ? "Select a county first…" : isOther ? "Reports to…" : "Reports to (optional)…"}
              </option>
              {supervisors.map((s) => (
                <option key={s.id} value={s.id}>{s.fullName} — {s.designation || roleLabel(s.role)}</option>
              ))}
            </select>
          )}
          <input placeholder="Phone" className="rounded-md border border-gray-300 px-3 py-2 text-sm"
            value={form.phoneNumber} onChange={(e) => setForm({ ...form, phoneNumber: e.target.value })} />
          {/* For a Sub-County Officer the sub-county is required: it decides
              everything they can see. Optional for other roles. */}
          <LocationPicker
            required={form.role === "SUBCOUNTY_OFFICER"}
            countyId={isNationalAdmin ? form.countyId : user?.countyId}
            value={{ subCountyId: form.subCountyId, wardId: form.wardId }}
            onChange={(loc) => setForm({ ...form, subCountyId: loc.subCountyId, wardId: loc.wardId })}
            selectClassName="rounded-md border border-gray-300 px-3 py-2 text-sm disabled:bg-gray-50"
          />
          {isOther && (
            <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800 md:col-span-4">
              <b>Other</b> is for any position not listed (accountant, clerk, store keeper and so on). The position and who the person reports to are
              required, and the reporting line must run up to a more senior person in the same county. They start with view-only access; use
              <b> Access</b> in the table to change it. Only County Directors and the National Admin can see and manage these accounts.
            </p>
          )}
          <button type="submit" className="rounded-md bg-kenya-green px-3 py-2 text-sm font-semibold text-white md:col-span-4">
            Create Staff Account
          </button>
        </form>
      )}
      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}
      {notice && <p className="mb-4 text-sm text-green-700">{notice}</p>}

      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
            <tr>
              <th className="px-4 py-2">Name</th>
              <th className="px-4 py-2">Role / Position</th>
              <th className="px-4 py-2">Reports to</th>
              {isNationalAdmin && <th className="px-4 py-2">County</th>}
              <th className="px-4 py-2">Sub-County / Ward</th>
              <th className="px-4 py-2">Status</th>
              {(user?.role === "NATIONAL_ADMIN" || user?.role === "DIRECTOR") && <th className="px-4 py-2">Actions</th>}
            </tr>
          </thead>
          <tbody>
            {staff.map((s) => (
              <Fragment key={s.id}>
              <tr className="border-t border-gray-100">
                <td className="px-4 py-2 font-medium">{s.fullName}</td>
                <td className="px-4 py-2">
                  {roleLabel(s.role)}
                  {s.designation && <div className="text-xs text-gray-500">{s.designation}</div>}
                  {s.role === "COOPERATIVE_MANAGER" && (
                    <div className={`text-xs ${s.managedCoops?.length ? "text-gray-500" : "font-medium text-kenya-red"}`}>
                      {s.managedCoops?.length ? s.managedCoops.map((c) => c.name).join(", ") : "Not linked to a cooperative"}
                    </div>
                  )}
                  {["SUBCOUNTY_OFFICER", "FIELD_OFFICER", "COOPERATIVE_MANAGER"].includes(s.role) && s.permissions?.length === 0 && (
                    <div className="text-xs font-medium text-kenya-red">No permissions: run fix:staff-access</div>
                  )}
                  {s.role === "OTHER_STAFF" && !s.permissions?.some((p) => p.canView || p.canEdit) && (
                    <div className="text-xs font-medium text-amber-700">No access granted</div>
                  )}
                </td>
                <td className="px-4 py-2 text-gray-700">
                  <ReportsToCell s={s} staff={staff} canManage={canManage} onSaved={(m) => { setNotice(m); load(); }} onError={setError} />
                </td>
                {isNationalAdmin && <td className="px-4 py-2">{s.county?.name || "—"}</td>}
                <td className="px-4 py-2">
                  {s.subCounty || s.ward ? `${s.subCounty || "—"} / ${s.ward || "—"}` : "—"}
                  {s.role === "SUBCOUNTY_OFFICER" && !s.subCountyId && (
                    <div className="mt-1 text-xs font-medium text-kenya-red">
                      No sub-county: sees the whole county until one is assigned
                      {(isNationalAdmin || user?.role === "DIRECTOR") && (
                        <div className="mt-1 flex gap-1">
                          <LocationPicker
                            showWard={false}
                            countyId={s.countyId}
                            value={{ subCountyId: subAssign[s.id] || "" }}
                            onChange={(loc) => setSubAssign({ ...subAssign, [s.id]: loc.subCountyId })}
                            selectClassName="rounded-md border border-gray-300 px-2 py-1 text-xs font-normal text-gray-800"
                          />
                          <button onClick={() => assignSubCounty(s.id)} disabled={!subAssign[s.id]}
                            className="text-xs font-medium text-kenya-green hover:underline disabled:opacity-40">Assign</button>
                        </div>
                      )}
                    </div>
                  )}
                </td>
                <td className="px-4 py-2">{s.active ? "Active" : <span className="text-gray-400">Deactivated</span>}</td>
                {(user?.role === "NATIONAL_ADMIN" || user?.role === "DIRECTOR") && (
                  <td className="px-4 py-2">
                    {s.role === "COOPERATIVE_MANAGER" && !s.managedCoops?.length && (
                      <div className="mb-1 flex gap-1">
                        <select className="rounded-md border border-gray-300 px-2 py-1 text-xs"
                          value={assigning[s.id] || ""} onChange={(e) => setAssigning({ ...assigning, [s.id]: e.target.value })}>
                          <option value="">Assign cooperative…</option>
                          {unmanagedCoops.filter((c) => !isNationalAdmin || c.county?.id === s.county?.id).map((c) => (
                            <option key={c.id} value={c.id}>{c.name}</option>
                          ))}
                        </select>
                        <button onClick={() => assignCooperative(s.id)} disabled={!assigning[s.id]}
                          className="text-xs font-medium text-kenya-green hover:underline disabled:opacity-40">Assign</button>
                      </div>
                    )}
                    <div className="flex flex-wrap gap-x-3 gap-y-1">
                      <button onClick={() => togglePanel(s.id, "activity")} className="text-xs font-medium text-kenya-green hover:underline">Activity</button>
                      {!["NATIONAL_ADMIN", "DIRECTOR"].includes(s.role) && (
                        <button onClick={() => togglePanel(s.id, "access")} className="text-xs font-medium text-kenya-green hover:underline">Access</button>
                      )}
                      {s.active && s.id !== user.id && !(user.role === "DIRECTOR" && ["NATIONAL_ADMIN", "DIRECTOR"].includes(s.role)) && (
                        <button onClick={() => deactivate(s)} className="text-xs font-medium text-kenya-red hover:underline">Deactivate</button>
                      )}
                      {!s.active && !(user.role === "DIRECTOR" && ["NATIONAL_ADMIN", "DIRECTOR"].includes(s.role)) && (
                        <button onClick={() => reactivate(s)} className="text-xs font-medium text-kenya-green hover:underline">Reactivate</button>
                      )}
                    </div>
                  </td>
                )}
              </tr>
              {panel.id === s.id && canManage && (
                <tr className="bg-gray-50/70">
                  <td colSpan={colCount} className="p-3">
                    {panel.kind === "activity" ? <ActivityPanel s={s} /> : <AccessPanel s={s} onSaved={(m) => { setNotice(m); load(); }} onError={setError} />}
                  </td>
                </tr>
              )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </ProtectedRoute>
  );
}

// "Reports to" for one person. A Director or National Admin can change it; the
// server checks the rules (same county, more senior, no loops) and says why if not.
function ReportsToCell({ s, staff, canManage, onSaved, onError }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const boss = s.reportsTo;
  const options = staff.filter((x) => x.active && x.id !== s.id && x.countyId === s.countyId && mayReportTo(s.role, x.role));

  async function save() {
    if (!value) return;
    onError("");
    try {
      await api.patch(`/staff/${s.id}`, { reportsToId: value });
      setEditing(false);
      onSaved(`${s.fullName} now reports to ${options.find((o) => o.id === value)?.fullName || "the selected person"}.`);
    } catch (err) {
      onError(err?.response?.data?.error || "Could not change the reporting line");
    }
  }

  if (s.role === "NATIONAL_ADMIN") return <span className="text-gray-400">—</span>;
  return (
    <div className="text-sm">
      {boss ? boss.fullName : <span className={s.role === "OTHER_STAFF" ? "font-medium text-kenya-red" : "text-gray-400"}>{s.role === "OTHER_STAFF" ? "Not set" : "—"}</span>}
      {canManage && s.role !== "DIRECTOR" && !editing && (
        <button onClick={() => { setValue(s.reportsToId || ""); setEditing(true); }} className="ml-2 text-xs text-kenya-green hover:underline">
          {boss ? "Change" : "Set"}
        </button>
      )}
      {editing && (
        <div className="mt-1 flex gap-1">
          <select className="rounded-md border border-gray-300 px-2 py-1 text-xs" value={value} onChange={(e) => setValue(e.target.value)}>
            <option value="">Choose…</option>
            {options.map((o) => <option key={o.id} value={o.id}>{o.fullName} — {o.designation || roleLabel(o.role)}</option>)}
          </select>
          <button onClick={save} disabled={!value} className="text-xs font-medium text-kenya-green hover:underline disabled:opacity-40">Save</button>
          <button onClick={() => setEditing(false)} className="text-xs text-gray-500 hover:underline">Cancel</button>
        </div>
      )}
    </div>
  );
}

// What a person has done in the system: last sign-in and recent actions.
function ActivityPanel({ s }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => {
    api.get(`/staff/${s.id}/activity`).then((r) => setData(r.data)).catch((e) => setError(e?.response?.data?.error || "Could not load activity"));
  }, [s.id]);
  if (error) return <p className="text-xs text-red-600">{error}</p>;
  if (!data) return <p className="text-xs text-gray-400">Loading…</p>;
  return (
    <div>
      <p className="mb-2 text-xs text-gray-600">
        <b>{s.fullName}</b> · last signed in: <span className="text-gray-800">{fmtWhen(data.lastLoginAt)}</span>
      </p>
      {data.recent.length === 0 ? (
        <p className="text-xs text-gray-400">No recorded activity yet.</p>
      ) : (
        <div className="max-h-56 overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="text-left uppercase text-gray-400"><tr><th className="py-1 pr-3">When</th><th className="py-1 pr-3">Action</th><th className="py-1">On</th></tr></thead>
            <tbody>
              {data.recent.map((a) => (
                <tr key={a.id} className="border-t border-gray-100 text-gray-700">
                  <td className="py-1 pr-3 whitespace-nowrap">{fmtWhen(a.createdAt)}</td>
                  <td className="py-1 pr-3">{prettyAction(a.action)}</td>
                  <td className="py-1">{a.entityType}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// What a person can open: view/edit per module. Saved with the button, not on
// every tick, so a half-finished change never goes live.
function AccessPanel({ s, onSaved, onError }) {
  const initial = Object.fromEntries(MODULES.map((m) => {
    const p = (s.permissions || []).find((x) => x.module === m.key);
    return [m.key, { canView: !!p?.canView, canEdit: !!p?.canEdit }];
  }));
  const [perm, setPerm] = useState(initial);
  const [busy, setBusy] = useState(false);

  function toggle(key, field, checked) {
    setPerm((p) => {
      const cur = { ...p[key], [field]: checked };
      if (field === "canEdit" && checked) cur.canView = true;   // editing needs viewing
      if (field === "canView" && !checked) cur.canEdit = false; // no view, no edit
      return { ...p, [key]: cur };
    });
  }

  async function save() {
    setBusy(true);
    onError("");
    try {
      for (const m of MODULES) {
        const was = initial[m.key], now = perm[m.key];
        if (was.canView !== now.canView || was.canEdit !== now.canEdit) {
          await api.put(`/staff/${s.id}/permissions`, { module: m.key, canView: now.canView, canEdit: now.canEdit });
        }
      }
      onSaved(`Access updated for ${s.fullName}.`);
    } catch (err) {
      onError(err?.response?.data?.error || "Could not save access");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <p className="mb-2 text-xs text-gray-600">What <b>{s.fullName}</b> can open. Approving documents and overriding rules stay with Directors.</p>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        {MODULES.map((m) => (
          <div key={m.key} className="text-xs text-gray-700">
            <span className="mr-2 font-medium">{m.label}</span>
            <label className="mr-2"><input type="checkbox" checked={perm[m.key].canView} onChange={(e) => toggle(m.key, "canView", e.target.checked)} /> View</label>
            <label><input type="checkbox" checked={perm[m.key].canEdit} onChange={(e) => toggle(m.key, "canEdit", e.target.checked)} /> Edit</label>
          </div>
        ))}
        <button onClick={save} disabled={busy} className="rounded-md bg-kenya-green px-3 py-1 text-xs font-semibold text-white disabled:opacity-50">{busy ? "Saving…" : "Save access"}</button>
      </div>
    </div>
  );
}
