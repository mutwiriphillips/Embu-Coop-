"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import ProtectedRoute from "../../components/ProtectedRoute";
import { useAuth } from "../../context/AuthContext";
import api from "../../lib/api";

const STATUS_BADGE = {
  PENDING: "bg-amber-100 text-amber-800",
  REVIEWED: "bg-blue-100 text-blue-800",
  APPROVED: "bg-green-100 text-green-800",
  REJECTED: "bg-red-100 text-red-800",
  SUSPENDED: "bg-red-100 text-red-800",
};

export default function AgrovetsPage() {
  const { user } = useAuth();
  const [shops, setShops] = useState([]);
  const [statusFilter, setStatusFilter] = useState("");
  const [error, setError] = useState("");

  function load() {
    api
      .get("/agrovets", { params: statusFilter ? { status: statusFilter } : {} })
      .then((res) => setShops(res.data))
      .catch((err) => setError(err?.response?.data?.error || "Failed to load agrovet shops"));
  }
  useEffect(load, [statusFilter]);

  async function review(id, approve) {
    try {
      await api.post(`/agrovets/${id}/review`, { approve });
      load();
    } catch (err) {
      setError(err?.response?.data?.error || "Review failed");
    }
  }

  async function approve(id, approveDecision) {
    try {
      await api.post(`/agrovets/${id}/approve`, { approve: approveDecision });
      load();
    } catch (err) {
      setError(err?.response?.data?.error || "Approval failed");
    }
  }

  const canReview = ["NATIONAL_ADMIN", "SUBCOUNTY_OFFICER", "DIRECTOR"].includes(user?.role);
  const canApprove = ["NATIONAL_ADMIN", "DIRECTOR"].includes(user?.role);

  return (
    <ProtectedRoute>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Agrovet Shops</h1>
      </div>
      <p className="mb-4 max-w-2xl text-sm text-gray-600">
        Agrovet shops apply directly through their own portal. Each application moves through a
        two-tier review, same as document approvals: a Sub-County Officer reviews first, then a
        Director signs off before the shop can start recording farmer collections.
      </p>

      <div className="mb-4 flex gap-2">
        {["", "PENDING", "REVIEWED", "APPROVED", "REJECTED", "SUSPENDED"].map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={`rounded-md px-3 py-1.5 text-xs font-medium ${statusFilter === s ? "bg-kenya-green text-white" : "bg-gray-100 text-gray-600"}`}
          >
            {s || "All"}
          </button>
        ))}
      </div>

      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
            <tr>
              <th className="px-4 py-2">Shop</th>
              <th className="px-4 py-2">Owner</th>
              <th className="px-4 py-2">County</th>
              <th className="px-4 py-2">Status</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {shops.map((s) => (
              <tr key={s.id} className="border-t border-gray-100">
                <td className="px-4 py-2 font-medium">{s.name}</td>
                <td className="px-4 py-2">{s.ownerName}</td>
                <td className="px-4 py-2">{s.county?.name}</td>
                <td className="px-4 py-2">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE[s.status] || "bg-gray-100"}`}>{s.status}</span>
                </td>
                <td className="px-4 py-2 space-x-2">
                  <Link href={`/agrovets/${s.id}`} className="text-xs font-medium text-kenya-green hover:underline">View</Link>
                  {s.status === "PENDING" && canReview && (
                    <>
                      <button onClick={() => review(s.id, true)} className="text-xs font-medium text-green-700 hover:underline">Mark Reviewed</button>
                      <button onClick={() => review(s.id, false)} className="text-xs font-medium text-red-600 hover:underline">Reject</button>
                    </>
                  )}
                  {s.status === "REVIEWED" && canApprove && (
                    <>
                      <button onClick={() => approve(s.id, true)} className="text-xs font-medium text-green-700 hover:underline">Approve</button>
                      <button onClick={() => approve(s.id, false)} className="text-xs font-medium text-red-600 hover:underline">Reject</button>
                    </>
                  )}
                </td>
              </tr>
            ))}
            {shops.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-6 text-center text-gray-400">No agrovet shops found.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </ProtectedRoute>
  );
}
