"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "../context/AuthContext";
import { cooperativeHome } from "../lib/portal";

const STAFF_ONLY = ["NATIONAL_ADMIN", "DIRECTOR", "SUBCOUNTY_OFFICER", "FIELD_OFFICER"];
const LINKS = [
  { href: "/dashboard", label: "Dashboard", roles: STAFF_ONLY },
  { href: "/cooperatives", label: "Cooperatives", roles: STAFF_ONLY },
  { href: "/field-ops", label: "Field Visits", roles: STAFF_ONLY },
  { href: "/leave", label: "Leave", roles: STAFF_ONLY },
  { href: "/disbursements", label: "Farmer Disbursements", roles: ["NATIONAL_ADMIN", "DIRECTOR", "SUBCOUNTY_OFFICER"] },
  { href: "/agrovets", label: "Agrovet Shops", roles: ["NATIONAL_ADMIN", "DIRECTOR", "SUBCOUNTY_OFFICER"] },
  { href: "/staff", label: "Staff & Access", roles: ["NATIONAL_ADMIN", "DIRECTOR", "SUBCOUNTY_OFFICER"] },
];

export default function Sidebar() {
  const pathname = usePathname();
  const { user, logout } = useAuth();
  const isManager = user?.role === "COOPERATIVE_MANAGER";
  // Cooperative Managers get their own short menu: their cooperative(s),
  // nothing county-staff-only.
  const links = isManager
    ? (user?.managedCoops?.length
        ? user.managedCoops.map((c) => ({ href: `/cooperatives/${c.id}`, label: c.name }))
        : [{ href: cooperativeHome(user), label: "My Cooperative" }])
    : LINKS.filter((l) => !l.roles || l.roles.includes(user?.role));

  return (
    <aside className="flex h-screen w-60 flex-col justify-between border-r border-gray-200 bg-white">
      <div>
        <div className="h-1 w-full bg-kenya-stripe" />
        <div className="border-b border-gray-200 px-4 py-4">
          <p className="text-sm font-bold text-kenya-black">Republic of Kenya</p>
          <p className="text-xs text-gray-500">
            {isManager
              ? "Cooperative Portal"
              : user?.role === "NATIONAL_ADMIN" ? "National Co-operatives Portal" : (user?.county?.name ? `${user.county.name} County` : "Cooperative Management")}
          </p>
        </div>
        <nav className="p-2">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className={`block rounded-md px-3 py-2 text-sm ${
                pathname?.startsWith(l.href)
                  ? "bg-kenya-green/10 font-semibold text-kenya-green"
                  : "text-gray-600 hover:bg-gray-100"
              }`}
            >
              {l.label}
            </Link>
          ))}
        </nav>
      </div>
      <div className="border-t border-gray-200 p-4">
        <p className="text-sm font-medium">{user?.fullName}</p>
        <p className="mb-2 text-xs text-gray-500">{user?.role?.replace(/_/g, " ")}</p>
        <button onClick={logout} className="text-xs font-medium text-kenya-red hover:underline">
          Sign out
        </button>
      </div>
    </aside>
  );
}
