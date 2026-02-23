/**
 * matcher.ts — TypeScript port of matching.py
 * Runs in the Next.js API route (Node.js / Vercel serverless).
 * Reads corpus.json, wordlist.json, phoneme_lookup.json at module init.
 */

import path from "path";
import fs from "fs";

// ── Tunable constants ─────────────────────────────────────────────────────────
const TIER2_THRESHOLD = 0.6;
const TIER_BASE: Record<number, number> = { 1: 100, 2: 70, 3: 40, 4: 20 };
const INTERIOR_BONUS_PER_MATCH = 8;
const CORPUS_BONUS = 25;
// ─────────────────────────────────────────────────────────────────────────────

const VOWELS = new Set([
  "IH", "UH", "AH", "EH", "ER", "IY", "EY", "AY", "OW", "UW",
  "AO", "AA", "AW", "OY",
]);

// Normalise variant CMU phonemes to their canonical form.
// AE ("cat") → AH keeps short-a words consistent with the corpus notation.
const PHONEME_NORM: Record<string, string> = { AE: "AH" };

// ── Types ─────────────────────────────────────────────────────────────────────
export interface CorpusEntry {
  phrase: string;
  phonemes: string[];
  fingerprint: string[];
  syllables: number;
  source: "corpus" | "wordlist";
}

export interface RhymeResult {
  phrase: string;
  tier: number;
  score: number;
  corpus: boolean;
}

export interface MatchOutput {
  results: RhymeResult[];
  pattern: string | null;
  syllables: number | null;
  warnings: string[];
  count: number;
  error?: string;
  message?: string;
}

// ── Data loading (cached at module level) ────────────────────────────────────
const DATA_DIR = path.join(process.cwd(), "data");

function loadJSON<T>(filename: string): T {
  const raw = fs.readFileSync(path.join(DATA_DIR, filename), "utf-8");
  return JSON.parse(raw) as T;
}

let _allEntries: CorpusEntry[] | null = null;
let _phonemeLookup: Record<string, string[]> | null = null;

function getAllEntries(): CorpusEntry[] {
  if (!_allEntries) {
    const corpus = loadJSON<CorpusEntry[]>("corpus.json");
    const wordlist = loadJSON<CorpusEntry[]>("wordlist.json");
    _allEntries = [...corpus, ...wordlist];
  }
  return _allEntries;
}

function getPhonemeLookup(): Record<string, string[]> {
  if (!_phonemeLookup) {
    _phonemeLookup = loadJSON<Record<string, string[]>>("phoneme_lookup.json");
  }
  return _phonemeLookup;
}

// ── Fingerprint extraction ────────────────────────────────────────────────────
function extractFingerprint(phonemes: string[]): string[] {
  const fp: string[] = [];
  let i = 0;
  while (i < phonemes.length) {
    const p = PHONEME_NORM[phonemes[i]] ?? phonemes[i];
    if (
      (p === "AO" || p === "AA") &&
      i + 1 < phonemes.length &&
      (PHONEME_NORM[phonemes[i + 1]] ?? phonemes[i + 1]) === "R"
    ) {
      fp.push(p + " R");
      i += 2;
    } else if (VOWELS.has(p)) {
      fp.push(p);
      i += 1;
    } else {
      i += 1;
    }
  }
  return fp;
}

// ── Word lookup with suffix stripping ────────────────────────────────────────
function lookupWord(
  word: string,
  lookup: Record<string, string[]>
): string[] | null {
  if (lookup[word]) return lookup[word];
  for (const suf of ["ing", "ed", "er", "s"]) {
    if (word.endsWith(suf) && word.length > suf.length) {
      const stem = word.slice(0, -suf.length);
      if (lookup[stem]) return lookup[stem];
    }
  }
  return null;
}

// ── Scoring ───────────────────────────────────────────────────────────────────
function scoreEntry(
  entryFp: string[],
  inputFp: string[]
): [number, number] | null {
  if (entryFp.length !== inputFp.length) return null;

  const finalInput = inputFp[inputFp.length - 1];
  const finalEntry = entryFp[entryFp.length - 1];

  const R_VOWELS = new Set(["AO R", "AA R"]);
  const bareInput = finalInput.replace(" R", "");
  const bareEntry = finalEntry.replace(" R", "");

  let tier: number;

  if (
    R_VOWELS.has(finalInput) !== R_VOWELS.has(finalEntry) &&
    bareInput === bareEntry
  ) {
    tier = 4;
  } else if (finalEntry !== finalInput) {
    tier = 4;
  } else {
    const totalInterior = inputFp.length - 1;
    if (totalInterior === 0) {
      tier = 1;
    } else {
      let interiorMatches = 0;
      for (let i = 0; i < totalInterior; i++) {
        if (entryFp[i] === inputFp[i]) interiorMatches++;
      }
      const ratio = interiorMatches / totalInterior;
      if (interiorMatches === totalInterior) {
        tier = 1;
      } else if (ratio >= TIER2_THRESHOLD) {
        tier = 2;
      } else {
        tier = 3;
      }
    }
  }

  const base = TIER_BASE[tier];

  let interiorMatchesForBonus = 0;
  if (tier === 2 || tier === 3) {
    for (let i = 0; i < inputFp.length - 1; i++) {
      if (entryFp[i] === inputFp[i]) interiorMatchesForBonus++;
    }
  }
  const interiorBonus = interiorMatchesForBonus * INTERIOR_BONUS_PER_MATCH;

  return [base + interiorBonus, tier];
}

function applyCorpusBonus(score: number, tier: number, isCorpus: boolean): number {
  if (!isCorpus) return score;
  const tierFloors: Record<number, number> = { 1: 100, 2: 70, 3: 40, 4: 20 };
  const nextTierFloor = tierFloors[tier - 1] ?? 999;
  return Math.min(score + CORPUS_BONUS, nextTierFloor - 1);
}

// ── Main match function ───────────────────────────────────────────────────────
export function findRhymes(phrase: string, count: number): MatchOutput {
  count = Math.max(1, Math.min(200, count));

  const lookup = getPhonemeLookup();
  const allEntries = getAllEntries();

  // Phrase → phonemes
  const words = phrase
    .toLowerCase()
    .trim()
    .split(/\s+/)
    .map((w) => w.replace(/[^a-z']/g, ""))
    .filter(Boolean);

  const allPhonemes: string[] = [];
  const warnings: string[] = [];

  for (const word of words) {
    const ph = lookupWord(word, lookup);
    if (ph) {
      allPhonemes.push(...ph);
    } else {
      warnings.push(`'${word}' not recognized — matched on remaining words`);
    }
  }

  if (allPhonemes.length === 0) {
    return {
      results: [],
      pattern: null,
      syllables: null,
      error: "unrecognized_input",
      message:
        "None of these words were recognized. Try entering just the key rhyming syllables (e.g., 'door' instead of 'hit your front door').",
      warnings,
      count: 0,
    };
  }

  const fingerprint = extractFingerprint(allPhonemes);
  const syllables = fingerprint.length;

  if (syllables === 0) {
    return {
      results: [],
      pattern: null,
      syllables: 0,
      error: "no_vowels",
      message: "Could not identify any vowel sounds in that phrase.",
      warnings,
      count: 0,
    };
  }

  const patternStr = fingerprint.join(" · ");

  // Match & score
  const results: RhymeResult[] = [];

  for (const entry of allEntries) {
    if (entry.syllables !== syllables) continue;
    if (!entry.fingerprint?.length) continue;

    const scored = scoreEntry(entry.fingerprint, fingerprint);
    if (!scored) continue;
    const [score, tier] = scored;
    if (score === 0) continue;

    const isCorpus = entry.source === "corpus";
    const finalScore = applyCorpusBonus(score, tier, isCorpus);

    results.push({
      phrase: entry.phrase,
      tier,
      score: finalScore,
      corpus: isCorpus,
    });
  }

  results.sort((a, b) => b.score - a.score || a.phrase.localeCompare(b.phrase));

  // ── Deduplication ────────────────────────────────────────────────────────
  // 1. Exact duplicates: same phrase from both corpus + wordlist (case-insensitive).
  //    Results are sorted by score desc, so the higher-scoring copy comes first
  //    and the lower-scoring duplicate is silently dropped.
  // 2. Plural duplicates: single-word results ending in -s/-es/-ers are dropped
  //    when their singular already appears in the list.
  const seenPhrases = new Set<string>();
  const deduped: RhymeResult[] = [];
  for (const r of results) {
    const lower = r.phrase.toLowerCase();

    // Exact-match dedup (handles "Dinosaur" corpus + "dinosaur" wordlist)
    if (seenPhrases.has(lower)) continue;

    const words = lower.split(/\s+/);
    // Only apply plural dedup to single-word results
    if (words.length === 1) {
      const word = words[0];
      let isSuperfluous = false;
      // -ers  e.g. "crusaders" when "crusader" already seen
      if (word.endsWith("ers") && seenPhrases.has(word.slice(0, -1))) {
        isSuperfluous = true;
      // -es   e.g. "tornadoes" when "tornado" already seen
      } else if (word.endsWith("es") && seenPhrases.has(word.slice(0, -2))) {
        isSuperfluous = true;
      // -s    e.g. "dinosaurs" when "dinosaur" already seen
      } else if (
        word.endsWith("s") &&
        !word.endsWith("ss") &&
        seenPhrases.has(word.slice(0, -1))
      ) {
        isSuperfluous = true;
      }
      if (isSuperfluous) continue;
    }
    seenPhrases.add(lower);
    deduped.push(r);
  }

  const trimmed = deduped.slice(0, count);

  return {
    results: trimmed,
    pattern: patternStr,
    syllables,
    warnings,
    count: trimmed.length,
  };
}
