"use client";

import { useEffect } from "react";
import PortalPasswordForm from "../../../components/PortalPasswordForm";
import { useAgrovetAuth } from "../../../context/AgrovetAuthContext";
import agrovetApi from "../../../lib/agrovetApi";

export default function AgrovetPasswordPage() {
  const { shop, loading, updateSession } = useAgrovetAuth();
  useEffect(() => { if (!loading && !shop) window.location.href = "/agrovet/login"; }, [loading, shop]);
  if (loading || !shop) return <div className="flex h-screen items-center justify-center text-gray-500">Loading…</div>;
  return (
    <div className="min-h-screen bg-gray-50">
      <div className="h-1.5 w-full bg-kenya-stripe" />
      <PortalPasswordForm api={agrovetApi} path="/agrovet-auth/change-password" forced={Boolean(shop.account?.mustChangePassword)}
        onChanged={(d) => updateSession(d.token, d.shop)} backHref="/agrovet/dashboard" />
    </div>
  );
}
