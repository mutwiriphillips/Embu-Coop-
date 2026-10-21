// Compliance indicator for a cooperative's record: Compliant / Partial / Incomplete.
export const LEVELS = {
  COMPLIANT: { label: "Compliant", cls: "bg-green-100 text-green-800", dot: "bg-green-600", bar: "bg-green-600" },
  PARTIAL: { label: "Partial", cls: "bg-amber-100 text-amber-800", dot: "bg-amber-500", bar: "bg-amber-500" },
  INCOMPLETE: { label: "Incomplete", cls: "bg-red-100 text-red-800", dot: "bg-red-600", bar: "bg-red-600" },
};

export default function ComplianceBadge({ compliance }) {
  if (!compliance) return null;
  const l = LEVELS[compliance.level] || LEVELS.INCOMPLETE;
  const title = compliance.missing?.length ? `Still missing: ${compliance.missing.map((m) => m.label).join("; ")}` : "Everything required is on file";
  return (
    <span title={title} className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ${l.cls}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${l.dot}`} />
      {l.label} · {compliance.percent}%
    </span>
  );
}
