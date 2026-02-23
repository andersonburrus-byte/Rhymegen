"use client";
import { useState, useCallback } from "react";
import { InputZone } from "@/components/InputZone";
import { ResultsZone } from "@/components/ResultsZone";

export interface RhymeResult {
  phrase: string;
  tier: number;
  score: number;
  corpus: boolean;
  aiScore?: number;
}

export interface CorpusMiss {
  phrase: string;
  fingerprint: string[];
  reason: string;
}

export interface MatchDebug {
  inputPhrase: string;
  resolvedPhonemes: string[];
  fingerprint: string[];
  syllables: number;
  totalEntriesChecked: number;
  corpusChecked: number;
  corpusMisses: CorpusMiss[];
  tierCounts: Record<number, number>;
  dedupDropped: number;
}

export interface RhymeResponse {
  results: RhymeResult[];
  pattern: string | null;
  syllables: number | null;
  warnings: string[];
  count: number;
  aiReranked?: boolean;
  debug?: MatchDebug;
  error?: string;
  message?: string;
}

export default function Home() {
  const [phrase, setPhrase] = useState("");
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<RhymeResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = useCallback(async () => {
    const trimmed = phrase.trim();
    if (!trimmed) return;

    setLoading(true);
    setError(null);
    setData(null);

    try {
      const res = await fetch("/api/rhyme", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phrase: trimmed, count: 50 }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setError(err.message ?? "Something went wrong. Please try again.");
        return;
      }

      const json: RhymeResponse = await res.json();
      setData(json);

      // ── Browser console debug log ──────────────────────────────────────────
      if (json.debug) {
        const d = json.debug;
        const t = d.tierCounts;
        console.groupCollapsed(
          `%c[RhymeGen] "${trimmed}"  %c${json.pattern ?? "—"}  %c${d.syllables} syl`,
          "color:#a78bfa;font-weight:bold",
          "color:#34d399",
          "color:#94a3b8"
        );
        console.log("Resolved phonemes:", d.resolvedPhonemes.join(" "));
        console.log(
          `Entries checked: ${d.totalEntriesChecked} total / ${d.corpusChecked} corpus`
        );
        console.log(
          `Tier breakdown (pre-dedup):  T1=${t[1] ?? 0}  T2=${t[2] ?? 0}  T3=${t[3] ?? 0}  T4=${t[4] ?? 0}`
        );
        console.log(`Dedup dropped: ${d.dedupDropped}`);
        if (json.warnings?.length) {
          console.warn("Input warnings:", json.warnings);
        }
        if (d.corpusMisses.length > 0) {
          console.groupCollapsed(
            `%cCorpus misses (${d.corpusMisses.length})`,
            "color:#f87171"
          );
          for (const m of d.corpusMisses) {
            console.log(
              `%c✗ "${m.phrase}"%c  [${m.fingerprint.join(" · ")}]  ${m.reason}`,
              "color:#fbbf24",
              "color:#94a3b8"
            );
          }
          console.groupEnd();
        } else {
          console.log("%c✓ All corpus entries matched or expected to miss", "color:#34d399");
        }
        console.groupEnd();
      }
      // ────────────────────────────────────────────────────────────────────────
    } catch {
      setError("Network error. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }, [phrase]);

  const handleClear = useCallback(() => {
    setPhrase("");
    setData(null);
    setError(null);
  }, []);

  return (
    <main className="min-h-screen max-w-2xl mx-auto px-4 py-12 sm:py-16">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
          Multisyllabic Rhyme Generator
        </h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Enter a phrase to find phonetically matched rhymes.
        </p>
      </header>

      <InputZone
        value={phrase}
        onChange={setPhrase}
        onSubmit={handleSubmit}
        onClear={handleClear}
        loading={loading}
      />

      <ResultsZone data={data} loading={loading} error={error} />
    </main>
  );
}
