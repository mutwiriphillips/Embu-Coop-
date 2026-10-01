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
  const [notice, setNotice] = useState("");
  const [showRegister, setShowRegister] = useState(false);
  const EMPTY = { shopName: "", ownerName: "", ownerNationalId: "", phoneNumber: "", email: "", physicalAddress: "", subCounty: "", reimbursementMsisdn: "", temporaryPassword: "", countyId: "" };
  const [reg, setReg] = useState(EMPTY);
  const [counties, setCounties] = useState([]);

  function load() {
    api
      .get("/agrovets", { params: statusFilter ? { status: statusFilter } : {} })
      .then((res) => setShops(res.data))
      .catch((err) => setError(err?.response?.data?.error || "Failed to load agrovet shops"));
  }
  useEffect(load, [statusFilter]);

  const canRegister = ["NATIONAL_ADMIN", "DIRECTOR", "SUBCOUNTY_OFFICER"].includes(user?.role);
  useEffect(() => {
    if (user?.role === "NATIONAL_ADMIN") api.get("/counties").then((res) => setCounties(res.data)).catch(() => {});
  }, [user?.role]);

  // Register a shop on its owner's behalf. The registering officer's
  // registration counts as the first-tier review, so it lands as REVIEWED
  // and still needs a Director to approve it before it can trade.
  async function registerShop(e) {
    e.preventDefault();
    setError(""); setNotice("");
    try {
      const payload = Object.fromEntries(Object.entries(reg).filter(([, v]) => v !== ""));
      await api.post("/agrovets", payload);
      setNotice(
        `${reg.shopName} registered and sent to the Director for sign-off. ` +
        `Give the owner their sign-in: National ID ${reg.ownerNationalId} with the temporary password you set, at /agrovet/login.`
      );
      setReg(EMPTY);
      setShowRegister(false);
      load();
    } catch (err) {
      setError(err?.response?.data?.error || "Failed to register the shop");
    }
  }

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
        Agrovet shops can apply through their own portal, or a Sub-County Officer can register a
        shop on the owner&apos;s behalf. Either way, nothing trades until a Director signs off:
        online applications are reviewed by a Sub-County Officer first; shops registered by an
        officer go straight to the Director.
      </p>

      {canRegister && (
        <div className="mb-6">
          <button onClick={() => setShowRegister((v) => !v)}
            className="rounded-md bg-kenya-green px-4 py-2 text-sm font-semibold text-white hover:bg-kenya-green/90">
            {showRegister ? "Cancel" : "+ Register an agrovet shop"}
          </button>
          {showRegister && (
            <form onSubmit={registerShop} className="mt-3 grid grid-cols-1 gap-3 rounded-lg border border-gray-200 bg-white p-4 sm:grid-cols-2 lg:grid-cols-3">
            <input required placeholder="Shop name" className="rounded-md border border-gray-300 px-3 py-2 text-sm"
              value={reg.shopName} onChange={(e) => setReg({ ...reg, shopName: e.target.value })} />
            <input required placeholder="Owner full name" className="rounded-md border border-gray-300 px-3 py-2 text-sm"
              value={reg.ownerName} onChange={(e) => setReg({ ...reg, ownerName: e.target.value })} />
            <input required placeholder="Owner National ID" className="rounded-md border border-gray-300 px-3 py-2 text-sm"
              value={reg.ownerNationalId} onChange={(e) => setReg({ ...reg, ownerNationalId: e.target.value })} />
            <input required placeholder="Owner phone" className="rounded-md border border-gray-300 px-3 py-2 text-sm"
              value={reg.phoneNumber} onChange={(e) => setReg({ ...reg, phoneNumber: e.target.value })} />
            <input type="email" placeholder="Owner email (optional)" className="rounded-md border border-gray-300 px-3 py-2 text-sm"
              value={reg.email} onChange={(e) => setReg({ ...reg, email: e.target.value })} />
            <input required placeholder="Physical address / market" className="rounded-md border border-gray-300 px-3 py-2 text-sm"
              value={reg.physicalAddress} onChange={(e) => setReg({ ...reg, physicalAddress: e.target.value })} />
            <input placeholder="Sub-County (optional)" className="rounded-md border border-gray-300 px-3 py-2 text-sm"
              value={reg.subCounty} onChange={(e) => setReg({ ...reg, subCounty: e.target.value })} />
            <input placeholder="Reimbursement M-Pesa number (optional)" className="rounded-md border border-gray-300 px-3 py-2 text-sm"
              value={reg.reimbursementMsisdn} onChange={(e) => setReg({ ...reg, reimbursementMsisdn: e.target.value })} />
            <input required minLength={8} placeholder="Temporary password for the owner (8+)" className="rounded-md border border-gray-300 px-3 py-2 text-sm"
              value={reg.temporaryPassword} onChange={(e) => setReg({ ...reg, temporaryPassword: e.target.value })} />
            {user?.role === "NATIONAL_ADMIN" && (
              <select required className="rounded-md border border-gray-300 px-3 py-2 text-sm"
                value={reg.countyId} onChange={(e) => setReg({ ...reg, countyId: e.target.value })}>
                <option value="">Select county…</option>
                {counties.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            )}
            <button type="submit" className="rounded-md bg-kenya-green px-4 py-2 text-sm font-semibold text-white sm:col-span-2 lg:col-span-3">
              Register &amp; send to Director for sign-off
            </button>
            <p className="text-xs text-gray-500 sm:col-span-2 lg:col-span-3">
              The shop is created in {user?.role === "NATIONAL_ADMIN" ? "the county you select" : "your county"}. Share the owner&apos;s National ID and temporary password with them; they sign in at /agrovet/login once approved.
            </p>
            </form>
          )}
        </div>
      )}
      {notice && <p className="mb-4 rounded-md bg-green-50 px-3 py-2 text-sm text-green-800">{notice}</p>}

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
              <th className="px-4 py-2">Registered by</th>
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
                <td className="px-4 py-2 text-xs text-gray-500">{s.registeredBy ? s.registeredBy.fullName : "Applied online"}</td>
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
              <tr><td colSpan={6} className="px-4 py-6 text-center text-gray-400">No agrovet shops found.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </ProtectedRoute>
  );
}
