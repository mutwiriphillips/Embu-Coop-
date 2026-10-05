"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import { resolveApiBaseUrl } from "../lib/apiBaseUrl";

// The sub-county and ward lists are public (official names only), so they're
// fetched without any session token attached.
const publicApi = axios.create({ baseURL: resolveApiBaseUrl(process.env.NEXT_PUBLIC_API_BASE_URL) });

/**
 * Cascading Sub-County -> Ward dropdowns for a given county.
 *
 *  countyId          which county's sub-counties to list (nothing shown until set)
 *  value             { subCountyId, wardId }
 *  onChange(next)    receives { subCountyId, wardId, subCountyName, wardName }
 *  lockedSubCountyId a Sub-County Officer's own sub-county: preselected and fixed
 *  required          make both dropdowns required in the form
 *  showWard          set false where only the sub-county matters (filters)
 *  allLabel          for filters: adds an "all" option instead of requiring a choice
 *
 * Changing the sub-county always clears the ward, so a form can never end up
 * holding a ward from a different sub-county.
 */
export default function LocationPicker({
  countyId, value = {}, onChange, lockedSubCountyId, required = false,
  showWard = true, allLabel, className = "", selectClassName,
}) {
  const [subCounties, setSubCounties] = useState([]);
  const [wards, setWards] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const subCountyId = lockedSubCountyId || value.subCountyId || "";
  const cls = selectClassName || "w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-kenya-green focus:outline-none disabled:bg-gray-50";

  useEffect(() => {
    setSubCounties([]); setError("");
    if (!countyId) return;
    setLoading(true);
    publicApi.get(`/counties/${countyId}/sub-counties`)
      .then((res) => setSubCounties(res.data))
      .catch(() => setError("Couldn't load sub-counties."))
      .finally(() => setLoading(false));
  }, [countyId]);

  useEffect(() => {
    setWards([]);
    if (!subCountyId || !showWard) return;
    publicApi.get(`/counties/sub-counties/${subCountyId}/wards`)
      .then((res) => setWards(res.data))
      .catch(() => setError("Couldn't load wards."));
  }, [subCountyId, showWard]);

  // Tell the parent about a locked sub-county once its name is known.
  useEffect(() => {
    if (lockedSubCountyId && value.subCountyId !== lockedSubCountyId && subCounties.length) {
      const sc = subCounties.find((s) => s.id === lockedSubCountyId);
      onChange?.({ subCountyId: lockedSubCountyId, wardId: "", subCountyName: sc?.name || "", wardName: "" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lockedSubCountyId, subCounties]);

  const pickSub = (id) => {
    const sc = subCounties.find((s) => s.id === id);
    onChange?.({ subCountyId: id, wardId: "", subCountyName: sc?.name || "", wardName: "" });
  };
  const pickWard = (id) => {
    const sc = subCounties.find((s) => s.id === subCountyId);
    const w = wards.find((x) => x.id === id);
    onChange?.({ subCountyId, wardId: id, subCountyName: sc?.name || "", wardName: w?.name || "" });
  };

  return (
    <div className={`contents ${className}`}>
      <select
        required={required && !allLabel}
        value={subCountyId}
        disabled={!countyId || Boolean(lockedSubCountyId) || loading}
        onChange={(e) => pickSub(e.target.value)}
        className={cls}
        aria-label="Sub-county"
      >
        <option value="">
          {!countyId ? "Choose a county first" : loading ? "Loading sub-counties…" : allLabel ? `All sub-counties` : `Sub-county (${subCounties.length})…`}
        </option>
        {subCounties.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
      </select>
      {showWard && (
        <select
          required={required && !allLabel}
          value={value.wardId || ""}
          disabled={!subCountyId || wards.length === 0}
          onChange={(e) => pickWard(e.target.value)}
          className={cls}
          aria-label="Ward"
        >
          <option value="">{!subCountyId ? "Choose a sub-county first" : allLabel ? "All wards" : `Ward (${wards.length})…`}</option>
          {wards.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
        </select>
      )}
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
