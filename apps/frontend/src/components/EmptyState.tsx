import type { LucideIcon } from "lucide-react";

export function EmptyState({
  icon: Icon,
  title
}: {
  icon: LucideIcon;
  title: string;
}) {
  return (
    <div className="rounded-lg border border-dashed border-line bg-white px-4 py-10 text-center">
      <Icon className="mx-auto text-slate-400" size={32} aria-hidden />
      <div className="mt-3 text-sm font-medium text-slate-600">{title}</div>
    </div>
  );
}
