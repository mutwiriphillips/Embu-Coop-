"use client";

import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { resolveApiBaseUrl } from "./apiBaseUrl";

// The county list is public, so it's fetched with a plain client carrying no
// staff/member/agrovet token and no auth interceptor. That keeps a stale token
// in localStorage from ever turning this public request into a redirect.
const publicApi = axios.create({ baseURL: resolveApiBaseUrl(process.env.NEXT_PUBLIC_API_BASE_URL) });

const CACHE_KEY = "embu_counties_v1";
const readCache = () => {
  try {
    const list = JSON.parse(window.localStorage.getItem(CACHE_KEY) || "null");
    return Array.isArray(list) && list.length >= 47 ? list : null;
  } catch { return null; }
};
const writeCache = (list) => { try { window.localStorage.setItem(CACHE_KEY, JSON.stringify(list)); } catch { /* storage blocked: fine */ } };

/**
 * Fetches the county list once and remembers it in this browser (the 47
 * counties don't change), so the dropdown is instant on every later visit.
 * On Render's free tier the server sleeps when idle and takes up to a minute
 * to wake, so a failed or slow attempt is retried a few times with a plain
 * "waking up" message rather than failing at the first timeout.
 */
export async function fetchCountiesWithRetry({ attempts = 4, timeoutMs = 25000, onWaiting } = {}) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await publicApi.get("/counties", { timeout: timeoutMs });
      const list = Array.isArray(res.data) ? res.data : [];
      if (list.length) { writeCache(list); return list; }
      lastErr = new Error("empty");
    } catch (err) {
      lastErr = err;
      // A definite answer from the server (404, 500...) is not a sleeping server.
      if (err?.response && err.response.status < 500) break;
    }
    if (i < attempts - 1) { if (onWaiting) onWaiting(i + 1); await new Promise((r) => setTimeout(r, 2000)); }
  }
  throw lastErr;
}

export function useCounties() {
  const [counties, setCounties] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [waking, setWaking] = useState(false);

  const load = useCallback(() => {
    const cached = readCache();
    if (cached) { setCounties(cached); setLoading(false); } else setLoading(true);
    setError("");
    setWaking(false);
    fetchCountiesWithRetry({ onWaiting: () => setWaking(true) })
      .then((list) => { setCounties(list); setError(""); })
      .catch((err) => {
        if (cached) return; // the saved list is still good; stay quiet
        setError(
          err?.response
            ? `Could not load counties (server responded ${err.response.status}).`
            : "Could not reach the server to load counties. It may still be waking up: please retry in a moment."
        );
      })
      .finally(() => { setLoading(false); setWaking(false); });
  }, []);

  useEffect(load, [load]);

  return { counties, loading, error, waking, retry: load };
}

// Drop-in <select> used by all three registration forms.
export function CountySelect({ value, onChange, counties, loading, error, retry, className, waking }) {
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
          {loading ? (waking ? "Waking the server… (up to a minute)" : "Loading counties…") : counties.length ? `Select county (${counties.length})…` : "No counties loaded"}
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
