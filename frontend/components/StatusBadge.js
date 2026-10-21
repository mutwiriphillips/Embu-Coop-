const STYLES = {
  ACTIVE_OFFICE: { label: "Active at the office", cls: "bg-green-100 text-green-800", dot: "bg-green-600" },
  FIELDWORK: { label: "On fieldwork", cls: "bg-blue-100 text-blue-800", dot: "bg-blue-600" },
  ON_LEAVE: { label: "On leave", cls: "bg-amber-100 text-amber-800", dot: "bg-amber-600" },
};
export const STATUS_OPTIONS = Object.entries(STYLES).map(([value, s]) => ({ value, label: s.label }));

export default function StatusBadge({ status, className = "" }) {
  const s = STYLES[status] || STYLES.ACTIVE_OFFICE;
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ${s.cls} ${className}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} aria-hidden="true" />{s.label}
    </span>
  );
}
