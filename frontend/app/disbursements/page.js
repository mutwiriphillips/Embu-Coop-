"use client";

import { Fragment, useEffect, useState } from "react";
import ProtectedRoute from "../../components/ProtectedRoute";
import { useAuth } from "../../context/AuthContext";
import api from "../../lib/api";

function defaultFrom() {
  const d = new Date();
  d.setDate(1);
  return d.toISOString().slice(0, 10);
}
function defaultTo() {
  return new Date().toISOString().slice(0, 10);
}

const kes = (n) => "KES " + Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 });
const num = (n) => Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 });
const unitLabel = (u) => ({ KG: "kg", LITERS: "litres", BAGS: "bags", CRATES: "crates", OTHER: "units" }[u] || (u || "").toLowerCase());

// Why is the total what it is? Quantity delivered x average price per unit.
function ProduceLines({ lines }) {
  if (!lines || lines.length === 0) return <span className="text-gray-400">—</span>;
  return (
    <div className="space-y-1">
      {lines.map((l) => (
        <div key={l.produceType + l.unit} className="leading-tight">
          <span className="font-medium text-gray-800">{l.produceType}</span>{" "}
          <span className="text-gray-500">{num(l.quantity)} {unitLabel(l.unit)}</span>
        </div>
      ))}
    </div>
  );
}
function PriceLines({ lines }) {
  if (!lines || lines.length === 0) return <span className="text-gray-400">—</span>;
  return (
    <div className="space-y-1">
      {lines.map((l) => (
        <div key={l.produceType + l.unit} className="leading-tight">
          {l.avgPrice == null ? <span className="text-gray-400">no price recorded</span> : <>KES {num(l.avgPrice)}<span className="text-gray-400"> / {unitLabel(l.unit).replace(/s$/, "")}</span></>}
        </div>
      ))}
    </div>
  );
}
function Factories({ list }) {
  if (!list || list.length === 0) return <span className="text-gray-400">—</span>;
  return <div className="space-y-0.5">{list.map((f) => <div key={f.id} className="leading-tight">{f.name}</div>)}</div>;
}

export default function DisbursementsPage() {
  const { user } = useAuth();
  const isNationalAdmin = user?.role === "NATIONAL_ADMIN";

  const [counties, setCounties] = useState([]);
  const [filters, setFilters] = useState({ from: defaultFrom(), to: defaultTo(), countyId: "" });
  const [summary, setSummary] = useState(null);
  const [expanded, setExpanded] = useState(null);
  const [memberBreakdown, setMemberBreakdown] = useState({});
  const [error, setError] = useState("");

  useEffect(() => {
    if (isNationalAdmin) api.get("/counties").then((res) => setCounties(res.data)).catch(() => {});
  }, [isNationalAdmin]);

  function load() {
    const params = { from: filters.from, to: filters.to };
    if (isNationalAdmin && filters.countyId) params.countyId = filters.countyId;
    api
      .get("/reports/disbursements", { params })
      .then((res) => setSummary(res.data))
      .catch((err) => setError(err?.response?.data?.error || "Failed to load disbursement report"));
  }

  useEffect(load, [filters]);

  async function toggleExpand(cooperativeId) {
    if (expanded === cooperativeId) {
      setExpanded(null);
      return;
    }
    setExpanded(cooperativeId);
    if (!memberBreakdown[cooperativeId]) {
      const res = await api.get(`/cooperatives/${cooperativeId}/payouts/member-summary`, {
        params: { from: filters.from, to: filters.to },
      });
      setMemberBreakdown((prev) => ({ ...prev, [cooperativeId]: res.data }));
    }
  }

  return (
    <ProtectedRoute>
      <h1 className="mb-1 text-2xl font-bold">Farmer Disbursements</h1>
      <p className="mb-6 text-sm text-gray-500">
        Trickle-down view of money paid out to individual farmers{" "}
        {isNationalAdmin ? "across counties" : `in ${user?.county?.name || "your county"}`} for a given period.
      </p>

      <div className="mb-6 flex flex-wrap items-end gap-3 rounded-lg border border-gray-200 bg-white p-4">
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-500">From</label>
          <input type="date" className="rounded-md border border-gray-300 px-3 py-2 text-sm"
            value={filters.from} onChange={(e) => setFilters({ ...filters, from: e.target.value })} />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-500">To</label>
          <input type="date" className="rounded-md border border-gray-300 px-3 py-2 text-sm"
            value={filters.to} onChange={(e) => setFilters({ ...filters, to: e.target.value })} />
        </div>
        {isNationalAdmin && (
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500">County</label>
            <select className="rounded-md border border-gray-300 px-3 py-2 text-sm"
              value={filters.countyId} onChange={(e) => setFilters({ ...filters, countyId: e.target.value })}>
              <option value="">All Counties</option>
              {counties.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
        )}
      </div>

      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

      {summary && (
        <>
          <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-3">
            <div className="rounded-lg border border-gray-200 bg-white p-4">
              <p className="text-xs uppercase text-gray-500">Total Disbursed</p>
              <p className="mt-1 text-2xl font-bold text-kenya-green">KES {summary.totalDisbursed.toLocaleString()}</p>
            </div>
            <div className="rounded-lg border border-gray-200 bg-white p-4">
              <p className="text-xs uppercase text-gray-500">Cooperatives Paying Out</p>
              <p className="mt-1 text-2xl font-bold text-kenya-black">{summary.cooperativeCount}</p>
            </div>
            <div className="rounded-lg border border-gray-200 bg-white p-4">
              <p className="text-xs uppercase text-gray-500">Period</p>
              <p className="mt-1 text-sm font-medium text-gray-700">
                {filters.from} → {filters.to}
              </p>
            </div>
          </div>

          <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
                <tr>
                  <th className="px-4 py-2">Cooperative</th>
                  {isNationalAdmin && <th className="px-4 py-2">County</th>}
                  <th className="px-4 py-2">Factory</th>
                  <th className="px-4 py-2">Produce &amp; quantity</th>
                  <th className="px-4 py-2">Avg price</th>
                  <th className="px-4 py-2">Total Disbursed</th>
                  <th className="px-4 py-2">Payouts</th>
                  <th className="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {summary.byCooperative.map((c) => (
                  <Fragment key={c.cooperativeId}>
                    <tr
                      className="cursor-pointer border-t border-gray-100 hover:bg-gray-50"
                      onClick={() => toggleExpand(c.cooperativeId)}
                    >
                      <td className="px-4 py-2 font-medium text-kenya-green">{c.cooperativeName}</td>
                      {isNationalAdmin && <td className="px-4 py-2">{c.countyName}</td>}
                      <td className="px-4 py-2 text-xs"><Factories list={c.factories} /></td>
                      <td className="px-4 py-2 text-xs"><ProduceLines lines={c.produce} /></td>
                      <td className="px-4 py-2 text-xs"><PriceLines lines={c.produce} /></td>
                      <td className="px-4 py-2">KES {c.total.toLocaleString()}</td>
                      <td className="px-4 py-2">{c.payoutCount}</td>
                      <td className="px-4 py-2 text-xs text-gray-400">{expanded === c.cooperativeId ? "▲ hide" : "▼ farmers"}</td>
                    </tr>
                    {expanded === c.cooperativeId && (
                      <tr className="border-t border-gray-100 bg-gray-50">
                        <td colSpan={isNationalAdmin ? 8 : 7} className="px-4 py-3">
                          {c.produce.length > 0 && (
                            <div className="mb-3 rounded-md bg-white p-3 text-xs shadow-sm">
                              <p className="mb-1 font-semibold text-gray-700">How the total adds up</p>
                              {c.produce.map((l) => (
                                <p key={l.produceType + l.unit} className="text-gray-600">
                                  {l.produceType}: {num(l.quantity)} {unitLabel(l.unit)}
                                  {l.avgPrice != null && <> × average KES {num(l.avgPrice)} = <b>{kes(l.value)}</b></>}
                                  {l.unpricedDeliveries > 0 && <span className="text-kenya-red"> ({l.unpricedDeliveries} delivery(ies) have no price, so the average covers {num(l.pricedQuantity)} {unitLabel(l.unit)} only)</span>}
                                </p>
                              ))}
                              <p className="mt-1 text-gray-700">Value of produce settled: <b>{kes(c.produceValue)}</b> · Paid against it: <b>{kes(c.paidForProduce)}</b>{c.paidWithoutProduce > 0 && <> · Paid with no produce attached (dividends, bonuses, older entries): <b>{kes(c.paidWithoutProduce)}</b></>}</p>
                            </div>
                          )}
                          {c.produce.length === 0 && c.paidWithoutProduce > 0 && (
                            <p className="mb-3 text-xs text-gray-500">No produce is attached to these payouts ({kes(c.paidWithoutProduce)}), for example dividends, savings or older entries.</p>
                          )}
                          {!memberBreakdown[c.cooperativeId] ? (
                            <p className="text-xs text-gray-400">Loading farmer breakdown…</p>
                          ) : memberBreakdown[c.cooperativeId].length === 0 ? (
                            <p className="text-xs text-gray-400">No individual payouts in this period.</p>
                          ) : (
                            <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                              {memberBreakdown[c.cooperativeId].map((m) => (
                                <div key={m.memberId} className="rounded-md bg-white px-3 py-2 text-xs shadow-sm">
                                  <p className="font-medium text-gray-800">{m.memberName}</p>
                                  <p className="text-kenya-green">KES {m.total.toLocaleString()}</p>
                                  <p className="text-gray-400">{m.payoutCount} payout(s)</p>
                                  {(m.produce || []).map((l) => (
                                    <p key={l.produceType + l.unit} className="text-gray-500">{l.produceType}: {num(l.quantity)} {unitLabel(l.unit)}{l.avgPrice != null ? ` @ KES ${num(l.avgPrice)}` : ""}</p>
                                  ))}
                                </div>
                              ))}
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
                {summary.byCooperative.length === 0 && (
                  <tr>
                    <td colSpan={isNationalAdmin ? 8 : 7} className="px-4 py-6 text-center text-gray-400">
                      No disbursements recorded in this period.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </ProtectedRoute>
  );
}
