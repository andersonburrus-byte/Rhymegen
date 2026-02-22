"use client";
import { useState, useCallback } from "react";
import { Copy } from "lucide-react";
import { TierBadge } from "./TierBadge";
import { CorpusBadge } from "./CorpusBadge";

interface Result {
  phrase: string;
  tier: number;
  score: number;
  corpus: boolean;
}

interface ResultRowProps {
  result: Result;
  onCopy: (text: string) => void;
}

export function ResultRow({ result, onCopy }: ResultRowProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(result.phrase);
      setCopied(true);
      onCopy(result.phrase);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API unavailable — silent fail
    }
  }, [result.phrase, onCopy]);

  return (
    <div
      className="group flex items-center justify-between gap-3 px-4 py-3 rounded-lg hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-colors"
      role="listitem"
    >
      <div className="flex items-center gap-2 min-w-0">
        <TierBadge tier={result.tier} />
        {result.corpus && <CorpusBadge />}
        <span className="text-sm font-medium text-zinc-800 dark:text-zinc-200 truncate capitalize">
          {result.phrase}
        </span>
      </div>
      <button
        onClick={handleCopy}
        aria-label={`Copy "${result.phrase}"`}
        className="shrink-0 opacity-0 group-hover:opacity-100 focus:opacity-100 rounded p-1 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 transition-all focus:outline-none focus:ring-2 focus:ring-zinc-400 dark:focus:ring-zinc-500"
      >
        <Copy
          size={14}
          strokeWidth={1.5}
          className={copied ? "text-emerald-500" : ""}
        />
      </button>
    </div>
  );
}
