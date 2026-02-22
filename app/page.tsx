"use client";
import { useState, useCallback } from "react";
import { InputZone } from "@/components/InputZone";
import { ResultsZone } from "@/components/ResultsZone";

interface RhymeResult {
  phrase: string;
  tier: number;
  score: number;
  corpus: boolean;
}

interface RhymeResponse {
  results: RhymeResult[];
  pattern: string | null;
  syllables: number | null;
  warnings: string[];
  count: number;
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
