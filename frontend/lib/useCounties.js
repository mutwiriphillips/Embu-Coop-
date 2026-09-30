"use client";

import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { resolveApiBaseUrl } from "./apiBaseUrl";

// The county list is public, so it's fetched with a plain client carrying no
// staff/member/agrovet token and no auth interceptor. That keeps a stale token
// in localStorage from ever turning this public request into a redirect.
const publicApi = axios.create({ baseURL: resolveApiBaseUrl(process.env.NEXT_PUBLIC_API_BASE_URL) });

// Every registration form used to load counties with `.catch(() => {})`, so
// any failure (backend asleep on Render's free tier, a network error, an
// empty table) rendered as a silently empty dropdown with no explanation.
// This hook surfaces loading and error states and offers a retry instead.
export function useCounties() {
  const [counties, setCounties] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    setLoading(true);
    setError("");
    publicApi
      .get("/counties")
      .then((res) => {
        const list = Array.isArray(res.data) ? res.data : [];
        setCounties(list);
        if (list.length === 0) setError("The county list came back empty. Please try again in a moment.");
      })
      .catch((err) => {
        setError(
          err?.response
            ? `Could not load counties (server responded ${err.response.status}).`
            : "Could not reach the server to load counties. If the service was idle it may take up to a minute to wake — please retry."
        );
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(load, [load]);

  return { counties, loading, error, retry: load };
}

// Drop-in <select> used by all three registration forms.
export function CountySelect({ value, onChange, counties, loading, error, retry, className }) {
  return (
    <div>
      <select
        required
        value={value}
        onChange={onChange}
        disabled={loading || counties.length === 0}
        className={className}
      >
        <option value="">
          {loading ? "Loading counties…" : counties.length ? `Select county (${counties.length})…` : "No counties loaded"}
        </option>
        {counties.map((c) => (
          <option key={c.id} value={c.id}>{c.name}</option>
        ))}
      </select>
      {error && (
        <p className="mt-1 text-xs text-red-600">
          {error}{" "}
          <button type="button" onClick={retry} className="font-semibold underline">
            Retry
          </button>
        </p>
      )}
    </div>
  );
}
