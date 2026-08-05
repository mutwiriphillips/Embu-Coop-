"use client";

import { useEffect, useState } from "react";
import ProtectedRoute from "../../components/ProtectedRoute";
import { useAuth } from "../../context/AuthContext";
import api from "../../lib/api";

const ROLES = ["DIRECTOR", "SUBCOUNTY_OFFICER", "FIELD_OFFICER", "COOPERATIVE_MANAGER"];

export default function StaffPage() {
  const { user } = useAuth();
  const [staff, setStaff] = useState([]);
  const [form, setForm] = useState({
    fullName: "", email: "", password: "", role: "FIELD_OFFICER",
    designation: "", phoneNumber: "", subCounty: "", ward: "",
  });
  const [error, setError] = useState("");

  function load() {
    api.get("/staff").then((res) => setStaff(res.data)).catch((err) =>
      setError(err?.response?.data?.error || "Failed to load staff")
    );
  }

  useEffect(load, []);

  async function createStaff(e) {
    e.preventDefault();
    setError("");
    try {
      await api.post("/staff", form);
      setForm({ fullName: "", email: "", password: "", role: "FIELD_OFFICER", designation: "", phoneNumber: "", subCounty: "", ward: "" });
      load();
    } catch (err) {
      setError(err?.response?.data?.error || "Failed to create staff account");
    }
  }

  async function deactivate(id) {
    await api.delete(`/staff/${id}`);
    load();
  }

  if (user?.role !== "DIRECTOR" && user?.role !== "SUBCOUNTY_OFFICER") {
    return (
      <ProtectedRoute>
        <p className="text-gray-500">You don&apos;t have access to this section.</p>
      </ProtectedRoute>
    );
  }

  return (
    <ProtectedRoute>
      <h1 className="mb-6 text-2xl font-bold">Staff & Access Management</h1>

      {user?.role === "DIRECTOR" && (
        <form onSubmit={createStaff} className="mb-6 grid grid-cols-2 gap-3 rounded-lg border border-gray-200 bg-white p-4 md:grid-cols-4">
          <input required placeholder="Full name" className="rounded-md border border-gray-300 px-3 py-2 text-sm"
            value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} />
          <input required type="email" placeholder="Email" className="rounded-md border border-gray-300 px-3 py-2 text-sm"
            value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          <input required type="password" placeholder="Temporary password" className="rounded-md border border-gray-300 px-3 py-2 text-sm"
            value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          <select className="rounded-md border border-gray-300 px-3 py-2 text-sm"
            value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
            {ROLES.map((r) => <option key={r} value={r}>{r.replace("_", " ")}</option>)}
          </select>
          <input placeholder="Designation" className="rounded-md border border-gray-300 px-3 py-2 text-sm"
            value={form.designation} onChange={(e) => setForm({ ...form, designation: e.target.value })} />
          <input placeholder="Phone" className="rounded-md border border-gray-300 px-3 py-2 text-sm"
            value={form.phoneNumber} onChange={(e) => setForm({ ...form, phoneNumber: e.target.value })} />
          <input placeholder="Sub-County" className="rounded-md border border-gray-300 px-3 py-2 text-sm"
            value={form.subCounty} onChange={(e) => setForm({ ...form, subCounty: e.target.value })} />
          <input placeholder="Ward" className="rounded-md border border-gray-300 px-3 py-2 text-sm"
            value={form.ward} onChange={(e) => setForm({ ...form, ward: e.target.value })} />
          <button type="submit" className="rounded-md bg-embu-green px-3 py-2 text-sm font-semibold text-white md:col-span-4">
            Create Staff Account
          </button>
        </form>
      )}
      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
            <tr>
              <th className="px-4 py-2">Name</th>
              <th className="px-4 py-2">Role</th>
              <th className="px-4 py-2">Sub-County / Ward</th>
              <th className="px-4 py-2">Status</th>
              {user?.role === "DIRECTOR" && <th className="px-4 py-2">Actions</th>}
            </tr>
          </thead>
          <tbody>
            {staff.map((s) => (
              <tr key={s.id} className="border-t border-gray-100">
                <td className="px-4 py-2 font-medium">{s.fullName}</td>
                <td className="px-4 py-2">{s.role.replace("_", " ")}</td>
                <td className="px-4 py-2">{s.subCounty} / {s.ward}</td>
                <td className="px-4 py-2">{s.active ? "Active" : "Deactivated"}</td>
                {user?.role === "DIRECTOR" && (
                  <td className="px-4 py-2">
                    {s.active && s.id !== user.id && (
                      <button onClick={() => deactivate(s.id)} className="text-xs font-medium text-red-600 hover:underline">
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
