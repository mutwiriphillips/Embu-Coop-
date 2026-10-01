"use client";

import { useEffect, useRef, useState } from "react";
import axios from "axios";
import Link from "next/link";
import { useAuth } from "../../../context/AuthContext";
import { describeAuthError } from "../../../lib/authErrors";
import { resolveApiBaseUrl } from "../../../lib/apiBaseUrl";

// Public lookups go through a plain client with no session token attached.
const publicApi = axios.create({ baseURL: resolveApiBaseUrl(process.env.NEXT_PUBLIC_API_BASE_URL) });

export default function CooperativeLoginPage() {
  const { cooperativeLogin, login } = useAuth();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [errorCode, setErrorCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  // Live confirmation of which cooperative a registration number belongs to.
  const [match, setMatch] = useState(null); // { state: "loading" | "found" | "missing", data }
  const timer = useRef(null);

  // Arriving from the staff sign-in with ?id=<email>: pre-fill it. Read from
  // window.location (not useSearchParams) so the page stays statically built.
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("id");
    if (id) setIdentifier(id);
  }, []);

  useEffect(() => {
    clearTimeout(timer.current);
    const value = identifier.trim();
    if (value.includes("@") || value.length < 3) { setMatch(null); return; }
    setMatch({ state: "loading" });
    timer.current = setTimeout(() => {
      publicApi
        .get("/cooperative-auth/lookup", { params: { registrationNumber: value } })
        .then((res) => setMatch({ state: "found", data: res.data }))
        .catch(() => setMatch({ state: "missing" }));
    }, 400);
    return () => clearTimeout(timer.current);
  }, [identifier]);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(""); setErrorCode(""); setSubmitting(true);
    try {
      await cooperativeLogin(identifier.trim(), password);
    } catch (err) {
      // County staff who came to this page by mistake: their password is
      // already verified, so hand their email straight to the staff sign-in.
      if (err?.response?.data?.code === "USE_STAFF_LOGIN" && identifier.includes("@")) {
        try {
          await login(identifier.trim(), password);
          return;
        } catch {
          // fall through to the explanatory message below
        }
      }
      setErrorCode(err?.response?.data?.code || "");
      setError(describeAuthError(err, "Sign-in failed. Check your details and try again."));
    } finally {
      setSubmitting(false);
    }
  }

  const isEmail = identifier.includes("@");

  return (
    <div className="flex min-h-screen items-center justify-center bg-kenya-green/5 px-4 py-10">
      <div className="w-full max-w-sm rounded-xl bg-white p-8 shadow-lg">
        <p className="text-xs font-bold uppercase tracking-wide text-kenya-gold">Cooperative Portal</p>
        <h1 className="mb-1 mt-1 text-xl font-bold text-kenya-black">Sign in to your cooperative</h1>
        <p className="mb-6 text-sm text-gray-500">
          Use your manager email, or your cooperative&apos;s registration number.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium">Email or registration number</label>
            <input
              required
              autoComplete="username"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-kenya-green focus:outline-none"
              placeholder="e.g. EMB-PILOT-0001 or you@coop.co.ke"
            />
            {!isEmail && match?.state === "loading" && (
              <p className="mt-1 text-xs text-gray-400">Checking…</p>
            )}
            {!isEmail && match?.state === "found" && (
              <p className={`mt-1 text-xs ${match.data.hasManagerAccount ? "text-green-700" : "text-amber-700"}`}>
                {match.data.hasManagerAccount ? "✓ " : "⚠ "}
                {match.data.name}{match.data.county ? ` · ${match.data.county} County` : ""}
                {!match.data.hasManagerAccount && ": no manager account yet. Your County Co-operative Office can create one."}
              </p>
            )}
            {!isEmail && match?.state === "missing" && (
              <p className="mt-1 text-xs text-amber-700">No cooperative with that registration number. Check it, or use your email instead.</p>
            )}
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">Password</label>
            <div className="flex rounded-md border border-gray-300 focus-within:border-kenya-green">
              <input
                type={showPassword ? "text" : "password"}
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-md px-3 py-2 text-sm focus:outline-none"
                placeholder="••••••••"
              />
              <button type="button" onClick={() => setShowPassword((v) => !v)}
                className="px-3 text-xs font-medium text-gray-500 hover:text-kenya-green">
                {showPassword ? "Hide" : "Show"}
              </button>
            </div>
          </div>

          {error && (
            <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
              {errorCode === "USE_STAFF_LOGIN" && (
                <Link href="/login" className="mt-1 block font-semibold underline">Go to County Staff sign-in →</Link>
              )}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-md bg-kenya-green px-4 py-2 text-sm font-semibold text-white hover:bg-kenya-green/90 disabled:opacity-50"
          >
            {submitting ? "Signing in…" : "Sign in"}
          </button>
        </form>

        <p className="mt-5 text-center text-xs text-gray-500">
          No account yet? Your County Co-operative Office creates manager accounts.
        </p>
        <div className="mt-4 border-t border-gray-100 pt-4 text-center text-xs text-gray-500">
          Not a cooperative?{" "}
          <Link href="/member/login" className="font-medium text-kenya-green hover:underline">Farmer</Link>
          {" · "}
          <Link href="/agrovet/login" className="font-medium text-kenya-green hover:underline">Agrovet</Link>
          {" · "}
          <Link href="/login" className="font-medium text-kenya-green hover:underline">County Staff</Link>
        </div>
      </div>
    </div>
  );
}
