interface Result {
  tier: number;
}

interface QualitySummaryProps {
  results: Result[];
  total: number;
}

export function QualitySummary({ results, total }: QualitySummaryProps) {
  const counts = { 1: 0, 2: 0, 3: 0, 4: 0 };
  for (const r of results) {
    counts[r.tier as keyof typeof counts]++;
  }

  return (
    <div className="flex items-center gap-4 text-xs text-zinc-400 dark:text-zinc-500">
      <span>{total} result{total !== 1 ? "s" : ""}</span>
      <div className="flex items-center gap-1.5">
        {counts[1] > 0 && (
          <span className="text-emerald-600 dark:text-emerald-400">{counts[1]} perfect</span>
        )}
        {counts[2] > 0 && (
          <span className="text-blue-600 dark:text-blue-400">{counts[2]} strong</span>
        )}
        {counts[3] > 0 && (
          <span className="text-amber-600 dark:text-amber-400">{counts[3]} slant</span>
        )}
        {counts[4] > 0 && (
          <span className="text-zinc-500 dark:text-zinc-400">{counts[4]} loose</span>
        )}
      </div>
    </div>
  );
}
