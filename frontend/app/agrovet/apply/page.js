"use client";

import { useState } from "react";
import { useCounties, CountySelect } from "../../../lib/useCounties";
import { useAgrovetAuth } from "../../../context/AgrovetAuthContext";
import { describeAuthError } from "../../../lib/authErrors";

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
    subCounty: "",
    reimbursementMsisdn: "",
    password: "",
  });
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      await apply({ ...form, email: form.email || undefined, reimbursementMsisdn: form.reimbursementMsisdn || undefined });
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
                onChange={(e) => setForm({ ...form, countyId: e.target.value })}
                counties={counties}
                loading={countiesLoading}
                error={countiesError}
                retry={retryCounties}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-kenya-green focus:outline-none disabled:bg-gray-50"
              />
          </div>

          {field("Sub-County (optional)", "subCounty", { required: false })}
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
