"use client";
import { useCallback, useState } from "react";
import { ResultRow } from "./ResultRow";
import { SkeletonRows } from "./SkeletonRow";
import { QualitySummary } from "./QualitySummary";
import { PatternDisplay } from "./PatternDisplay";
import { Toast } from "./Toast";

interface Result {
  phrase: string;
  tier: number;
  score: number;
  corpus: boolean;
  aiScore?: number;
}

interface ResultsData {
  results: Result[];
  pattern: string | null;
  syllables: number | null;
  warnings: string[];
  count: number;
  aiReranked?: boolean;
  error?: string;
  message?: string;
}

interface ResultsZoneProps {
  data: ResultsData | null;
  loading: boolean;
  error: string | null;
}

const TIER_LABELS: Record<number, string> = {
  1: "Perfect match",
  2: "Strong match",
  3: "Slant rhyme",
  4: "Loose rhyme",
};

export function ResultsZone({ data, loading, error }: ResultsZoneProps) {
  const [toast, setToast] = useState<string | null>(null);

  const handleCopy = useCallback((text: string) => {
    setToast(`Copied "${text}"`);
  }, []);

  if (loading) {
    return (
      <div className="mt-6">
        <SkeletonRows count={8} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="mt-6 rounded-xl border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/30 px-4 py-3">
        <p className="text-sm text-red-700 dark:text-red-400">{error}</p>
      </div>
    );
  }

  if (!data) return null;

  if (data.error === "unrecognized_input" || (data.results.length === 0 && data.message)) {
    return (
      <div className="mt-6 rounded-xl border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/30 px-4 py-3">
        <p className="text-sm text-amber-800 dark:text-amber-300">{data.message}</p>
      </div>
    );
  }

  if (data.results.length === 0) {
    return (
      <div className="mt-6 text-sm text-zinc-400 dark:text-zinc-500 px-4">
        No rhymes found for that pattern.
      </div>
    );
  }

  // Group results by tier — AI reranking reshuffles within each tier
  const byTier: Record<number, Result[]> = {};
  for (const r of data.results) {
    if (!byTier[r.tier]) byTier[r.tier] = [];
    byTier[r.tier].push(r);
  }
  const tiers = Object.keys(byTier).map(Number).sort();

  return (
    <div className="mt-6 space-y-1">
      {/* Header */}
      <div className="flex items-center justify-between px-4 pb-3">
        <div className="space-y-1">
          {data.pattern && data.syllables && (
            <PatternDisplay pattern={data.pattern} syllables={data.syllables} />
          )}
          <div className="flex items-center gap-3">
            <QualitySummary results={data.results} total={data.count} />
            {data.aiReranked && (
              <span
                className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300"
                title="Results reranked by AI for rap usability"
              >
                ✦ AI ranked
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Warnings */}
      {data.warnings?.length > 0 && (
        <div className="px-4 pb-2">
          {data.warnings.map((w, i) => (
            <p key={i} className="text-xs text-amber-600 dark:text-amber-400">⚠ {w}</p>
          ))}
        </div>
      )}

      {/* Results grouped by tier */}
      <div role="list" aria-label="Rhyme results">
        {tiers.map((tier, ti) => (
          <div key={tier}>
            {ti > 0 && (
              <div className="my-2 border-t border-zinc-100 dark:border-zinc-800 mx-4" aria-hidden="true" />
            )}
            <p className="px-4 pt-1 pb-0.5 text-xs font-medium text-zinc-400 dark:text-zinc-500 uppercase tracking-wider">
              {TIER_LABELS[tier]}
            </p>
            {byTier[tier].map((result) => (
              <ResultRow key={result.phrase} result={result} onCopy={handleCopy} />
            ))}
          </div>
        ))}
      </div>

      {toast && (
        <Toast message={toast} onDismiss={() => setToast(null)} />
      )}
    </div>
  );
}
