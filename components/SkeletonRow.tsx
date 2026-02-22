export function SkeletonRow() {
  return (
    <div className="flex items-center gap-3 px-4 py-3 rounded-lg" aria-hidden="true">
      <div className="h-5 w-8 rounded bg-zinc-100 dark:bg-zinc-800 animate-pulse" />
      <div className="h-4 rounded bg-zinc-100 dark:bg-zinc-800 animate-pulse" style={{ width: `${80 + Math.random() * 80}px` }} />
    </div>
  );
}

export function SkeletonRows({ count = 8 }: { count?: number }) {
  return (
    <div role="status" aria-label="Loading results">
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonRow key={i} />
      ))}
      <span className="sr-only">Loading…</span>
    </div>
  );
}
