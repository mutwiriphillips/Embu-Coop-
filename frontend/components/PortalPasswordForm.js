"use client";

import { useState } from "react";

const inputCls = "mt-0.5 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900";

/**
 * Change-password form for the farmer and agrovet portals. `api` is that
 * portal's own axios instance; `onChanged(data)` receives the new token and
 * profile from the server.
 */
export default function PortalPasswordForm({ api, path, forced, onChanged, backHref }) {
  const [form, setForm] = useState({ currentPassword: "", newPassword: "", confirm: "" });
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError("");
    if (form.newPassword !== form.confirm) return setError("The two new passwords don't match.");
    setBusy(true);
    try {
      const { data } = await api.post(path, { currentPassword: form.currentPassword, newPassword: form.newPassword });
      onChanged(data);
      setForm({ currentPassword: "", newPassword: "", confirm: "" });
      setDone(true);
    } catch (err) {
      setError(err?.response?.data?.error || "Could not change the password. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-md px-4 py-8">
      <h1 className="mb-2 text-2xl font-bold">Change password</h1>
      {forced && !done && (
        <p className="mb-4 rounded-md border border-kenya-gold/40 bg-kenya-gold/10 p-3 text-sm text-gray-800">
          You must choose your own new password before you continue. The one you used is a temporary or published test password. Type it below as your current password.
        </p>
      )}
      {done ? (
        <div className="rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-800">
          <p>Password changed. Other devices signed in to your account have been signed out.</p>
          <a href={backHref} className="mt-2 inline-block font-semibold underline">Continue</a>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-3 rounded-lg border border-gray-200 bg-white p-4">
          <label className="block text-xs text-gray-500">Current password
            <input required type="password" autoComplete="current-password" className={inputCls} value={form.currentPassword} onChange={(e) => setForm({ ...form, currentPassword: e.target.value })} />
          </label>
          <label className="block text-xs text-gray-500">New password
            <input required type="password" autoComplete="new-password" minLength={10} className={inputCls} value={form.newPassword} onChange={(e) => setForm({ ...form, newPassword: e.target.value })} />
          </label>
          <label className="block text-xs text-gray-500">Repeat new password
            <input required type="password" autoComplete="new-password" minLength={10} className={inputCls} value={form.confirm} onChange={(e) => setForm({ ...form, confirm: e.target.value })} />
          </label>
          <p className="text-xs text-gray-500">At least 10 characters with letters and numbers. Several words together are easy to remember. Forgotten your password? Ask your cooperative or county office to reset it for you.</p>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex items-center gap-4">
            <button type="submit" disabled={busy} className="rounded-md bg-kenya-green px-4 py-2 text-sm font-semibold text-white hover:bg-kenya-green/90 disabled:opacity-60">{busy ? "Saving…" : "Change password"}</button>
            {!forced && <a href={backHref} className="text-sm text-gray-500 hover:underline">Cancel</a>}
          </div>
        </form>
      )}
    </div>
  );
}
