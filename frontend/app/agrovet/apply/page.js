"use client";

import { useState } from "react";
import { useCounties, CountySelect } from "../../../lib/useCounties";
import { useAgrovetAuth } from "../../../context/AgrovetAuthContext";
import { describeAuthError } from "../../../lib/authErrors";
import LocationPicker from "../../../components/LocationPicker";
import { ACCEPT, HINT } from "../../../lib/files";

export default function AgrovetApplyPage() {
  const { apply } = useAgrovetAuth();
  const { counties, loading: countiesLoading, error: countiesError, retry: retryCounties } = useCounties();
  const [form, setForm] = useState({
    shopName: "",
    ownerName: "",
    ownerNationalId: "",
    phoneNumber: "",
    email: "",
    physicalAddress: "",
    countyId: "",
    subCountyId: "",
    wardId: "",
    reimbursementMsisdn: "",
    password: "",
  });
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [shopPhoto, setShopPhoto] = useState(null);
  const [permit, setPermit] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      // Sent as one multipart form so the shop photo and permit arrive with the
      // application. Blank optional fields are simply left out.
      const data = new FormData();
      Object.entries(form).forEach(([k, v]) => { if (v !== "") data.append(k, v); });
      if (shopPhoto) data.append("shopPhoto", shopPhoto);
      if (permit) data.append("permit", permit);
      await apply(data);
    } catch (err) {
      setError(describeAuthError(err, "Application failed. Check the details and try again."));
    } finally {
      setSubmitting(false);
    }
  }

  const field = (label, key, opts = {}) => (
    <div>
      <label className="mb-1 block text-sm font-medium">{label}</label>
      <input
        required={opts.required !== false}
        type={opts.type || "text"}
        value={form[key]}
        onChange={(e) => setForm({ ...form, [key]: e.target.value })}
        className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-kenya-green focus:outline-none"
        placeholder={opts.placeholder}
      />
    </div>
  );

  return (
    <div className="flex min-h-screen items-center justify-center bg-kenya-green/5 px-4 py-10">
      <div className="w-full max-w-lg rounded-xl bg-white p-8 shadow-lg">
        <h1 className="mb-1 text-xl font-bold text-kenya-black">Apply as an Agrovet Shop</h1>
        <p className="mb-6 text-sm text-gray-500">
          Your application goes to your County's Co-operative Development Department for review before your shop can start recording farmer collections.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          {field("Shop Name", "shopName", { placeholder: "e.g. Kianjokoma Agrovet Supplies" })}
          {field("Owner Full Name", "ownerName")}
          {field("Owner National ID Number", "ownerNationalId")}
          {field("Phone Number", "phoneNumber", { placeholder: "07XXXXXXXX" })}
          {field("Email (optional)", "email", { required: false, type: "email" })}
          {field("Physical Address", "physicalAddress", { placeholder: "Market/shop location" })}

          <div>
            <label className="mb-1 block text-sm font-medium">County</label>
            <CountySelect
                value={form.countyId}
                onChange={(e) => setForm({ ...form, countyId: e.target.value, subCountyId: "", wardId: "" })}
                counties={counties}
                loading={countiesLoading}
                error={countiesError}
                retry={retryCounties}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-kenya-green focus:outline-none disabled:bg-gray-50"
              />
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2 -mb-2 text-sm font-medium">Sub-county and ward</div>
            <LocationPicker
              required
              countyId={form.countyId}
              value={{ subCountyId: form.subCountyId, wardId: form.wardId }}
              onChange={(loc) => setForm({ ...form, subCountyId: loc.subCountyId, wardId: loc.wardId })}
            />
            <p className="sm:col-span-2 -mt-1 text-xs text-gray-500">Your application goes to the Sub-County Officer for this area.</p>
          </div>

          <div className="rounded-md border border-dashed border-gray-300 p-3">
            <p className="mb-2 text-sm font-medium">Photos &amp; documents <span className="font-normal text-gray-500">(optional, but they speed up approval)</span></p>
            <label className="mb-1 block text-xs font-medium text-gray-700">Photo of your shop front</label>
            <input type="file" accept={ACCEPT.photo} onChange={(e) => setShopPhoto(e.target.files?.[0] || null)}
              className="mb-1 block w-full text-xs file:mr-3 file:rounded-md file:border-0 file:bg-kenya-green/10 file:px-3 file:py-1.5 file:text-kenya-green" />
            <p className="mb-3 text-xs text-gray-400">{HINT.photo}</p>
            <label className="mb-1 block text-xs font-medium text-gray-700">Business permit / licence</label>
            <input type="file" accept={ACCEPT.document} onChange={(e) => setPermit(e.target.files?.[0] || null)}
              className="mb-1 block w-full text-xs file:mr-3 file:rounded-md file:border-0 file:bg-kenya-green/10 file:px-3 file:py-1.5 file:text-kenya-green" />
            <p className="text-xs text-gray-400">{HINT.document}. You can also add these later from your portal.</p>
          </div>
          {field("Reimbursement M-Pesa Number (optional)", "reimbursementMsisdn", {
            required: false,
            placeholder: "Till, paybill, or phone for reimbursement — can be added later",
          })}
          {field("Password", "password", { type: "password", placeholder: "At least 8 characters" })}

          {error && <p className="text-sm text-red-600">{error}</p>}

          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-md bg-kenya-green px-4 py-2 text-sm font-semibold text-white hover:bg-kenya-green/90 disabled:opacity-50"
          >
            {submitting ? "Submitting…" : "Submit Application"}
          </button>
        </form>

        <a href="/agrovet/login" className="mt-4 block text-center text-xs text-gray-500 hover:underline">
          Already applied? Sign in
        </a>
      </div>
    </div>
  );
}
