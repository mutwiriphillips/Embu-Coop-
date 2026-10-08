"use client";

import { useState } from "react";
import api from "../lib/api";

/**
 * "Import from PDF": read a typed PDF list of people, show what was found in
 * an editable table, and only save once a person has checked it.
 *
 *  - MEMBERS   : adds the reviewed rows to the member register.
 *  - BOARD     : appoints the reviewed rows to their Supervisory Board seats.
 *  - COMMITTEE : hands the reviewed rows to the committee form (which still
 *                applies its own checks) via onUseRows.
 *
 * The PDF is kept as a supporting document under Documents once the records
 * are saved. Reading a PDF never saves anything by itself.
 */

const KIND_TEXT = {
  MEMBERS: { noun: "member register", doc: "Member register" },
  COMMITTEE: { noun: "management committee list", doc: "Management committee list" },
  BOARD: { noun: "Supervisory Board list", doc: "Supervisory Board list" },
};
const MGMT_ROLES = [
  ["CHAIRPERSON", "Chairperson"], ["VICE_CHAIRPERSON", "Vice Chairperson"], ["SECRETARY", "Secretary"],
  ["TREASURER", "Treasurer"], ["BOARD_MEMBER", "Board Member"], ["EXECUTIVE_MANAGER", "Executive Manager"],
];
const BOARD_ROLES = [["CHAIRMAN", "Chairman"], ["HONORARY_SECRETARY", "Honorary Secretary"], ["MEMBER", "Member"]];
const ID_OK = (v) => /^[A-Za-z0-9]{5,15}$/.test(String(v || "").trim());

// Stores the original PDF under Documents as a supporting file.
export async function uploadSupportingPdf(coopId, file, kind) {
  const form = new FormData();
  form.append("docType", "OTHER");
  form.append("title", `${KIND_TEXT[kind].doc} (typed PDF import, ${new Date().toISOString().slice(0, 10)})`);
  form.append("file", file);
  await api.post(`/cooperatives/${coopId}/documents`, form);
}

const cell = "w-full rounded border px-1.5 py-1 text-xs text-gray-900";
const ok = "border-gray-300";
const bad = "border-red-400 bg-red-50";

export default function PdfListImport({ coop, kind, onImported, onUseRows, label = "Import from PDF" }) {
  const roles = kind === "BOARD" ? BOARD_ROLES : MGMT_ROLES;
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [rows, setRows] = useState(null);
  const [skipped, setSkipped] = useState([]);
  const [meta, setMeta] = useState(null);

  function reset() {
    setFile(null); setRows(null); setSkipped([]); setMeta(null); setError("");
  }

  async function readPdf(e) {
    e.preventDefault();
    if (!file) return;
    setBusy(true); setError(""); setNotice(""); setRows(null);
    try {
      const form = new FormData();
      form.append("kind", kind);
      form.append("file", file);
      const res = await api.post(`/cooperatives/${coop.id}/imports/parse`, form);
      const d = res.data;
      setRows(d.rows.map((r, i) => ({ ...r, key: i, include: !r.alreadyMember && !r.duplicateOfRow, error: "" })));
      setSkipped(d.skipped || []);
      setMeta({ pagesRead: d.pagesRead, truncated: d.truncated, capped: d.capped });
    } catch (err) {
      setError(err?.response?.data?.error || "Could not read that PDF");
    } finally {
      setBusy(false);
    }
  }

  const set = (key, field, value) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, [field]: value, error: "" } : r)));

  // What each row still lacks. Rows ticked for import must be complete.
  function missing(r) {
    const m = {};
    if (String(r.fullName || "").trim().split(/\s+/).length < 2) m.fullName = true;
    if (!ID_OK(r.nationalId)) m.nationalId = true;
    if (kind !== "MEMBERS" && !String(r.phoneNumber || "").trim()) m.phoneNumber = true;
    if (kind !== "BOARD" && !r.gender) m.gender = true;
    if (kind !== "MEMBERS" && !r.role) m.role = true;
    if (kind !== "MEMBERS" && !r.appointmentDate) m.appointmentDate = true;
    return m;
  }
  const chosen = rows ? rows.filter((r) => r.include) : [];
  const incomplete = chosen.filter((r) => Object.keys(missing(r)).length);

  async function confirm() {
    setBusy(true); setError(""); setNotice("");
    try {
      if (kind === "COMMITTEE") {
        onUseRows(
          chosen.map((r) => ({
            fullName: r.fullName.trim(), gender: r.gender, role: r.role, nationalId: r.nationalId.trim(),
            phoneNumber: r.phoneNumber.trim(), appointmentDate: r.appointmentDate, retirementDate: "",
          })),
          file
        );
        setOpen(false); reset();
        return;
      }
      if (kind === "MEMBERS") {
        await api.post(`/cooperatives/${coop.id}/members/bulk`, {
          members: chosen.map((r) => ({ legalName: r.fullName.trim(), nationalId: r.nationalId.trim(), phoneNumber: r.phoneNumber.trim(), gender: r.gender })),
        });
      } else {
        // Supervisory Board: one appointment per seat, in order; stop on the
        // first one the server refuses so nothing is left half-explained.
        const done = [];
        for (const r of chosen) {
          try {
            await api.post(`/cooperatives/${coop.id}/governance/supervisory-board`, {
              position: r.role, fullName: r.fullName.trim(), nationalId: r.nationalId.trim(),
              phoneNumber: r.phoneNumber.trim(), appointmentDate: r.appointmentDate,
            });
            done.push(r.key);
          } catch (err) {
            setRows((rs) => rs.filter((x) => !done.includes(x.key)).map((x) => (x.key === r.key ? { ...x, error: err?.response?.data?.error || "Could not appoint this person" } : x)));
            setError(`${done.length ? `${done.length} appointed. ` : ""}${r.fullName} could not be appointed. Fix or untick that row and press the button again.`);
            if (done.length) onImported?.();
            return;
          }
        }
      }
      let docNote = "";
      try {
        await uploadSupportingPdf(coop.id, file, kind);
        docNote = " The PDF is kept under Documents as a supporting file.";
      } catch (err) {
        docNote = ` The PDF itself could not be filed under Documents (${err?.response?.data?.error || "upload failed"}); upload it there by hand.`;
      }
      setNotice(`${chosen.length} ${kind === "MEMBERS" ? "members added" : "board members appointed"}.${docNote}`);
      reset();
      onImported?.();
    } catch (err) {
      const data = err?.response?.data;
      if (data?.rowErrors) {
        // Map the server's row numbers (1-based among the rows sent) back to the table.
        const byKey = {};
        data.rowErrors.forEach((re) => { const target = chosen[re.row - 1]; if (target) byKey[target.key] = re.errors.join("; "); });
        setRows((rs) => rs.map((r) => (byKey[r.key] ? { ...r, error: byKey[r.key] } : r)));
      }
      setError(data?.error || "Could not save the list");
    } finally {
      setBusy(false);
    }
  }

  const actionLabel = kind === "MEMBERS" ? `Add ${chosen.length} members` : kind === "BOARD" ? `Appoint ${chosen.length}` : `Use ${chosen.length} people in the committee form`;

  return (
    <div className="mb-4">
      <button type="button" onClick={() => { setOpen((o) => !o); setNotice(""); }}
        className="rounded-md border border-kenya-green px-3 py-1.5 text-xs font-semibold text-kenya-green hover:bg-kenya-green/5">
        {open ? "Close PDF import" : label}
      </button>
      {notice && <p className="mt-2 text-sm text-green-700">{notice}</p>}

      {open && (
        <div className="mt-3 rounded-lg border border-gray-200 bg-white p-4">
          <p className="mb-3 text-xs text-gray-500">
            Upload a <b>typed</b> PDF of the {KIND_TEXT[kind].noun} (for example exported from Word or Excel). The names are read into a table below for you to check and correct.
            <b> Nothing is saved until you confirm</b>, and the PDF is then kept under Documents as a supporting file. Scanned pages and photos can&apos;t be read reliably; for those, add the names by hand.
          </p>
          <form onSubmit={readPdf} className="flex flex-wrap items-center gap-3">
            <input type="file" accept="application/pdf,.pdf" className="text-xs"
              onChange={(e) => { setFile(e.target.files?.[0] || null); setRows(null); setError(""); }} />
            <button type="submit" disabled={!file || busy} className="rounded-md bg-kenya-green px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">
              {busy && !rows ? "Reading…" : "Read PDF"}
            </button>
          </form>
          {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

          {rows && (
            <div className="mt-4">
              <p className="mb-2 text-sm text-gray-700">
                Found <b>{rows.length}</b> {rows.length === 1 ? "person" : "people"}. <b>{chosen.length}</b> ticked for import
                {incomplete.length > 0 && <span className="text-red-600"> · {incomplete.length} ticked {incomplete.length === 1 ? "row is" : "rows are"} missing something (marked red)</span>}.
                {meta?.truncated && <span className="text-amber-700"> Only the first {meta.pagesRead} pages were read.</span>}
                {meta?.capped && <span className="text-amber-700"> Only the first 2000 rows are shown.</span>}
              </p>
              <div className="mb-2 flex gap-3 text-xs">
                <button type="button" onClick={() => setRows((rs) => rs.map((r) => ({ ...r, include: true })))} className="text-kenya-green hover:underline">Tick all</button>
                <button type="button" onClick={() => setRows((rs) => rs.map((r) => ({ ...r, include: false })))} className="text-kenya-green hover:underline">Untick all</button>
              </div>
              <div className="max-h-[28rem] overflow-auto rounded border border-gray-200">
                <table className="w-full min-w-[820px] text-xs">
                  <thead className="sticky top-0 bg-gray-50 text-left uppercase text-gray-500">
                    <tr>
                      <th className="px-2 py-1.5" />
                      <th className="px-2 py-1.5">Name</th>
                      {kind !== "MEMBERS" && <th className="px-2 py-1.5">{kind === "BOARD" ? "Seat" : "Position"}</th>}
                      <th className="px-2 py-1.5">ID number</th>
                      <th className="px-2 py-1.5">Phone</th>
                      {kind !== "BOARD" && <th className="px-2 py-1.5">Gender</th>}
                      {kind !== "MEMBERS" && <th className="px-2 py-1.5">Date appointed</th>}
                      <th className="px-2 py-1.5">Check</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => {
                      const m = r.include ? missing(r) : {};
                      return (
                        <tr key={r.key} className={`border-t border-gray-100 align-top ${r.include ? "" : "bg-gray-50 text-gray-400"}`}>
                          <td className="px-2 py-1.5"><input type="checkbox" checked={r.include} onChange={(e) => set(r.key, "include", e.target.checked)} /></td>
                          <td className="px-2 py-1.5"><input className={`${cell} ${m.fullName ? bad : ok}`} value={r.fullName} onChange={(e) => set(r.key, "fullName", e.target.value)} /></td>
                          {kind !== "MEMBERS" && (
                            <td className="px-2 py-1.5">
                              <select className={`${cell} ${m.role ? bad : ok}`} value={r.role || ""} onChange={(e) => set(r.key, "role", e.target.value)}>
                                <option value="">Choose…</option>
                                {roles.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                              </select>
                            </td>
                          )}
                          <td className="px-2 py-1.5"><input className={`${cell} ${m.nationalId ? bad : ok}`} value={r.nationalId} onChange={(e) => set(r.key, "nationalId", e.target.value)} /></td>
                          <td className="px-2 py-1.5"><input className={`${cell} ${m.phoneNumber ? bad : ok}`} value={r.phoneNumber} onChange={(e) => set(r.key, "phoneNumber", e.target.value)} /></td>
                          {kind !== "BOARD" && (
                            <td className="px-2 py-1.5">
                              <select className={`${cell} ${m.gender ? bad : ok}`} value={r.gender || ""} onChange={(e) => set(r.key, "gender", e.target.value)}>
                                <option value="">Choose…</option>
                                <option value="MALE">Male</option>
                                <option value="FEMALE">Female</option>
                              </select>
                            </td>
                          )}
                          {kind !== "MEMBERS" && (
                            <td className="px-2 py-1.5"><input type="date" className={`${cell} ${m.appointmentDate ? bad : ok}`} value={r.appointmentDate || ""} onChange={(e) => set(r.key, "appointmentDate", e.target.value)} /></td>
                          )}
                          <td className="px-2 py-1.5">
                            {r.error && <div className="font-medium text-red-600">{r.error}</div>}
                            {r.warnings.length > 0 && <div className="text-amber-700">{r.warnings.join("; ")}</div>}
                            <details className="text-gray-400"><summary className="cursor-pointer">Line in PDF</summary>{r.sourceLine}</details>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {skipped.length > 0 && (
                <details className="mt-3 text-xs text-gray-500">
                  <summary className="cursor-pointer">{skipped.length} lines in the PDF were not used (titles, headings and anything that didn&apos;t look like a person). Check nobody was missed.</summary>
                  <ul className="mt-1 max-h-40 list-disc space-y-0.5 overflow-auto pl-5">
                    {skipped.map((s, i) => <li key={i}>{s.text} <span className="text-gray-400">— {s.reason}</span></li>)}
                  </ul>
                </details>
              )}

              <div className="mt-4 flex items-center gap-3">
                <button type="button" onClick={confirm} disabled={busy || chosen.length === 0 || incomplete.length > 0}
                  className="rounded-md bg-kenya-green px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
                  {busy ? "Saving…" : actionLabel}
                </button>
                <button type="button" onClick={() => { reset(); }} className="text-sm text-gray-500 hover:underline">Start over</button>
                {incomplete.length > 0 && <span className="text-xs text-red-600">Fill in the red cells or untick those rows.</span>}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
