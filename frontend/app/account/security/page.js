"use client";

import { useEffect, useState } from "react";
import ProtectedRoute from "../../../components/ProtectedRoute";
import { useAuth } from "../../../context/AuthContext";
import api from "../../../lib/api";

const inputCls = "mt-0.5 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900";

export default function SecurityPage() {
  const { user, updateSession } = useAuth();
  const [setup, setSetup] = useState(null); // { secret, otpauthUri, qrSvg }
  const [code, setCode] = useState("");
  const [codes, setCodes] = useState(null); // recovery codes, shown once
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState({ password: "", code: "", action: "" });
  const required = Boolean(user?.mfaSetupRequired) || ["NATIONAL_ADMIN", "DIRECTOR"].includes(user?.role);

  async function start() {
    setError(""); setBusy(true);
    try { const { data } = await api.post("/auth/mfa/setup"); setSetup(data); }
    catch (err) { setError(err?.response?.data?.error || "Could not start set-up."); }
    finally { setBusy(false); }
  }

  // Someone who is told to set it up gets the key straight away.
  useEffect(() => {
    if (user && !user.mfaEnabled && user.mfaSetupRequired && !setup && !codes) start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  async function enable(e) {
    e.preventDefault(); setError(""); setBusy(true);
    try {
      const { data } = await api.post("/auth/mfa/enable", { code });
      updateSession(data.token, data.user);
      setCodes(data.recoveryCodes); setSetup(null); setCode("");
    } catch (err) { setError(err?.response?.data?.error || "That code is not right."); }
    finally { setBusy(false); }
  }

  async function confirmAction(e) {
    e.preventDefault(); setError(""); setBusy(true);
    try {
      if (confirm.action === "disable") {
        const { data } = await api.post("/auth/mfa/disable", { password: confirm.password, code: confirm.code });
        updateSession(data.token, data.user);
      } else {
        const { data } = await api.post("/auth/mfa/recovery-codes", { password: confirm.password, code: confirm.code });
        setCodes(data.recoveryCodes); setSaved(false);
      }
      setConfirm({ password: "", code: "", action: "" });
    } catch (err) { setError(err?.response?.data?.error || "That did not work."); }
    finally { setBusy(false); }
  }

  return (
    <ProtectedRoute>
      <h1 className="mb-2 text-2xl font-bold">Security: two-step sign-in</h1>

      {user?.mfaSetupRequired && !codes && (
        <p className="mb-4 max-w-xl rounded-md border border-kenya-gold/40 bg-kenya-gold/10 p-3 text-sm text-gray-800">
          Your role must use two-step sign-in. Set it up now to continue: after your password you will also enter a 6-digit code from an authenticator app on your phone.
        </p>
      )}

      {codes && (
        <div className="mb-6 max-w-xl rounded-lg border border-kenya-gold/50 bg-white p-4">
          <h2 className="text-sm font-semibold">Save your recovery codes</h2>
          <p className="mt-1 text-xs text-gray-600">
            If you lose your phone, each of these works once instead of an app code. They are shown <strong>only now</strong>. Keep them somewhere private and separate from your phone (a password manager, or printed and locked away).
          </p>
          <ul className="mt-3 grid grid-cols-2 gap-2 font-mono text-sm">
            {codes.map((c) => <li key={c} className="rounded bg-gray-50 px-2 py-1 text-center">{c}</li>)}
          </ul>
          <label className="mt-3 flex items-center gap-2 text-sm">
            <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} /> I have saved these codes
          </label>
          <button disabled={!saved} onClick={() => setCodes(null)} className="mt-3 rounded-md bg-kenya-green px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">Done</button>
        </div>
      )}

      {!codes && user?.mfaEnabled && (
        <div className="max-w-xl rounded-lg border border-gray-200 bg-white p-4">
          <p className="text-sm text-green-800">Two-step sign-in is <strong>on</strong> for your account.</p>
          {!confirm.action ? (
            <div className="mt-3 flex gap-4 text-xs">
              <button onClick={() => setConfirm({ password: "", code: "", action: "recovery" })} className="font-medium text-kenya-green hover:underline">Get new recovery codes</button>
              {!required && <button onClick={() => setConfirm({ password: "", code: "", action: "disable" })} className="font-medium text-kenya-red hover:underline">Turn off</button>}
            </div>
          ) : (
            <form onSubmit={confirmAction} className="mt-3 space-y-3">
              <p className="text-xs text-gray-600">{confirm.action === "disable" ? "Confirm with your password and a current code to turn it off." : "Confirm with your password and a current code. Your old recovery codes will stop working."}</p>
              <input required type="password" autoComplete="current-password" placeholder="Password" className={inputCls} value={confirm.password} onChange={(e) => setConfirm({ ...confirm, password: e.target.value })} />
              <input required inputMode="numeric" autoComplete="one-time-code" placeholder="6-digit code" className={inputCls} value={confirm.code} onChange={(e) => setConfirm({ ...confirm, code: e.target.value })} />
              <div className="flex gap-3">
                <button type="submit" disabled={busy} className="rounded-md bg-kenya-green px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">Confirm</button>
                <button type="button" onClick={() => setConfirm({ password: "", code: "", action: "" })} className="text-sm text-gray-500 hover:underline">Cancel</button>
              </div>
            </form>
          )}
          {required && <p className="mt-3 text-xs text-gray-500">This is required for your role, so it cannot be turned off. If you lose your phone and recovery codes, a National Admin can reset it.</p>}
        </div>
      )}

      {!codes && !user?.mfaEnabled && (
        <div className="max-w-xl rounded-lg border border-gray-200 bg-white p-4">
          {!setup ? (
            <>
              <p className="text-sm text-gray-700">Add a second check to your sign-in using an authenticator app (Google Authenticator, Microsoft Authenticator, Authy or similar).</p>
              <button onClick={start} disabled={busy} className="mt-3 rounded-md bg-kenya-green px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy ? "Starting…" : "Set up two-step sign-in"}</button>
            </>
          ) : (
            <form onSubmit={enable} className="space-y-4">
              <ol className="list-decimal space-y-1 pl-5 text-sm text-gray-700">
                <li>Install an authenticator app on your phone.</li>
                <li>Scan this square with the app (or type the key below).</li>
                <li>Enter the 6-digit code the app shows.</li>
              </ol>
              <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center">
                {/* Drawn here from numbers the server sent: no markup is inserted. */}
                <svg role="img" aria-label="QR code for your authenticator app" className="h-44 w-44 flex-shrink-0 rounded-md border border-gray-200 bg-white p-1"
                  viewBox={`-2 -2 ${setup.qr.size + 4} ${setup.qr.size + 4}`} shapeRendering="crispEdges">
                  <path d={setup.qr.path} fill="#000" />
                </svg>
                <div className="min-w-0 text-xs text-gray-600">
                  <p>Can&apos;t scan? Enter this key in the app:</p>
                  <p className="mt-1 break-all font-mono text-sm text-gray-900">{setup.secret}</p>
                  <a href={setup.otpauthUri} className="mt-2 inline-block font-medium text-kenya-green hover:underline">On this phone? Open in your app</a>
                </div>
              </div>
              <label className="block text-xs text-gray-500">
                6-digit code
                <input required inputMode="numeric" autoComplete="one-time-code" maxLength={7} className={inputCls} value={code} onChange={(e) => setCode(e.target.value)} placeholder="123 456" />
              </label>
              <button type="submit" disabled={busy} className="rounded-md bg-kenya-green px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy ? "Checking…" : "Turn on"}</button>
            </form>
          )}
        </div>
      )}

      {error && <p className="mt-3 max-w-xl text-sm text-red-600">{error}</p>}
    </ProtectedRoute>
  );
}
