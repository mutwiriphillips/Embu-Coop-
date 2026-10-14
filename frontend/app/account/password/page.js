"use client";

import { useState } from "react";
import ProtectedRoute from "../../../components/ProtectedRoute";
import { useAuth } from "../../../context/AuthContext";
import api from "../../../lib/api";

export default function ChangePasswordPage() {
  const { user, updateSession } = useAuth();
  const [form, setForm] = useState({ currentPassword: "", newPassword: "", confirm: "" });
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const forced = Boolean(user?.mustChangePassword);

  async function submit(e) {
    e.preventDefault();
    setError("");
    if (form.newPassword !== form.confirm) return setError("The two new passwords don't match.");
    setBusy(true);
    try {
      const { data } = await api.post("/auth/change-password", {
        currentPassword: form.currentPassword,
        newPassword: form.newPassword,
      });
      updateSession(data.token, data.user);
      setForm({ currentPassword: "", newPassword: "", confirm: "" });
      setDone(true);
    } catch (err) {
      setError(err?.response?.data?.error || "Could not change the password. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <ProtectedRoute>
      <h1 className="mb-2 text-2xl font-bold">Change password</h1>
      {forced && !done && (
        <p className="mb-4 max-w-md rounded-md border border-kenya-gold/40 bg-kenya-gold/10 p-3 text-sm text-gray-800">
          You must choose a new password before you can continue. Your current one is a temporary or published test password.
        </p>
      )}
      {done ? (
        <p className="max-w-md rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-800">
          Password changed. Other devices signed in to your account have been signed out.
        </p>
      ) : (
        <form onSubmit={submit} className="max-w-md space-y-3 rounded-lg border border-gray-200 bg-white p-4">
          <label className="block text-xs text-gray-500">
            Current password
            <input required type="password" autoComplete="current-password" className="mt-0.5 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900"
              value={form.currentPassword} onChange={(e) => setForm({ ...form, currentPassword: e.target.value })} />
          </label>
          <label className="block text-xs text-gray-500">
            New password
            <input required type="password" autoComplete="new-password" minLength={10} className="mt-0.5 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900"
              value={form.newPassword} onChange={(e) => setForm({ ...form, newPassword: e.target.value })} />
          </label>
          <label className="block text-xs text-gray-500">
            Repeat new password
            <input required type="password" autoComplete="new-password" minLength={10} className="mt-0.5 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900"
              value={form.confirm} onChange={(e) => setForm({ ...form, confirm: e.target.value })} />
          </label>
          <p className="text-xs text-gray-500">At least 10 characters with letters and numbers. A short phrase of several words works well.</p>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button type="submit" disabled={busy} className="rounded-md bg-kenya-green px-4 py-2 text-sm font-semibold text-white hover:bg-kenya-green/90 disabled:opacity-60">
            {busy ? "Saving…" : "Change password"}
          </button>
        </form>
      )}
    </ProtectedRoute>
  );
}
