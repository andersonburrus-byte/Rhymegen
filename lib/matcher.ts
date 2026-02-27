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

// ── Multi-word combination constants ─────────────────────────────────────────
const MAX_COMBO_RESULTS = 1000;
const MAX_PREFIX_SCAN = 2000;
const COMBO_TIEBREAK_PENALTY = 1;
const FREQ_BONUS_TIERS: [number, number][] = [
  [1e-3, 5],  // Very common words
  [1e-4, 3],  // Common words
  [1e-5, 1],  // Uncommon but real
];
const MAX_PER_PREFIX = 2; // Diversity cap per first word
// ─────────────────────────────────────────────────────────────────────────────

const VOWELS = new Set([
  "IH", "UH", "AH", "EH", "ER", "IY", "EY", "AY", "OW", "UW",
  "AO", "AA", "AW", "OY",
]);

// Normalise variant CMU phonemes to their canonical form.
// AE ("cat") → EH groups short front vowels so "carry"/"scary"/"harry" match.
const PHONEME_NORM: Record<string, string> = { AE: "EH" };

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

export interface CorpusMiss {
  phrase: string;
  fingerprint: string[];
  reason: string; // why it didn't match the input
}

export interface MatchDebug {
  inputPhrase: string;
  resolvedPhonemes: string[];
  fingerprint: string[];
  syllables: number;
  totalEntriesChecked: number;
  corpusChecked: number;
  corpusMisses: CorpusMiss[];     // corpus entries that were wrong syllable count or wrong tier
  tierCounts: Record<number, number>; // how many results per tier (before dedup)
  dedupDropped: number;
}

export interface MatchOutput {
  results: RhymeResult[];
  pattern: string | null;
  syllables: number | null;
  warnings: string[];
  count: number;
  debug?: MatchDebug;
  error?: string;
  message?: string;
}

// ── Combo index types ────────────────────────────────────────────────────────
interface ComboEntry {
  w: string;
  fp: string[];
  f: number;
}

interface ComboIndex {
  by_syl: Record<string, ComboEntry[]>;
  by_final: Record<string, Record<string, ComboEntry[]>>;
}

// ── Data loading (cached at module level) ────────────────────────────────────
const DATA_DIR = path.join(process.cwd(), "data");

function loadJSON<T>(filename: string): T {
  const raw = fs.readFileSync(path.join(DATA_DIR, filename), "utf-8");
  return JSON.parse(raw) as T;
}

let _allEntries: CorpusEntry[] | null = null;
let _phonemeLookup: Record<string, string[]> | null = null;
let _comboIndex: ComboIndex | null = null;

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

function getComboIndex(): ComboIndex {
  if (!_comboIndex) {
    const comboPath = path.join(DATA_DIR, "combo_index.json");
    if (fs.existsSync(comboPath)) {
      _comboIndex = loadJSON<ComboIndex>("combo_index.json");
    } else {
      _comboIndex = { by_syl: {}, by_final: {} };
    }
  }
  return _comboIndex;
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

// ── Multi-word combination ──────────────────────────────────────────────────
function comboFreqBonus(entries: ComboEntry[]): number {
  const minFreq = Math.min(...entries.map((e) => e.f ?? 0));
  for (const [threshold, bonus] of FREQ_BONUS_TIERS) {
    if (minFreq >= threshold) return bonus;
  }
  return 0;
}

function generateCombos(
  inputFp: string[],
  comboIndex: ComboIndex,
  existingPhrases: Set<string>,
  count: number
): RhymeResult[] {
  const n = inputFp.length;
  if (n < 2) return [];

  const targetFinal = inputFp[n - 1];
  const bySyl = comboIndex.by_syl;
  const byFinal = comboIndex.by_final;
  const combos: RhymeResult[] = [];
  const seenPhrases = new Set<string>();

  // ── 2-word combos ──────────────────────────────────────────────────────
  const numSplits = n - 1;
  const perSplitCap = Math.floor(MAX_COMBO_RESULTS / Math.max(numSplits, 1));

  for (let split = 1; split < n; split++) {
    const suffixSyl = n - split;
    const prefixSyl = split;

    const suffixEntries = byFinal[targetFinal]?.[String(suffixSyl)] ?? [];
    if (suffixEntries.length === 0) continue;

    const prefixEntries = bySyl[String(prefixSyl)] ?? [];
    if (prefixEntries.length === 0) continue;

    const scanPrefixes = prefixEntries.slice(0, MAX_PREFIX_SCAN);
    let splitFound = 0;

    for (const suffix of suffixEntries) {
      for (const prefix of scanPrefixes) {
        const combinedFp = [...prefix.fp, ...suffix.fp];
        const scored = scoreEntry(combinedFp, inputFp);
        if (!scored) continue;
        const [score, tier] = scored;
        if (score === 0 || tier > 3) continue;

        const phrase = prefix.w + " " + suffix.w;
        const phraseLower = phrase.toLowerCase();
        if (seenPhrases.has(phraseLower) || existingPhrases.has(phraseLower)) continue;
        seenPhrases.add(phraseLower);

        const freqBonus = comboFreqBonus([prefix, suffix]);
        const finalScore = score - COMBO_TIEBREAK_PENALTY + freqBonus;

        combos.push({ phrase, tier, score: finalScore, corpus: false });
        splitFound++;
        if (splitFound >= perSplitCap) break;
      }
      if (splitFound >= perSplitCap) break;
    }
  }

  // ── 3-word combos (only for 3-4 syllable inputs) ───────────────────────
  if (n <= 4) {
    for (let s1 = 1; s1 < n - 1; s1++) {
      for (let s2 = s1 + 1; s2 < n; s2++) {
        const syl3 = n - s2;
        const w3Entries = byFinal[targetFinal]?.[String(syl3)] ?? [];
        if (w3Entries.length === 0) continue;

        const w1Entries = bySyl[String(s1)] ?? [];
        const w2Entries = bySyl[String(s2 - s1)] ?? [];
        if (w1Entries.length === 0 || w2Entries.length === 0) continue;

        const scanW1 = w1Entries.slice(0, 300);
        const scanW2 = w2Entries.slice(0, 300);

        for (const w3 of w3Entries) {
          for (const w2 of scanW2) {
            for (const w1 of scanW1) {
              const combinedFp = [...w1.fp, ...w2.fp, ...w3.fp];
              const scored = scoreEntry(combinedFp, inputFp);
              if (!scored) continue;
              const [score, tier] = scored;
              if (score === 0 || tier > 3) continue;

              const phrase = w1.w + " " + w2.w + " " + w3.w;
              const phraseLower = phrase.toLowerCase();
              if (seenPhrases.has(phraseLower) || existingPhrases.has(phraseLower)) continue;
              seenPhrases.add(phraseLower);

              const freqBonus = comboFreqBonus([w1, w2, w3]);
              const finalScore = score - COMBO_TIEBREAK_PENALTY + freqBonus;

              combos.push({ phrase, tier, score: finalScore, corpus: false });
              if (combos.length >= MAX_COMBO_RESULTS) break;
            }
            if (combos.length >= MAX_COMBO_RESULTS) break;
          }
          if (combos.length >= MAX_COMBO_RESULTS) break;
        }
        if (combos.length >= MAX_COMBO_RESULTS) break;
      }
      if (combos.length >= MAX_COMBO_RESULTS) break;
    }
  }

  // Sort by score descending, then alphabetical
  combos.sort((a, b) => b.score - a.score || a.phrase.localeCompare(b.phrase));

  // Diversity filter: cap results per first word
  const prefixCounts: Record<string, number> = {};
  const diverse: RhymeResult[] = [];
  for (const c of combos) {
    const prefix = c.phrase.split(" ")[0];
    prefixCounts[prefix] = (prefixCounts[prefix] ?? 0) + 1;
    if (prefixCounts[prefix] <= MAX_PER_PREFIX) {
      diverse.push(c);
    }
  }

  return diverse.slice(0, Math.min(count, MAX_COMBO_RESULTS));
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
  const corpusMisses: CorpusMiss[] = [];
  let totalChecked = 0;
  let corpusChecked = 0;

  for (const entry of allEntries) {
    totalChecked++;
    const isCorpus = entry.source === "corpus";
    if (isCorpus) corpusChecked++;

    if (entry.syllables !== syllables) {
      if (isCorpus) {
        corpusMisses.push({
          phrase: entry.phrase,
          fingerprint: entry.fingerprint ?? [],
          reason: `syllable count ${entry.syllables} ≠ input ${syllables}`,
        });
      }
      continue;
    }
    if (!entry.fingerprint?.length) continue;

    const scored = scoreEntry(entry.fingerprint, fingerprint);
    if (!scored) continue;
    const [score, tier] = scored;
    if (score === 0) continue;

    const finalScore = applyCorpusBonus(score, tier, isCorpus);

    if (isCorpus && tier >= 3) {
      corpusMisses.push({
        phrase: entry.phrase,
        fingerprint: entry.fingerprint,
        reason: `tier ${tier} — entry fp [${entry.fingerprint.join(",")}] vs input [${fingerprint.join(",")}]`,
      });
    }

    results.push({
      phrase: entry.phrase,
      tier,
      score: finalScore,
      corpus: isCorpus,
    });
  }

  const tierCounts: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0 };
  for (const r of results) tierCounts[r.tier] = (tierCounts[r.tier] ?? 0) + 1;

  results.sort((a, b) => b.score - a.score || a.phrase.localeCompare(b.phrase));

  // ── Multi-word combinations ────────────────────────────────────────────
  const comboIndex = getComboIndex();
  if (syllables >= 2 && comboIndex.by_syl && Object.keys(comboIndex.by_syl).length > 0) {
    const existingPhrases = new Set(results.map((r) => r.phrase.toLowerCase()));
    const comboResults = generateCombos(fingerprint, comboIndex, existingPhrases, count);
    results.push(...comboResults);
    results.sort((a, b) => b.score - a.score || a.phrase.localeCompare(b.phrase));
  }

  // ── Deduplication ────────────────────────────────────────────────────────
  // 1. Exact duplicates: same phrase from both corpus + wordlist (case-insensitive).
  //    Results are sorted by score desc, so the higher-scoring copy comes first
  //    and the lower-scoring duplicate is silently dropped.
  // 2. Plural duplicates: single-word results ending in -s/-es/-ers are dropped
  //    when their singular already appears in the list.
  const seenPhrases = new Set<string>();
  const deduped: RhymeResult[] = [];
  let dedupDropped = 0;
  for (const r of results) {
    const lower = r.phrase.toLowerCase();

    // Exact-match dedup (handles "Dinosaur" corpus + "dinosaur" wordlist)
    if (seenPhrases.has(lower)) { dedupDropped++; continue; }

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
      if (isSuperfluous) { dedupDropped++; continue; }
    }
    seenPhrases.add(lower);
    deduped.push(r);
  }

  const trimmed = deduped.slice(0, count);

  const debug: MatchDebug = {
    inputPhrase: phrase,
    resolvedPhonemes: allPhonemes,
    fingerprint,
    syllables,
    totalEntriesChecked: totalChecked,
    corpusChecked,
    corpusMisses,
    tierCounts,
    dedupDropped,
  };

  return {
    results: trimmed,
    pattern: patternStr,
    syllables,
    warnings,
    count: trimmed.length,
    debug,
  };
}
