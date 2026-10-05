"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import api from "../lib/api";

/**
 * County -> Sub-County -> Ward drill-down for Directors (and the National
 * Admin once a county is picked). A Sub-County Officer starts inside their own
 * sub-county and can't go above it; the server enforces the same limits.
 */
export default function CountyDrillDown({ countyId, countyName, user }) {
  const lockedSub = user?.role === "SUBCOUNTY_OFFICER" ? user?.subCountyId : null;
  const [sub, setSub] = useState(lockedSub ? { id: lockedSub, name: user?.subCounty || "Your sub-county" } : null);
  const [ward, setWard] = useState(null);
  const [data, setData] = useState(null);
  const [coops, setCoops] = useState([]);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!countyId) return;
    setError(""); setData(null);
    api.get(`/counties/${countyId}/breakdown`, { params: sub ? { subCountyId: sub.id } : {} })
      .then((res) => setData(res.data))
      .catch((err) => setError(err?.response?.data?.error || "Couldn't load the breakdown"));
  }, [countyId, sub]);

  useEffect(() => {
    if (!ward) { setCoops([]); return; }
    api.get("/cooperatives", { params: { subCountyId: sub.id, ...(ward.id ? { wardId: ward.id } : {}) } })
      .then((res) => setCoops(ward.id ? res.data : res.data.filter((c) => !c.wardId)))
      .catch(() => setCoops([]));
  }, [ward, sub]);

  if (!countyId) return null;
  const level = data?.level;
  const rows = data ? [...data.rows, ...(Object.values(data.unassigned).some((v) => typeof v === "number" && v > 0) ? [data.unassigned] : [])] : [];

  const crumb = (label, onClick, active) => (
    <button onClick={onClick} disabled={active} className={active ? "font-semibold text-kenya-black" : "text-kenya-green hover:underline"}>{label}</button>
  );

  return (
    <section className="mt-8 rounded-xl border border-gray-200 bg-white p-5">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-bold text-kenya-black">Drill down by sub-county and ward</h2>
        <div className="flex items-center gap-1 text-sm">
          {!lockedSub && <>{crumb(`${countyName || "County"}`, () => { setSub(null); setWard(null); }, !sub)}<span className="text-gray-300">/</span></>}
          {sub && <>{crumb(sub.name, () => setWard(null), !ward)}{ward && <span className="text-gray-300">/</span>}</>}
          {ward && <span className="font-semibold">{ward.name}</span>}
        </div>
      </div>
      <p className="mb-4 text-xs text-gray-500">
        {level === "subCounty" ? "Each sub-county in the county. Choose one to see its wards." : "Each ward in this sub-county. Choose one to see its cooperatives."}
      </p>
      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

      {data && !ward && (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
            {[["Cooperatives", "cooperatives"], ["Members", "members"], ["Staff", "staff"], ["Agrovets approved", "agrovetsApproved"], ["Agrovets awaiting", "agrovetsAwaiting"]].map(([label, k]) => (
              <div key={k} className="rounded-lg bg-gray-50 p-3">
                <p className="text-xs text-gray-500">{label}</p>
                <p className="text-xl font-bold text-kenya-black">{data.totals[k].toLocaleString()}</p>
              </div>
            ))}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
                <tr>
                  <th className="px-3 py-2">{level === "subCounty" ? "Sub-county" : "Ward"}</th>
                  <th className="px-3 py-2 text-right">Cooperatives</th>
                  <th className="px-3 py-2 text-right">Members</th>
                  <th className="px-3 py-2 text-right">Staff</th>
                  <th className="px-3 py-2 text-right">Agrovets</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id || "unassigned"} className="border-t border-gray-100 hover:bg-kenya-green/5">
                    <td className="px-3 py-2">
                      <button
                        onClick={() => (level === "subCounty" ? (r.id ? setSub({ id: r.id, name: r.name }) : null) : setWard({ id: r.id, name: r.name }))}
                        disabled={level === "subCounty" && !r.id}
                        className={r.id ? "font-medium text-kenya-green hover:underline" : "italic text-gray-500"}
                      >
                        {r.name}
                      </button>
                    </td>
                    <td className="px-3 py-2 text-right">{r.cooperatives}</td>
                    <td className="px-3 py-2 text-right">{r.members.toLocaleString()}</td>
                    <td className="px-3 py-2 text-right">{r.staff}</td>
                    <td className="px-3 py-2 text-right">
                      {r.agrovetsApproved}
                      {r.agrovetsAwaiting > 0 && <span className="ml-1 text-xs text-amber-700">(+{r.agrovetsAwaiting} awaiting)</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {data.unassigned && rows.includes(data.unassigned) && (
            <p className="mt-2 text-xs text-gray-500">
              &ldquo;{data.unassigned.name}&rdquo; counts older records that predate the sub-county/ward dropdowns.
              Running <code>npm run geo:sync</code> links most of them automatically.
            </p>
          )}
        </>
      )}

      {ward && (
        <div>
          <p className="mb-2 text-sm text-gray-600">{coops.length} cooperative{coops.length === 1 ? "" : "s"} in {ward.name}</p>
          <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200">
            {coops.map((c) => (
              <li key={c.id} className="flex items-center justify-between px-3 py-2 text-sm">
                <Link href={`/cooperatives/${c.id}`} className="font-medium text-kenya-green hover:underline">{c.name}</Link>
                <span className="text-xs text-gray-500">{c.valueChain} · {c._count?.members ?? 0} members</span>
              </li>
            ))}
            {coops.length === 0 && <li className="px-3 py-4 text-center text-sm text-gray-400">No cooperatives recorded in this ward yet.</li>}
          </ul>
        </div>
      )}
    </section>
  );
}
