"use client";

import { useState } from "react";
import Link from "next/link";
import { useAuth } from "../../context/AuthContext";
import { describeAuthError } from "../../lib/authErrors";

export default function LoginPage() {
  const { login, cooperativeLogin } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      await login(email, password);
    } catch (err) {
      // A Cooperative Manager who signs in here out of habit: the server has
      // verified their password but won't issue a staff token. Hand the same
      // details to the Cooperative Portal's own sign-in instead.
      if (err?.response?.data?.code === "USE_COOPERATIVE_PORTAL") {
        try {
          await cooperativeLogin(email, password);
          return;
        } catch (e2) {
          setError(describeAuthError(e2, "Please sign in through the Cooperative Portal."));
          return;
        }
      }
      setError(describeAuthError(err, "Login failed. Check your credentials."));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-kenya-green/5 px-4">
      <div className="w-full max-w-sm rounded-xl bg-white p-8 shadow-lg">
        <p className="text-xs font-bold uppercase tracking-wide text-kenya-gold">County Staff</p>
        <h1 className="mb-1 mt-1 text-xl font-bold text-kenya-black">Republic of Kenya</h1>
        <p className="mb-6 text-sm text-gray-500">
          National Cooperative Management &amp; Governance System
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium">Email</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-kenya-green focus:outline-none"
              placeholder="you@embu.go.ke"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Password</label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-kenya-green focus:outline-none"
              placeholder="••••••••"
            />
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-md bg-kenya-green px-4 py-2 text-sm font-semibold text-white hover:bg-kenya-green/90 disabled:opacity-50"
          >
            {submitting ? "Signing in…" : "Sign in"}
          </button>
        </form>

        <a href="/signup" className="mt-4 block text-center text-xs text-gray-500 hover:underline">
          Test run — create an account
        </a>
        <div className="mt-4 border-t border-gray-100 pt-4 text-center text-xs text-gray-500">
          Not county staff?{" "}
          <Link href="/member/login" className="font-medium text-kenya-green hover:underline">Farmer</Link>
          {" · "}
          <Link href="/cooperative/login" className="font-medium text-kenya-green hover:underline">Cooperative</Link>
          {" · "}
          <Link href="/agrovet/login" className="font-medium text-kenya-green hover:underline">Agrovet</Link>
        </div>
      </div>
    </div>
  );
}
