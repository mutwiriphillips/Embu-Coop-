"use client";

import { useEffect, useState } from "react";
import ProtectedRoute from "../../components/ProtectedRoute";
import api from "../../lib/api";

export default function DashboardPage() {
  const [cooperatives, setCooperatives] = useState([]);
  const [error, setError] = useState("");

  useEffect(() => {
    api
      .get("/cooperatives")
      .then((res) => setCooperatives(res.data))
      .catch((err) => setError(err?.response?.data?.error || "Failed to load cooperatives"));
  }, []);

  const byChain = cooperatives.reduce((acc, c) => {
    acc[c.valueChain] = (acc[c.valueChain] || 0) + 1;
    return acc;
  }, {});

  return (
    <ProtectedRoute>
      <h1 className="mb-6 text-2xl font-bold">Dashboard</h1>

      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

      <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
        <StatCard label="Total Cooperatives" value={cooperatives.length} />
        {["COFFEE", "DAIRY", "MIRAA", "IRRIGATION"].map((chain) => (
          <StatCard key={chain} label={chain} value={byChain[chain] || 0} />
        ))}
      </div>

      <div className="mt-8">
        <h2 className="mb-3 text-lg font-semibold">Recently Added Cooperatives</h2>
        <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
              <tr>
                <th className="px-4 py-2">Name</th>
                <th className="px-4 py-2">Value Chain</th>
                <th className="px-4 py-2">Sub-County</th>
                <th className="px-4 py-2">Members</th>
              </tr>
            </thead>
            <tbody>
              {cooperatives.slice(0, 8).map((c) => (
                <tr key={c.id} className="border-t border-gray-100">
                  <td className="px-4 py-2 font-medium">{c.name}</td>
                  <td className="px-4 py-2">{c.valueChain}</td>
                  <td className="px-4 py-2">{c.subCounty}</td>
                  <td className="px-4 py-2">{c._count?.members ?? 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </ProtectedRoute>
  );
}

function StatCard({ label, value }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <p className="text-xs uppercase text-gray-500">{label}</p>
      <p className="mt-1 text-2xl font-bold text-embu-green">{value}</p>
    </div>
  );
}
