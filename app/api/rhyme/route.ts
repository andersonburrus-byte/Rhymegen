import { NextRequest, NextResponse } from "next/server";
import { findRhymes } from "@/lib/matcher";
import { rerank, RERANK_POOL } from "@/lib/reranker";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  let phrase: string;
  let count: number;

  try {
    const body = await req.json();
    phrase = (body.phrase ?? "").trim();
    count = Math.min(200, Math.max(1, parseInt(body.count ?? "50", 10)));
  } catch {
    return NextResponse.json(
      { error: "invalid_request", message: "Invalid JSON body." },
      { status: 400 }
    );
  }

  if (!phrase) {
    return NextResponse.json(
      { error: "empty_input", message: "Phrase cannot be empty." },
      { status: 400 }
    );
  }

  try {
    // Step 1: phonetic matching — fetch a larger pool for AI to rerank from
    const pool = Math.max(count, RERANK_POOL);
    const output = findRhymes(phrase, pool);

    // ── Server-side terminal log ─────────────────────────────────────────────
    const d = output.debug;
    if (d) {
      console.log(`\n[RhymeGen] "${phrase}"`);
      console.log(`  pattern   : ${output.pattern ?? "—"} (${d.syllables} syllable${d.syllables === 1 ? "" : "s"})`);
      console.log(`  phonemes  : ${d.resolvedPhonemes.join(" ")}`);
      console.log(`  entries   : ${d.totalEntriesChecked} checked (${d.corpusChecked} corpus)`);
      console.log(`  tiers     : T1=${d.tierCounts[1] ?? 0}  T2=${d.tierCounts[2] ?? 0}  T3=${d.tierCounts[3] ?? 0}  T4=${d.tierCounts[4] ?? 0}  (before dedup)`);
      console.log(`  dedup     : ${d.dedupDropped} duplicate${d.dedupDropped === 1 ? "" : "s"} dropped`);
      if (output.warnings?.length) console.log(`  warnings  : ${output.warnings.join("; ")}`);
      if (d.corpusMisses.length) {
        console.log(`  corpus misses (${d.corpusMisses.length}):`);
        for (const m of d.corpusMisses.slice(0, 20)) {
          console.log(`    ✗ "${m.phrase}" [${m.fingerprint.join(",")}] — ${m.reason}`);
        }
        if (d.corpusMisses.length > 20) {
          console.log(`    … and ${d.corpusMisses.length - 20} more`);
        }
      }
    }
    // ────────────────────────────────────────────────────────────────────────

    if (output.results.length === 0 || output.error) {
      return NextResponse.json(output);
    }

    // Step 2: AI reranking (gracefully degrades if API key missing or call fails)
    const reranked = await rerank(output.results, phrase);

    // Step 3: trim to requested count after reranking
    const trimmed = reranked.slice(0, count);

    return NextResponse.json({
      ...output,
      results: trimmed,
      count: trimmed.length,
      aiReranked: trimmed.some((r) => r.aiScore !== undefined),
    });
  } catch (err) {
    console.error("matcher error:", err);
    return NextResponse.json(
      {
        error: "engine_error",
        message: "Something went wrong. Please try again.",
      },
      { status: 500 }
    );
  }
}
