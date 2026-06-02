export function ProgressBar({ value }: { value: number }) {
  const clamped = Math.min(Math.max(value, 0), 100);

  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200">
      <div
        className="h-full rounded-full bg-emerald-600 transition-all"
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}
