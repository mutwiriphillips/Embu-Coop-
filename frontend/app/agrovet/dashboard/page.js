"use client";

import { useEffect, useState } from "react";
import { useAgrovetAuth } from "../../../context/AgrovetAuthContext";
import agrovetApi from "../../../lib/agrovetApi";

const CATEGORIES = ["SEEDS", "FERTILIZER", "MANURE", "PESTICIDE", "EQUIPMENT", "TOOLS", "OTHER"];
const UNITS = ["KG", "BAG", "LITRE", "PIECE", "OTHER"];

const STATUS_COPY = {
  PENDING: { label: "Pending Sub-County Review", color: "bg-amber-100 text-amber-800", body: "Your application has been submitted and is waiting for review by your Sub-County Co-operative Development Officer." },
  REVIEWED: { label: "Reviewed — Awaiting Director Sign-off", color: "bg-amber-100 text-amber-800", body: "A Sub-County Officer has reviewed your application. A County Director must approve it before you can start recording collections." },
  APPROVED: { label: "Approved", color: "bg-green-100 text-green-800", body: "Your shop is approved and active." },
  REJECTED: { label: "Application Rejected", color: "bg-red-100 text-red-800", body: "" },
  SUSPENDED: { label: "Suspended", color: "bg-red-100 text-red-800", body: "Your shop has been temporarily suspended. Contact your County Co-operative Development Department." },
};

export default function AgrovetDashboardPage() {
  const { shop, loading, logout } = useAgrovetAuth();
  const [tab, setTab] = useState("collect");

  if (loading) return <div className="flex h-screen items-center justify-center text-gray-500">Loading…</div>;
  if (!shop) {
    if (typeof window !== "undefined") window.location.href = "/agrovet/login";
    return null;
  }

  const statusInfo = STATUS_COPY[shop.status] || STATUS_COPY.PENDING;
  const isApproved = shop.status === "APPROVED";

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="flex items-center justify-between border-b border-gray-200 bg-white px-6 py-4">
        <div>
          <h1 className="text-lg font-bold text-kenya-black">{shop.name}</h1>
          <p className="text-xs text-gray-500">{shop.county?.name} County</p>
        </div>
        <button onClick={logout} className="text-sm text-gray-500 hover:underline">Sign out</button>
      </header>

      <div className="mx-auto max-w-5xl px-6 py-6">
        <div className={`mb-6 rounded-lg px-4 py-3 text-sm font-medium ${statusInfo.color}`}>
          {statusInfo.label}
          {statusInfo.body && <p className="mt-1 text-xs font-normal">{statusInfo.body}</p>}
          {shop.status === "REJECTED" && shop.rejectionNote && <p className="mt-1 text-xs font-normal">Reason: {shop.rejectionNote}</p>}
        </div>

        {isApproved && (
          <>
            <div className="mb-6 flex gap-2 border-b border-gray-200">
              {["collect", "catalog", "history"].map((t) => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={`px-4 py-2 text-sm font-medium capitalize ${tab === t ? "border-b-2 border-kenya-green text-kenya-green" : "text-gray-500"}`}
                >
                  {t === "collect" ? "Record Collection" : t === "catalog" ? "My Catalog" : "Collection History"}
                </button>
              ))}
            </div>
            {tab === "collect" && <RecordCollectionTab />}
            {tab === "catalog" && <CatalogTab />}
            {tab === "history" && <HistoryTab />}
          </>
        )}
      </div>
    </div>
  );
}

function CatalogTab() {
  const [products, setProducts] = useState([]);
  const [form, setForm] = useState({ name: "", category: "OTHER", unit: "OTHER", unitPrice: "" });
  const [error, setError] = useState("");

  function load() {
    agrovetApi.get("/agrovet/products").then((res) => setProducts(res.data)).catch(() => {});
  }
  useEffect(load, []);

  async function addProduct(e) {
    e.preventDefault();
    setError("");
    try {
      await agrovetApi.post("/agrovet/products", { ...form, unitPrice: Number(form.unitPrice) });
      setForm({ name: "", category: "OTHER", unit: "OTHER", unitPrice: "" });
      load();
    } catch (err) {
      setError(err?.response?.data?.error || "Failed to add product");
    }
  }

  async function deactivate(id) {
    await agrovetApi.patch(`/agrovet/products/${id}/deactivate`).catch(() => {});
    load();
  }

  return (
    <div>
      <form onSubmit={addProduct} className="mb-6 grid grid-cols-2 gap-3 rounded-lg border border-gray-200 bg-white p-4 md:grid-cols-5">
        <input required placeholder="Product name" className="rounded-md border border-gray-300 px-3 py-2 text-sm md:col-span-2"
          value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <select className="rounded-md border border-gray-300 px-3 py-2 text-sm" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
          {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select className="rounded-md border border-gray-300 px-3 py-2 text-sm" value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })}>
          {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
        </select>
        <input required type="number" min="0" step="0.01" placeholder="Unit price (KES)" className="rounded-md border border-gray-300 px-3 py-2 text-sm"
          value={form.unitPrice} onChange={(e) => setForm({ ...form, unitPrice: e.target.value })} />
        <button type="submit" className="rounded-md bg-kenya-green px-3 py-2 text-sm font-semibold text-white md:col-span-5">Add Product</button>
      </form>
      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
            <tr><th className="px-4 py-2">Name</th><th className="px-4 py-2">Category</th><th className="px-4 py-2">Unit</th><th className="px-4 py-2">Price (KES)</th><th className="px-4 py-2"></th></tr>
          </thead>
          <tbody>
            {products.map((p) => (
              <tr key={p.id} className="border-t border-gray-100">
                <td className="px-4 py-2 font-medium">{p.name}</td>
                <td className="px-4 py-2">{p.category}</td>
                <td className="px-4 py-2">{p.unit}</td>
                <td className="px-4 py-2">{Number(p.unitPrice).toLocaleString()}</td>
                <td className="px-4 py-2">
                  {p.active ? (
                    <button onClick={() => deactivate(p.id)} className="text-xs text-red-600 hover:underline">Retire</button>
                  ) : (
                    <span className="text-xs text-gray-400">Retired</span>
                  )}
                </td>
              </tr>
            ))}
            {products.length === 0 && <tr><td colSpan={5} className="px-4 py-6 text-center text-gray-400">No products yet — add your first one above.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function RecordCollectionTab() {
  const [nationalId, setNationalId] = useState("");
  const [matches, setMatches] = useState(null);
  const [selectedCreditId, setSelectedCreditId] = useState("");
  const [products, setProducts] = useState([]);
  const [lines, setLines] = useState([{ inputProductId: "", quantity: "" }]);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    agrovetApi.get("/agrovet/products").then((res) => setProducts(res.data.filter((p) => p.active))).catch(() => {});
  }, []);

  async function lookup(e) {
    e.preventDefault();
    setError(""); setSuccess(""); setMatches(null); setSelectedCreditId("");
    try {
      const { data } = await agrovetApi.get("/agrovet/farmer-lookup", { params: { nationalId } });
      setMatches(data);
      if (data.length === 0) setError("No farmer found with that National ID.");
    } catch (err) {
      setError(err?.response?.data?.error || "Lookup failed");
    }
  }

  const selectedCredit = matches?.flatMap((m) => m.inputCredits.map((c) => ({ ...c, memberName: m.legalName }))).find((c) => c.id === selectedCreditId);

  function updateLine(i, key, value) {
    const next = [...lines];
    next[i] = { ...next[i], [key]: value };
    setLines(next);
  }
  function addLine() { setLines([...lines, { inputProductId: "", quantity: "" }]); }

  const total = lines.reduce((sum, l) => {
    const p = products.find((pp) => pp.id === l.inputProductId);
    return sum + (p && l.quantity ? Number(p.unitPrice) * Number(l.quantity) : 0);
  }, 0);

  async function submitCollection(e) {
    e.preventDefault();
    setError(""); setSuccess("");
    try {
      await agrovetApi.post("/agrovet/collections", {
        farmerInputCreditId: selectedCreditId,
        collectionDate: new Date().toISOString().slice(0, 10),
        items: lines.filter((l) => l.inputProductId && l.quantity).map((l) => ({ inputProductId: l.inputProductId, quantity: Number(l.quantity) })),
      });
      setSuccess("Collection recorded. The farmer's remaining credit has been updated.");
      setLines([{ inputProductId: "", quantity: "" }]);
      setMatches(null);
      setNationalId("");
      setSelectedCreditId("");
    } catch (err) {
      setError(err?.response?.data?.error || "Failed to record collection");
    }
  }

  return (
    <div className="space-y-6">
      <form onSubmit={lookup} className="flex gap-2 rounded-lg border border-gray-200 bg-white p-4">
        <input required placeholder="Farmer's National ID" className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm"
          value={nationalId} onChange={(e) => setNationalId(e.target.value)} />
        <button type="submit" className="rounded-md bg-kenya-green px-4 py-2 text-sm font-semibold text-white">Look Up</button>
      </form>

      {matches && matches.length > 0 && (
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <p className="mb-2 text-sm font-medium text-gray-700">Select the farmer's active credit:</p>
          {matches.flatMap((m) => m.inputCredits.map((c) => (
            <label key={c.id} className="mb-2 flex items-center gap-2 rounded-md border border-gray-200 p-2 text-sm">
              <input type="radio" name="credit" value={c.id} checked={selectedCreditId === c.id} onChange={() => setSelectedCreditId(c.id)} />
              <span>{m.legalName} — {c.programName} — KES {Number(c.remainingAmount).toLocaleString()} remaining</span>
            </label>
          )))}
          {matches.every((m) => m.inputCredits.length === 0) && <p className="text-sm text-gray-400">This farmer has no active input credit.</p>}
        </div>
      )}

      {selectedCredit && (
        <form onSubmit={submitCollection} className="rounded-lg border border-gray-200 bg-white p-4">
          <p className="mb-3 text-sm font-medium text-gray-700">Items collected by {selectedCredit.memberName}</p>
          {lines.map((line, i) => (
            <div key={i} className="mb-2 flex gap-2">
              <select required className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm"
                value={line.inputProductId} onChange={(e) => updateLine(i, "inputProductId", e.target.value)}>
                <option value="">Select product…</option>
                {products.map((p) => <option key={p.id} value={p.id}>{p.name} — KES {Number(p.unitPrice).toLocaleString()}/{p.unit}</option>)}
              </select>
              <input required type="number" min="0" step="0.01" placeholder="Qty" className="w-28 rounded-md border border-gray-300 px-3 py-2 text-sm"
                value={line.quantity} onChange={(e) => updateLine(i, "quantity", e.target.value)} />
            </div>
          ))}
          <button type="button" onClick={addLine} className="mb-3 text-xs font-medium text-kenya-green hover:underline">+ Add another item</button>
          <div className="mb-3 flex items-center justify-between border-t border-gray-100 pt-3 text-sm">
            <span className="font-medium">Total value</span>
            <span className={`font-semibold ${total > Number(selectedCredit.remainingAmount) ? "text-red-600" : "text-kenya-black"}`}>
              KES {total.toLocaleString()} {total > Number(selectedCredit.remainingAmount) && "(exceeds remaining credit)"}
            </span>
          </div>
          <button type="submit" disabled={total <= 0 || total > Number(selectedCredit.remainingAmount)}
            className="w-full rounded-md bg-kenya-green px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">
            Record Collection
          </button>
        </form>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}
      {success && <p className="text-sm text-green-700">{success}</p>}
    </div>
  );
}

function HistoryTab() {
  const [collections, setCollections] = useState([]);
  useEffect(() => {
    agrovetApi.get("/agrovet/collections").then((res) => setCollections(res.data)).catch(() => {});
  }, []);

  const STATUS_BADGE = {
    PENDING_REIMBURSEMENT: "bg-amber-100 text-amber-800",
    REIMBURSED: "bg-green-100 text-green-800",
    DISPUTED: "bg-red-100 text-red-800",
  };

  return (
    <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
      <table className="w-full text-sm">
        <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
          <tr><th className="px-4 py-2">Date</th><th className="px-4 py-2">Farmer</th><th className="px-4 py-2">Items</th><th className="px-4 py-2">Value</th><th className="px-4 py-2">Status</th></tr>
        </thead>
        <tbody>
          {collections.map((c) => (
            <tr key={c.id} className="border-t border-gray-100">
              <td className="px-4 py-2">{new Date(c.collectionDate).toLocaleDateString()}</td>
              <td className="px-4 py-2">{c.member?.legalName}</td>
              <td className="px-4 py-2">{c.items?.map((i) => i.productNameSnapshot).join(", ")}</td>
              <td className="px-4 py-2">KES {Number(c.totalValue).toLocaleString()}</td>
              <td className="px-4 py-2">
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE[c.status] || "bg-gray-100 text-gray-600"}`}>
                  {c.status.replace(/_/g, " ")}
                </span>
              </td>
            </tr>
          ))}
          {collections.length === 0 && <tr><td colSpan={5} className="px-4 py-6 text-center text-gray-400">No collections recorded yet.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
