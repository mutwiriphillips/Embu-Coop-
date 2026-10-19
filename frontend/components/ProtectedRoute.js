"use client";

import { useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useAuth } from "../context/AuthContext";
import Sidebar from "./Sidebar";
import { sessionLoginPath } from "../lib/portal";

export default function ProtectedRoute({ children }) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!loading && !user) router.replace(sessionLoginPath());
    // An account on a temporary/published password can only change it.
    else if (!loading && user?.mustChangePassword && pathname !== "/account/password") router.replace("/account/password");
    // Roles that must use two-step sign-in set it up before anything else.
    else if (!loading && user?.mfaSetupRequired && !["/account/security", "/account/password"].includes(pathname)) router.replace("/account/security");
  }, [user, loading, router, pathname]);

  if (loading || !user) {
    return <div className="flex h-screen items-center justify-center text-gray-500">Loading…</div>;
  }

  return (
    <div className="flex">
      <Sidebar />
      <main className="flex-1 p-8">{children}</main>
    </div>
  );
}
