import clsx from "clsx";

const styles: Record<string, string> = {
  valid: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  invalid: "bg-rose-50 text-rose-800 ring-rose-200",
  risky: "bg-amber-50 text-amber-800 ring-amber-200",
  unknown: "bg-sky-50 text-sky-800 ring-sky-200",
  duplicate: "bg-slate-100 text-slate-700 ring-slate-200",
  queued: "bg-slate-100 text-slate-700 ring-slate-200",
  processing: "bg-blue-50 text-blue-800 ring-blue-200",
  completed: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  failed: "bg-rose-50 text-rose-800 ring-rose-200",
  cancelled: "bg-zinc-100 text-zinc-700 ring-zinc-200"
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={clsx(
        "inline-flex items-center rounded-md px-2 py-1 text-xs font-semibold capitalize ring-1 ring-inset",
        styles[status] ?? styles.unknown
      )}
    >
      {status.replace("_", " ")}
    </span>
  );
}
