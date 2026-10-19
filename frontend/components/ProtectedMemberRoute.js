"use client";

import { useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useMemberAuth } from "../context/MemberAuthContext";

export default function ProtectedMemberRoute({ children }) {
  const { member, loading } = useMemberAuth();
  const router = useRouter();
  const pathname = usePathname();
  const mustChange = Boolean(member?.account?.mustChangePassword);

  useEffect(() => {
    if (!loading && !member) router.replace("/member/login");
    else if (!loading && mustChange && pathname !== "/member/password") router.replace("/member/password");
  }, [member, loading, mustChange, pathname, router]);

  if (loading || !member) {
    return <div className="flex h-screen items-center justify-center text-gray-500">Loading…</div>;
  }

  return <>{children}</>;
}
