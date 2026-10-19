"use client";

import ProtectedMemberRoute from "../../../components/ProtectedMemberRoute";
import PortalPasswordForm from "../../../components/PortalPasswordForm";
import { useMemberAuth } from "../../../context/MemberAuthContext";
import memberApi from "../../../lib/memberApi";

export default function MemberPasswordPage() {
  const { member, updateSession } = useMemberAuth();
  return (
    <ProtectedMemberRoute>
      <div className="min-h-screen bg-gray-50">
        <div className="h-1.5 w-full bg-kenya-stripe" />
        <PortalPasswordForm api={memberApi} path="/member-auth/change-password" forced={Boolean(member?.account?.mustChangePassword)}
          onChanged={(d) => updateSession(d.token, d.member)} backHref="/member/dashboard" />
      </div>
    </ProtectedMemberRoute>
  );
}
