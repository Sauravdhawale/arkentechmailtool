import type { LucideIcon } from "lucide-react";
import { formatNumber } from "../lib/format";

type StatCardProps = {
  label: string;
  value: number;
  icon: LucideIcon;
  accent: string;
};

export function StatCard({ label, value, icon: Icon, accent }: StatCardProps) {
  return (
    <div className="rounded-lg border border-line bg-white p-4 shadow-soft">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-medium text-slate-500">{label}</div>
          <div className="mt-2 text-2xl font-semibold tracking-normal text-ink">
            {formatNumber(value)}
          </div>
        </div>
        <div className={`flex h-10 w-10 items-center justify-center rounded-md ${accent}`}>
          <Icon size={20} aria-hidden />
        </div>
      </div>
    </div>
  );
}
