import { clsx } from "clsx";

const TIER_LABELS: Record<number, string> = {
  1: "Perfect",
  2: "Strong",
  3: "Slant",
  4: "Loose",
};

const TIER_STYLES: Record<number, string> = {
  1: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
  2: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300",
  3: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  4: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
};

export function TierBadge({ tier }: { tier: number }) {
  return (
    <span
      className={clsx(
        "inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium tabular-nums",
        TIER_STYLES[tier] ?? TIER_STYLES[4]
      )}
      aria-label={`Tier ${tier}: ${TIER_LABELS[tier]}`}
    >
      T{tier}
    </span>
  );
}
