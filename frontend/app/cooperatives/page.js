"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import ProtectedRoute from "../../components/ProtectedRoute";
import api from "../../lib/api";

const VALUE_CHAINS = ["COFFEE", "DAIRY", "MIRAA", "IRRIGATION", "OTHER"];

export default function CooperativesPage() {
  const [cooperatives, setCooperatives] = useState([]);
  const [filters, setFilters] = useState({ q: "", valueChain: "" });
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    name: "",
    registrationNumber: "",
    valueChain: "COFFEE",
    subCounty: "",
    ward: "",
  });
  const [error, setError] = useState("");

  async function load() {
    const params = {};
    if (filters.q) params.q = filters.q;
    if (filters.valueChain) params.valueChain = filters.valueChain;
    const res = await api.get("/cooperatives", { params });
    setCooperatives(res.data);
  }

  useEffect(() => {
    load().catch((err) => setError(err?.response?.data?.error || "Failed to load"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters]);

  async function handleCreate(e) {
    e.preventDefault();
    setError("");
    try {
      await api.post("/cooperatives", form);
      setShowForm(false);
      setForm({ name: "", registrationNumber: "", valueChain: "COFFEE", subCounty: "", ward: "" });
      load();
    } catch (err) {
      setError(err?.response?.data?.error || "Failed to create cooperative");
    }
  }

  return (
    <ProtectedRoute>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Cooperative Registry</h1>
        <button
          onClick={() => setShowForm((s) => !s)}
          className="rounded-md bg-embu-green px-4 py-2 text-sm font-semibold text-white hover:bg-embu-green/90"
        >
          {showForm ? "Cancel" : "+ New Cooperative"}
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleCreate} className="mb-6 grid grid-cols-2 gap-3 rounded-lg border border-gray-200 bg-white p-4 md:grid-cols-5">
          <input
            required
            placeholder="Name"
            className="rounded-md border border-gray-300 px-3 py-2 text-sm md:col-span-2"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
          <input
            required
            placeholder="Registration No."
            className="rounded-md border border-gray-300 px-3 py-2 text-sm"
            value={form.registrationNumber}
            onChange={(e) => setForm({ ...form, registrationNumber: e.target.value })}
          />
          <select
            className="rounded-md border border-gray-300 px-3 py-2 text-sm"
            value={form.valueChain}
            onChange={(e) => setForm({ ...form, valueChain: e.target.value })}
          >
            {VALUE_CHAINS.map((v) => (
              <option key={v} value={v}>{v}</option>
            ))}
          </select>
          <input
            required
            placeholder="Sub-County"
            className="rounded-md border border-gray-300 px-3 py-2 text-sm"
            value={form.subCounty}
            onChange={(e) => setForm({ ...form, subCounty: e.target.value })}
          />
          <input
            required
            placeholder="Ward"
            className="rounded-md border border-gray-300 px-3 py-2 text-sm"
            value={form.ward}
            onChange={(e) => setForm({ ...form, ward: e.target.value })}
          />
          <button type="submit" className="rounded-md bg-embu-green px-3 py-2 text-sm font-semibold text-white md:col-span-5">
            Save Cooperative
          </button>
        </form>
      )}

      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

      <div className="mb-4 flex gap-3">
        <input
          placeholder="Search by name…"
          className="rounded-md border border-gray-300 px-3 py-2 text-sm"
          value={filters.q}
          onChange={(e) => setFilters({ ...filters, q: e.target.value })}
        />
        <select
          className="rounded-md border border-gray-300 px-3 py-2 text-sm"
          value={filters.valueChain}
          onChange={(e) => setFilters({ ...filters, valueChain: e.target.value })}
        >
          <option value="">All Value Chains</option>
          {VALUE_CHAINS.map((v) => (
            <option key={v} value={v}>{v}</option>
          ))}
        </select>
      </div>

      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
            <tr>
              <th className="px-4 py-2">Name</th>
              <th className="px-4 py-2">Value Chain</th>
              <th className="px-4 py-2">Sub-County / Ward</th>
              <th className="px-4 py-2">Members</th>
              <th className="px-4 py-2">Documents</th>
            </tr>
          </thead>
          <tbody>
            {cooperatives.map((c) => (
              <tr key={c.id} className="border-t border-gray-100 hover:bg-gray-50">
                <td className="px-4 py-2 font-medium">
                  <Link href={`/cooperatives/${c.id}`} className="text-embu-green hover:underline">
                    {c.name}
                  </Link>
                </td>
                <td className="px-4 py-2">{c.valueChain}</td>
                <td className="px-4 py-2">{c.subCounty} / {c.ward}</td>
                <td className="px-4 py-2">{c._count?.members ?? 0}</td>
                <td className="px-4 py-2">{c._count?.documents ?? 0}</td>
              </tr>
            ))}
            {cooperatives.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-gray-400">
                  No cooperatives found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </ProtectedRoute>
  );
}
