"use client";

import { useState } from "react";
import api from "../lib/api";

/** National Admin only: downloads a full copy of the database as one file. */
export default function BackupCard() {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");

  async function download() {
    setBusy(true);
    setError("");
    setMsg("");
    try {
      const res = await api.get("/admin/backup", { responseType: "blob", timeout: 0 });
      const cd = res.headers?.["content-disposition"] || "";
      const name = (cd.match(/filename="([^"]+)"/) || [])[1] || "embu-coop-backup.jsonl.gz";
      const url = URL.createObjectURL(res.data);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setMsg(`Saved ${name}. Keep it somewhere private.`);
    } catch (err) {
      let m = err?.response?.status === 429 ? "A backup is already being prepared. Try again in a minute." : "Backup failed. Please try again.";
      setError(m);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-8 rounded-lg border border-gray-200 bg-white p-4">
      <h2 className="text-sm font-semibold">Database backup</h2>
      <p className="mt-1 text-xs text-gray-500">
        Downloads every record and uploaded document in one file. It contains personal data and password hashes, so store it
        privately (not in email or a shared folder). It can be loaded back into a new database if the service is ever lost.
      </p>
      <button
        onClick={download}
        disabled={busy}
        className="mt-3 rounded-md bg-kenya-green px-4 py-2 text-sm font-semibold text-white hover:bg-kenya-green/90 disabled:opacity-60"
      >
        {busy ? "Preparing backup…" : "Download backup"}
      </button>
      {msg && <p className="mt-2 text-xs text-green-700">{msg}</p>}
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
    </div>
  );
}
