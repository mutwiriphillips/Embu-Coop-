"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import ProtectedRoute from "../../../components/ProtectedRoute";
import { useAuth } from "../../../context/AuthContext";
import api from "../../../lib/api";

export default function AgrovetDetailPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const [shop, setShop] = useState(null);
  const [collections, setCollections] = useState([]);
  const [reimbursements, setReimbursements] = useState([]);
  const [selectedIds, setSelectedIds] = useState([]);
  const [form, setForm] = useState({ method: "BANK_TRANSFER", externalRef: "", periodLabel: "", reimbursementDate: new Date().toISOString().slice(0, 10) });
  const [error, setError] = useState("");

  function load() {
    api.get(`/agrovets/${id}`).then((res) => setShop(res.data)).catch((err) => setError(err?.response?.data?.error || "Failed to load shop"));
    api.get(`/agrovets/${id}/collections`, { params: { status: "PENDING_REIMBURSEMENT" } }).then((res) => setCollections(res.data)).catch(() => {});
    api.get(`/agrovets/${id}/reimbursements`).then((res) => setReimbursements(res.data)).catch(() => {});
  }
  useEffect(load, [id]);

  function toggleSelect(cid) {
    setSelectedIds((prev) => (prev.includes(cid) ? prev.filter((x) => x !== cid) : [...prev, cid]));
  }

  const selectedTotal = collections.filter((c) => selectedIds.includes(c.id)).reduce((sum, c) => sum + Number(c.totalValue), 0);
  const canReimburse = ["NATIONAL_ADMIN", "DIRECTOR"].includes(user?.role);

  async function submitReimbursement(e) {
    e.preventDefault();
    setError("");
    try {
      await api.post(`/agrovets/${id}/reimbursements`, { ...form, collectionIds: selectedIds });
      setSelectedIds([]);
      load();
    } catch (err) {
      setError(err?.response?.data?.error || "Failed to record reimbursement");
    }
  }

  if (!shop) return <ProtectedRoute><p className="text-sm text-gray-500">Loading…</p></ProtectedRoute>;

  return (
    <ProtectedRoute>
      <div className="mb-6">
        <h1 className="text-2xl font-bold">{shop.name}</h1>
        <p className="text-sm text-gray-500">{shop.ownerName} · {shop.county?.name} County · {shop.physicalAddress}</p>
      </div>
      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

      <div className="mb-8">
        <h2 className="mb-3 text-lg font-semibold">Pending Reimbursement</h2>
        <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
              <tr>
                <th className="px-4 py-2"></th>
                <th className="px-4 py-2">Date</th>
                <th className="px-4 py-2">Farmer</th>
                <th className="px-4 py-2">Items</th>
                <th className="px-4 py-2">Value</th>
              </tr>
            </thead>
            <tbody>
              {collections.map((c) => (
                <tr key={c.id} className="border-t border-gray-100">
                  <td className="px-4 py-2">
                    {canReimburse && <input type="checkbox" checked={selectedIds.includes(c.id)} onChange={() => toggleSelect(c.id)} />}
                  </td>
                  <td className="px-4 py-2">{new Date(c.collectionDate).toLocaleDateString()}</td>
                  <td className="px-4 py-2">{c.member?.legalName}</td>
                  <td className="px-4 py-2">{c.items?.map((i) => i.productNameSnapshot).join(", ")}</td>
                  <td className="px-4 py-2">KES {Number(c.totalValue).toLocaleString()}</td>
                </tr>
              ))}
              {collections.length === 0 && <tr><td colSpan={5} className="px-4 py-6 text-center text-gray-400">Nothing pending reimbursement.</td></tr>}
            </tbody>
          </table>
        </div>

        {canReimburse && selectedIds.length > 0 && (
          <form onSubmit={submitReimbursement} className="mt-4 grid grid-cols-2 gap-3 rounded-lg border border-gray-200 bg-white p-4 md:grid-cols-5">
            <select className="rounded-md border border-gray-300 px-3 py-2 text-sm" value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value })}>
              {["MPESA", "CASH", "BANK_TRANSFER", "OTHER"].map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
            <input placeholder="Reference (optional)" className="rounded-md border border-gray-300 px-3 py-2 text-sm"
              value={form.externalRef} onChange={(e) => setForm({ ...form, externalRef: e.target.value })} />
            <input placeholder="Period label (optional)" className="rounded-md border border-gray-300 px-3 py-2 text-sm"
              value={form.periodLabel} onChange={(e) => setForm({ ...form, periodLabel: e.target.value })} />
            <input required type="date" className="rounded-md border border-gray-300 px-3 py-2 text-sm"
              value={form.reimbursementDate} onChange={(e) => setForm({ ...form, reimbursementDate: e.target.value })} />
            <button type="submit" className="rounded-md bg-kenya-green px-3 py-2 text-sm font-semibold text-white">
              Reimburse KES {selectedTotal.toLocaleString()}
            </button>
          </form>
        )}
      </div>

      <div>
        <h2 className="mb-3 text-lg font-semibold">Reimbursement History</h2>
        <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
              <tr><th className="px-4 py-2">Date</th><th className="px-4 py-2">Amount</th><th className="px-4 py-2">Method</th><th className="px-4 py-2">Processed By</th></tr>
            </thead>
            <tbody>
              {reimbursements.map((r) => (
                <tr key={r.id} className="border-t border-gray-100">
                  <td className="px-4 py-2">{new Date(r.reimbursementDate).toLocaleDateString()}</td>
                  <td className="px-4 py-2">KES {Number(r.totalAmount).toLocaleString()}</td>
                  <td className="px-4 py-2">{r.method}</td>
                  <td className="px-4 py-2">{r.processedBy?.fullName}</td>
                </tr>
              ))}
              {reimbursements.length === 0 && <tr><td colSpan={4} className="px-4 py-6 text-center text-gray-400">No reimbursements recorded yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </ProtectedRoute>
  );
}
