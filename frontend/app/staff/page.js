"use client";

import { useEffect, useState } from "react";
import ProtectedRoute from "../../components/ProtectedRoute";
import { useAuth } from "../../context/AuthContext";
import api from "../../lib/api";

const ROLES = ["NATIONAL_ADMIN", "DIRECTOR", "SUBCOUNTY_OFFICER", "FIELD_OFFICER", "COOPERATIVE_MANAGER"];

export default function StaffPage() {
  const { user } = useAuth();
  const isNationalAdmin = user?.role === "NATIONAL_ADMIN";
  const [staff, setStaff] = useState([]);
  const [counties, setCounties] = useState([]);
  const [form, setForm] = useState({
    fullName: "", email: "", password: "", role: "FIELD_OFFICER",
    countyId: "", designation: "", phoneNumber: "", subCounty: "", ward: "",
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

  async function createStaff(e) {
    e.preventDefault();
    setError("");
    setNotice("");
    try {
      // Send only filled-in fields; blanks used to be sent as "" and rejected.
      const payload = Object.fromEntries(Object.entries(form).filter(([, v]) => v !== ""));
      await api.post("/staff", payload);
      setNotice(`${form.fullName} created as ${form.role.replace(/_/g, " ")}. They can log in now.`);
      setForm({ fullName: "", email: "", password: "", role: "FIELD_OFFICER", countyId: "", cooperativeId: "", designation: "", phoneNumber: "", subCounty: "", ward: "" });
      load();
    } catch (err) {
      setError(err?.response?.data?.error || "Failed to create staff account");
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

  async function deactivate(id) {
    await api.delete(`/staff/${id}`);
    load();
  }

  if (user?.role !== "NATIONAL_ADMIN" && user?.role !== "DIRECTOR" && user?.role !== "SUBCOUNTY_OFFICER") {
    return (
      <ProtectedRoute>
        <p className="text-gray-500">You don&apos;t have access to this section.</p>
      </ProtectedRoute>
    );
  }

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
            value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value, cooperativeId: "" })}>
            {ROLES.filter((r) => isNationalAdmin || !["NATIONAL_ADMIN", "DIRECTOR"].includes(r)).map((r) => (
              <option key={r} value={r}>{r.replace(/_/g, " ")}</option>
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
          <input placeholder="Designation" className="rounded-md border border-gray-300 px-3 py-2 text-sm"
            value={form.designation} onChange={(e) => setForm({ ...form, designation: e.target.value })} />
          <input placeholder="Phone" className="rounded-md border border-gray-300 px-3 py-2 text-sm"
            value={form.phoneNumber} onChange={(e) => setForm({ ...form, phoneNumber: e.target.value })} />
          <input placeholder="Sub-County" className="rounded-md border border-gray-300 px-3 py-2 text-sm"
            value={form.subCounty} onChange={(e) => setForm({ ...form, subCounty: e.target.value })} />
          <input placeholder="Ward" className="rounded-md border border-gray-300 px-3 py-2 text-sm"
            value={form.ward} onChange={(e) => setForm({ ...form, ward: e.target.value })} />
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
              <th className="px-4 py-2">Role</th>
              {isNationalAdmin && <th className="px-4 py-2">County</th>}
              <th className="px-4 py-2">Sub-County / Ward</th>
              <th className="px-4 py-2">Status</th>
              {(user?.role === "NATIONAL_ADMIN" || user?.role === "DIRECTOR") && <th className="px-4 py-2">Actions</th>}
            </tr>
          </thead>
          <tbody>
            {staff.map((s) => (
              <tr key={s.id} className="border-t border-gray-100">
                <td className="px-4 py-2 font-medium">{s.fullName}</td>
                <td className="px-4 py-2">
                  {s.role.replace(/_/g, " ")}
                  {s.role === "COOPERATIVE_MANAGER" && (
                    <div className={`text-xs ${s.managedCoops?.length ? "text-gray-500" : "font-medium text-kenya-red"}`}>
                      {s.managedCoops?.length ? s.managedCoops.map((c) => c.name).join(", ") : "Not linked to a cooperative"}
                    </div>
                  )}
                  {s.role !== "NATIONAL_ADMIN" && s.role !== "DIRECTOR" && s.permissions?.length === 0 && (
                    <div className="text-xs font-medium text-kenya-red">No permissions: run fix:staff-access</div>
                  )}
                </td>
                {isNationalAdmin && <td className="px-4 py-2">{s.county?.name || "—"}</td>}
                <td className="px-4 py-2">{s.subCounty} / {s.ward}</td>
                <td className="px-4 py-2">{s.active ? "Active" : "Deactivated"}</td>
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
                    {s.active && s.id !== user.id && (
                      <button onClick={() => deactivate(s.id)} className="text-xs font-medium text-kenya-red hover:underline">
                        Deactivate
                      </button>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </ProtectedRoute>
  );
}
