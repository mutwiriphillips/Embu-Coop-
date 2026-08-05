"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "../context/AuthContext";

// Real, freely-licensed photography (Wikimedia Commons, CC-BY-SA) — no
// AI-generated images and no depictions of real identifiable individuals.
const HERO_IMG = "https://commons.wikimedia.org/wiki/Special:FilePath/Cycling_in_the_Eden_tea_farms.jpg?width=1600";
const FLAG_IMG = "https://commons.wikimedia.org/wiki/Special:FilePath/Flag_of_Kenya.svg?width=200";
const COAT_OF_ARMS_IMG = "https://commons.wikimedia.org/wiki/Special:FilePath/Coat_of_arms_of_Kenya.svg?width=140";
const COUNTY_MAP_IMG = "https://commons.wikimedia.org/wiki/Special:FilePath/Kenya_county_map_labelled_with_names.svg?width=700";

const MODULES = [
  {
    title: "Staff & Access Management",
    body: "Role-based accounts for National Admins, County Directors, Sub-County Officers, Field Officers, and Cooperative Managers — each seeing only what their role and county permit.",
  },
  {
    title: "Field Operations & Leave",
    body: "Weekly visit planning with manager sign-off, post-visit narrative reports, and a self-service leave portal for county staff.",
  },
  {
    title: "Cooperative Registry",
    body: "A searchable national directory of cooperatives across every value chain — coffee, tea, dairy, sugarcane, fisheries, SACCOs, and more — with a full member roll per society.",
  },
  {
    title: "Secure Document Management",
    body: "By-laws, audit reports, and AGM minutes move through a two-tier approval conveyor: Sub-County review, then Director sign-off, before anything is official.",
  },
  {
    title: "Governance & Election Tracking",
    body: "Automated committee term tracking and the statutory 1/3 gender rotation rule, with a logged Director override for exceptional cases.",
  },
];

export default function LandingPage() {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && user) router.replace("/dashboard");
  }, [user, loading, router]);

  if (loading || user) {
    return <div className="flex h-screen items-center justify-center text-gray-500">Loading…</div>;
  }

  return (
    <div className="min-h-screen bg-white">
      {/* Official tri-colour bar */}
      <div className="h-1.5 w-full bg-kenya-stripe" />

      {/* Top bar */}
      <header className="flex items-center justify-between border-b border-gray-100 px-6 py-4 md:px-12">
        <div className="flex items-center gap-3">
          <img src={COAT_OF_ARMS_IMG} alt="Coat of Arms of Kenya" className="h-10 w-auto" />
          <div>
            <p className="text-sm font-bold text-kenya-black">Republic of Kenya</p>
            <p className="text-xs text-gray-500">State Department for Co-operatives</p>
          </div>
        </div>
        <div className="flex gap-3">
          <Link href="/login" className="rounded-md border border-kenya-green px-4 py-2 text-sm font-semibold text-kenya-green hover:bg-kenya-green/5">
            Sign In
          </Link>
          <Link href="/signup" className="rounded-md bg-kenya-green px-4 py-2 text-sm font-semibold text-white hover:bg-kenya-green/90">
            Test-Run Signup
          </Link>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden">
        <img src={HERO_IMG} alt="Tea farms in the Kenyan highlands" className="h-[420px] w-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-r from-kenya-black/80 via-kenya-black/50 to-transparent" />
        <div className="absolute inset-0 flex items-center px-6 md:px-12">
          <div className="max-w-xl text-white">
            <img src={FLAG_IMG} alt="Flag of Kenya" className="mb-4 h-8 w-auto rounded shadow" />
            <h1 className="text-3xl font-extrabold leading-tight md:text-4xl">
              National Cooperative Management &amp; Governance System
            </h1>
            <p className="mt-4 text-base text-gray-100 md:text-lg">
              A single, secure digital home for every county&apos;s cooperative societies —
              membership records, field operations, legal documents, and governance
              compliance, built for all 47 counties of Kenya.
            </p>
            <div className="mt-6 flex gap-3">
              <Link href="/signup" className="rounded-md bg-kenya-red px-5 py-2.5 text-sm font-semibold text-white hover:bg-kenya-red/90">
                Try the Pilot
              </Link>
              <Link href="/login" className="rounded-md bg-white px-5 py-2.5 text-sm font-semibold text-kenya-black hover:bg-gray-100">
                Sign In
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* What is this */}
      <section className="mx-auto max-w-5xl px-6 py-16 md:px-12">
        <h2 className="text-2xl font-bold text-kenya-black">What this platform does</h2>
        <p className="mt-3 max-w-3xl text-gray-600">
          Kenya&apos;s cooperative movement spans coffee, tea, dairy, sugarcane, cotton,
          fisheries, livestock, housing and transport SACCOs, and more — thousands of
          societies overseen by County Departments of Co-operative Development. This
          system replaces manual registers and scattered spreadsheets with one
          governed, auditable platform: a national registry, a field-operations
          tracker for county staff, a document-approval pipeline for legal filings,
          and an automated governance engine that enforces statutory rules like
          committee term limits and the 1/3 gender rotation requirement.
        </p>

        <div className="mt-10 grid gap-5 sm:grid-cols-2">
          {MODULES.map((m) => (
            <div key={m.title} className="rounded-xl border border-gray-200 p-5 shadow-sm">
              <h3 className="font-semibold text-kenya-green">{m.title}</h3>
              <p className="mt-2 text-sm text-gray-600">{m.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* National coverage */}
      <section className="bg-gray-50 py-16">
        <div className="mx-auto grid max-w-5xl items-center gap-10 px-6 md:grid-cols-2 md:px-12">
          <div>
            <h2 className="text-2xl font-bold text-kenya-black">Built for all 47 counties</h2>
            <p className="mt-3 text-gray-600">
              Every County Director sees only their own county&apos;s cooperatives and
              staff. A National Admin account has cross-county oversight for the
              State Department for Co-operatives — one dashboard, one governance
              standard, applied consistently from Mombasa to Turkana.
            </p>
            <p className="mt-3 text-sm text-gray-500">
              Pick your county after signing in to see local cooperatives, staff,
              and compliance status.
            </p>
          </div>
          <img
            src={COUNTY_MAP_IMG}
            alt="Map of the 47 counties of Kenya"
            className="mx-auto max-h-96 w-auto rounded-lg border border-gray-200 bg-white p-4 shadow-sm"
          />
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-gray-100 px-6 py-8 text-center text-xs text-gray-400 md:px-12">
        <p>
          Photography: tea highlands, national flag, and county map via Wikimedia
          Commons (CC BY-SA).
        </p>
        <p className="mt-1">© {new Date().getFullYear()} Republic of Kenya — Pilot deployment for demonstration purposes.</p>
      </footer>
    </div>
  );
}

