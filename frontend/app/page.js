"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "../context/AuthContext";

// Real, freely-licensed photography (Wikimedia Commons, CC-BY-SA) — no
// AI-generated images and no depictions of real identifiable individuals.
const HERO_IMG = "https://commons.wikimedia.org/wiki/Special:FilePath/Cycling_in_the_Eden_tea_farms.jpg?width=1600";
const COAT_OF_ARMS_IMG = "https://commons.wikimedia.org/wiki/Special:FilePath/Coat_of_arms_of_Kenya.svg?width=140";
const COUNTY_MAP_IMG = "https://commons.wikimedia.org/wiki/Special:FilePath/Kenya_county_map_labelled_with_names.svg?width=700";

const PORTALS = [
  {
    key: "farmer",
    title: "Farmers",
    body: "See your contributions, deliveries, payouts, and input credit.",
    signInWith: "National ID",
    signIn: "/member/login",
    secondary: { href: "/member/register", label: "Register as a farmer" },
    accent: "border-t-kenya-red",
  },
  {
    key: "cooperative",
    title: "Cooperatives",
    body: "Run your society: members, produce, payouts, documents, and elections.",
    signInWith: "Email or registration number",
    signIn: "/cooperative/login",
    note: "Accounts are created by your County Co-operative Office.",
    accent: "border-t-kenya-green",
  },
  {
    key: "agrovet",
    title: "Agrovet Shops",
    body: "Supply farmers against their input credit and track your reimbursements.",
    signInWith: "Owner's National ID",
    signIn: "/agrovet/login",
    secondary: { href: "/agrovet/apply", label: "Apply to join" },
    accent: "border-t-kenya-gold",
  },
  {
    key: "staff",
    title: "County Staff",
    body: "Directors, Sub-County Officers, and Field Officers.",
    signInWith: "Work email",
    signIn: "/login",
    secondary: { href: "/signup", label: "Test-run signup" },
    accent: "border-t-kenya-black",
  },
];

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

      {/* Top bar — just two staff-facing actions. Farmer sign-in lives in the
          footer (see below) and the hero's own CTA, so the header never has
          to squeeze more items than a narrow screen can hold. */}
      <header className="flex items-center justify-between border-b border-gray-100 px-4 py-3 md:px-12 md:py-4">
        <div className="flex min-w-0 items-center gap-2 md:gap-3">
          <img src={COAT_OF_ARMS_IMG} alt="Coat of Arms of Kenya" className="h-7 w-auto flex-shrink-0 md:h-10" />
          <div className="min-w-0">
            <p className="truncate text-xs font-bold text-kenya-black md:text-sm">Republic of Kenya</p>
            <p className="truncate text-[10px] text-gray-500 md:text-xs">State Dept. for Co-operatives</p>
          </div>
        </div>
        <div className="flex flex-shrink-0 items-center gap-2 md:gap-3">
          <a
            href="#portals"
            className="rounded-md border border-kenya-green px-2.5 py-1.5 text-xs font-semibold text-kenya-green hover:bg-kenya-green/5 md:px-4 md:py-2 md:text-sm"
          >
            Sign In
          </a>
          <Link
            href="/signup"
            className="rounded-md bg-kenya-green px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-kenya-green/90 md:px-4 md:py-2 md:text-sm"
          >
            Test-Run
          </Link>
        </div>
      </header>

      {/* Hero — two entirely separate structures, not one flexible markup
          stretched across breakpoints. Mobile never overlays text on the
          photo at all: image on top, then a solid content block underneath
          in normal document flow, so there is nothing to overlap or clip.
          Desktop keeps the richer image-with-overlay treatment, where there
          is enough room for it to read cleanly. */}

      {/* Mobile hero (stacked, no overlay) */}
      <section className="md:hidden">
        <img src={HERO_IMG} alt="Tea farms in the Kenyan highlands" className="h-52 w-full object-cover" />
        <div className="bg-kenya-black px-5 py-7">
          <h1 className="text-2xl font-extrabold leading-tight text-white">
            National Cooperative Management &amp; Governance System
          </h1>
          <p className="mt-3 text-sm text-gray-200">
            A single, secure digital home for every county&apos;s cooperative societies —
            membership, field operations, documents, and governance compliance,
            built for all 47 counties of Kenya.
          </p>
          <div className="mt-5 flex flex-col gap-3">
            <Link
              href="/member/register"
              className="rounded-md bg-kenya-red px-5 py-3 text-center text-sm font-semibold text-white hover:bg-kenya-red/90"
            >
              Register as a Farmer
            </Link>
            <Link
              href="/member/login"
              className="rounded-md border border-white/30 px-5 py-3 text-center text-sm font-semibold text-white hover:bg-white/10"
            >
              Already registered? Sign in
            </Link>
            <a href="#portals" className="text-center text-xs font-medium text-gray-300 underline">
              Cooperative, agrovet, or county staff? Choose your portal ↓
            </a>
          </div>
        </div>
      </section>

      {/* Desktop hero (image with text overlay) */}
      <section className="relative hidden overflow-hidden md:block">
        <img src={HERO_IMG} alt="Tea farms in the Kenyan highlands" className="h-[460px] w-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-r from-kenya-black/85 via-kenya-black/50 to-transparent" />
        <div className="absolute inset-0 flex items-center px-12">
          <div className="max-w-xl text-white">
            <h1 className="text-4xl font-extrabold leading-tight lg:text-5xl">
              National Cooperative Management &amp; Governance System
            </h1>
            <p className="mt-4 text-lg text-gray-100">
              A single, secure digital home for every county&apos;s cooperative societies —
              membership records, field operations, legal documents, and governance
              compliance, built for all 47 counties of Kenya.
            </p>
            <div className="mt-6 flex gap-3">
              <Link href="/member/register" className="rounded-md bg-kenya-red px-5 py-2.5 text-sm font-semibold text-white hover:bg-kenya-red/90">
                Register as a Farmer
              </Link>
              <Link href="/member/login" className="rounded-md bg-white px-5 py-2.5 text-sm font-semibold text-kenya-black hover:bg-gray-100">
                Farmer Sign In
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Portal chooser: every audience gets its own clearly labelled door.
          Normal document flow and a simple responsive grid (1 / 2 / 4
          columns), so nothing can overlap on a narrow phone. */}
      <section id="portals" className="scroll-mt-4 bg-gray-50 px-5 py-10 sm:px-6 md:px-12 md:py-14">
        <div className="mx-auto max-w-6xl">
          <h2 className="text-xl font-bold text-kenya-black sm:text-2xl">Sign in to your portal</h2>
          <p className="mt-1 text-sm text-gray-600">Each portal has its own secure sign-in. Choose the one that fits you.</p>
          <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {PORTALS.map((p) => (
              <div key={p.key} className={`flex flex-col rounded-xl border border-gray-200 border-t-4 ${p.accent} bg-white p-5 shadow-sm`}>
                <h3 className="text-base font-bold text-kenya-black">{p.title}</h3>
                <p className="mt-1 text-sm text-gray-600">{p.body}</p>
                <p className="mt-2 text-xs text-gray-500">Sign in with: <span className="font-medium text-gray-700">{p.signInWith}</span></p>
                <div className="mt-4 flex flex-col gap-2 pt-1 sm:mt-auto">
                  <Link href={p.signIn} className="rounded-md bg-kenya-green px-4 py-2.5 text-center text-sm font-semibold text-white hover:bg-kenya-green/90">
                    Sign in
                  </Link>
                  {p.secondary && (
                    <Link href={p.secondary.href} className="rounded-md border border-kenya-green px-4 py-2.5 text-center text-sm font-semibold text-kenya-green hover:bg-kenya-green/5">
                      {p.secondary.label}
                    </Link>
                  )}
                  {p.note && <p className="text-center text-xs text-gray-400">{p.note}</p>}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* What is this */}
      <section className="mx-auto max-w-5xl px-5 py-12 sm:px-6 md:px-12 md:py-16">
        <h2 className="text-xl font-bold text-kenya-black sm:text-2xl">What this platform does</h2>
        <p className="mt-3 max-w-3xl text-sm text-gray-600 sm:text-base">
          Kenya&apos;s cooperative movement spans coffee, tea, dairy, sugarcane, cotton,
          fisheries, livestock, housing and transport SACCOs, and more — thousands of
          societies overseen by County Departments of Co-operative Development. This
          system replaces manual registers and scattered spreadsheets with one
          governed, auditable platform: a national registry, a field-operations
          tracker for county staff, a document-approval pipeline for legal filings,
          and an automated governance engine that enforces statutory rules like
          committee term limits and the 1/3 gender rotation requirement.
        </p>

        <div className="mt-8 grid gap-4 sm:mt-10 sm:grid-cols-2 sm:gap-5">
          {MODULES.map((m) => (
            <div key={m.title} className="rounded-xl border border-gray-200 p-4 shadow-sm sm:p-5">
              <h3 className="font-semibold text-kenya-green">{m.title}</h3>
              <p className="mt-2 text-sm text-gray-600">{m.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* National coverage */}
      <section className="bg-gray-50 py-12 md:py-16">
        <div className="mx-auto grid max-w-5xl items-center gap-8 px-5 sm:px-6 md:grid-cols-2 md:gap-10 md:px-12">
          <div>
            <h2 className="text-xl font-bold text-kenya-black sm:text-2xl">Built for all 47 counties</h2>
            <p className="mt-3 text-sm text-gray-600 sm:text-base">
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
            className="mx-auto max-h-72 w-auto rounded-lg border border-gray-200 bg-white p-3 shadow-sm sm:max-h-96 sm:p-4"
          />
        </div>
      </section>

      {/* Footer — the farmer sign-in link lives here now: always reachable,
          never competing with the header or hero for space. */}
      <footer className="border-t border-gray-100 px-5 py-8 text-center text-xs text-gray-400 sm:px-6 md:px-12">
        <p className="text-sm">
          <span className="text-gray-500">Sign in: </span>
          <Link href="/member/login" className="font-medium text-kenya-green hover:underline">Farmer</Link>
          <span className="text-gray-400"> · </span>
          <Link href="/cooperative/login" className="font-medium text-kenya-green hover:underline">Cooperative</Link>
          <span className="text-gray-400"> · </span>
          <Link href="/agrovet/login" className="font-medium text-kenya-green hover:underline">Agrovet</Link>
          <span className="text-gray-400"> · </span>
          <Link href="/login" className="font-medium text-kenya-green hover:underline">County Staff</Link>
        </p>
        <p className="mt-4">
          <Link href="/privacy" className="font-medium text-kenya-green hover:underline">
            Privacy &amp; Data Governance Policy
          </Link>
        </p>
        <p className="mt-2">
          Photography: tea highlands, national flag, and county map via Wikimedia
          Commons (CC BY-SA).
        </p>
        <p className="mt-1">© {new Date().getFullYear()} Republic of Kenya — Pilot deployment for demonstration purposes.</p>
      </footer>
    </div>
  );
}
