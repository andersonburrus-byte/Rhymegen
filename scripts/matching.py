"""
matching.py — Core phonetic matching engine.
Called at runtime by the API route via python-shell.
Does NOT import NLTK or pronouncing — reads JSON files directly.

Usage:
  python scripts/matching.py '{"phrase": "hit your front door", "count": 50}'
"""

import json
import os
import re
import sys

# ── Tunable constants ──────────────────────────────────────────────────────────
TIER2_THRESHOLD = 0.6   # Interior vowel match ratio required for Tier 2
TIER_BASE = {1: 100, 2: 70, 3: 40, 4: 20}
INTERIOR_BONUS_PER_MATCH = 8   # Applied only for Tier 2 and 3
CORPUS_BONUS = 25              # Added only to corpus entries; never crosses tier boundary
# ──────────────────────────────────────────────────────────────────────────────

VOWELS = {"IH", "UH", "AH", "EH", "ER", "IY", "EY", "AY", "OW", "UW", "AO", "AA", "AW", "OY"}
PHONEME_NORM = {"AE": "EH"}


def extract_fingerprint(phonemes):
    fingerprint = []
    i = 0
    while i < len(phonemes):
        p = PHONEME_NORM.get(phonemes[i], phonemes[i])
        if p in ("AO", "AA") and i + 1 < len(phonemes) and PHONEME_NORM.get(phonemes[i + 1], phonemes[i + 1]) == "R":
            fingerprint.append(p + " R")  # "AO R" or "AA R"
            i += 2
        elif p in VOWELS:
            fingerprint.append(p)
            i += 1
        else:
            i += 1
    return fingerprint


def lookup_word(word, lookup):
    """Return phoneme list for word, or None if unrecognized."""
    # 1. Direct lookup
    if word in lookup:
        return lookup[word]

    # 2. Suffix stripping
    for suffix in ['ing', 'ed', 'er', 's']:
        if word.endswith(suffix) and len(word) > len(suffix):
            stem = word[:-len(suffix)]
            if stem in lookup:
                return lookup[stem]

    return None


def score_entry(entry_fp, input_fp):
    """
    Returns (score, tier) for an entry fingerprint vs. input fingerprint.
    Both must have the same length (pre-filtered by syllable count).
    Returns (0, None) if fingerprints don't satisfy matching criteria beyond Tier 4.
    """
    if len(entry_fp) != len(input_fp):
        return 0, None

    final_input = input_fp[-1]
    final_entry = entry_fp[-1]

    # R-coloured vowel boundary rule: "AO R", "AA R" must not mix with their bare forms
    R_VOWELS = {"AO R", "AA R"}
    bare_input = final_input.replace(" R", "")
    bare_entry = final_entry.replace(" R", "")
    if (final_input in R_VOWELS) != (final_entry in R_VOWELS) and bare_input == bare_entry:
        tier = 4
    elif final_entry != final_input:
        # Final phoneme doesn't match — Tier 4
        tier = 4
    else:
        # Final phoneme matches — evaluate interior
        total_interior = len(input_fp) - 1
        if total_interior == 0:
            # Single-syllable fingerprint: final is the only vowel, already matched
            tier = 1
            interior_matches = 0
        else:
            interior_matches = sum(
                1 for i in range(total_interior)
                if entry_fp[i] == input_fp[i]
            )
            ratio = interior_matches / total_interior
            if interior_matches == total_interior:
                tier = 1
            elif ratio >= TIER2_THRESHOLD:
                tier = 2
            else:
                tier = 3

    base = TIER_BASE[tier]
    interior_matches_for_bonus = (
        sum(1 for i in range(len(input_fp) - 1) if entry_fp[i] == input_fp[i])
        if tier in (2, 3) else 0
    )
    interior_bonus = interior_matches_for_bonus * INTERIOR_BONUS_PER_MATCH

    return base + interior_bonus, tier


def apply_corpus_bonus(score, tier, is_corpus):
    """Add corpus bonus, capped so it never crosses tier boundary."""
    if not is_corpus:
        return score
    tier_floors = {1: 100, 2: 70, 3: 40, 4: 20}
    next_tier_floor = tier_floors.get(tier - 1, 999)  # floor of the tier above
    return min(score + CORPUS_BONUS, next_tier_floor - 1)


# ── Multi-word combination constants ─────────────────────────────────────────
MAX_COMBO_RESULTS = 200      # Max multi-word results to generate
MAX_PREFIX_SCAN = 2000       # Max prefix candidates to score per split
COMBO_TIEBREAK_PENALTY = 1   # Score penalty so single words rank above combos at same tier
# ─────────────────────────────────────────────────────────────────────────────


def generate_combos(input_fp, combo_index, existing_phrases, count):
    """
    Generate 2-word and 3-word combinations matching the input fingerprint.
    Returns list of result dicts compatible with single-word results.

    Args:
        input_fp: target fingerprint list, e.g. ['AA', 'IY', 'ER', 'AW']
        combo_index: loaded combo_index.json dict with 'by_syl' and 'by_final' keys
        existing_phrases: set of lowercase phrases already in results (for dedup)
        count: max results desired
    """
    n = len(input_fp)
    if n < 2:
        return []  # need at least 2 syllables for a combo

    target_final = input_fp[-1]
    by_syl = combo_index.get("by_syl", {})
    by_final = combo_index.get("by_final", {})

    combos = []
    seen_phrases = set()

    # ── 2-word combos ────────────────────────────────────────────────────────
    for split in range(1, n):
        prefix_syl = split
        suffix_syl = n - split

        # Get suffix candidates: must end with target's final phoneme
        suffix_entries = by_final.get(target_final, {}).get(str(suffix_syl), [])
        if not suffix_entries:
            continue

        # Get prefix candidates: any word with the right syllable count
        prefix_entries = by_syl.get(str(prefix_syl), [])
        if not prefix_entries:
            continue

        # Limit prefix scan for performance
        scan_prefixes = prefix_entries[:MAX_PREFIX_SCAN]

        for suffix in suffix_entries:
            suffix_fp = suffix["fp"]
            for prefix in scan_prefixes:
                prefix_fp = prefix["fp"]

                # Build combined fingerprint and score it
                combined_fp = prefix_fp + suffix_fp
                score, tier = score_entry(combined_fp, input_fp)
                if score == 0 or tier is None or tier > 3:
                    continue  # skip Tier 4 combos

                # Build phrase
                phrase = prefix["w"] + " " + suffix["w"]
                phrase_lower = phrase.lower()
                if phrase_lower in seen_phrases or phrase_lower in existing_phrases:
                    continue
                seen_phrases.add(phrase_lower)

                # Apply tiebreak penalty so single words rank first at same score
                final_score = score - COMBO_TIEBREAK_PENALTY

                combos.append({
                    "phrase": phrase,
                    "tier": tier,
                    "score": final_score,
                    "corpus": False,
                })

    # ── 3-word combos ────────────────────────────────────────────────────────
    for s1 in range(1, n - 1):
        for s2 in range(s1 + 1, n):
            syl1 = s1
            syl2 = s2 - s1
            syl3 = n - s2

            # Last word must end with target final phoneme
            w3_entries = by_final.get(target_final, {}).get(str(syl3), [])
            if not w3_entries:
                continue

            w1_entries = by_syl.get(str(syl1), [])
            w2_entries = by_syl.get(str(syl2), [])
            if not w1_entries or not w2_entries:
                continue

            # Limit scan: cap middle and prefix words
            scan_w1 = w1_entries[:500]
            scan_w2 = w2_entries[:500]

            for w3 in w3_entries:
                w3_fp = w3["fp"]
                for w2 in scan_w2:
                    w2_fp = w2["fp"]
                    for w1 in scan_w1:
                        w1_fp = w1["fp"]

                        combined_fp = w1_fp + w2_fp + w3_fp
                        score, tier = score_entry(combined_fp, input_fp)
                        if score == 0 or tier is None or tier > 3:
                            continue

                        phrase = w1["w"] + " " + w2["w"] + " " + w3["w"]
                        phrase_lower = phrase.lower()
                        if phrase_lower in seen_phrases or phrase_lower in existing_phrases:
                            continue
                        seen_phrases.add(phrase_lower)

                        final_score = score - COMBO_TIEBREAK_PENALTY

                        combos.append({
                            "phrase": phrase,
                            "tier": tier,
                            "score": final_score,
                            "corpus": False,
                        })

                        if len(combos) >= MAX_COMBO_RESULTS:
                            break
                    if len(combos) >= MAX_COMBO_RESULTS:
                        break
                if len(combos) >= MAX_COMBO_RESULTS:
                    break
            if len(combos) >= MAX_COMBO_RESULTS:
                break
        if len(combos) >= MAX_COMBO_RESULTS:
            break

    # Sort combos by score descending, then alphabetical
    combos.sort(key=lambda x: (-x["score"], x["phrase"]))
    return combos[:min(count, MAX_COMBO_RESULTS)]


def main():
    try:
        if len(sys.argv) < 2:
            raise ValueError("No input argument provided")

        args = json.loads(sys.argv[1])
        phrase = args.get("phrase", "")
        count = int(args.get("count", 50))
        count = max(1, min(200, count))

        # ── Load data files ────────────────────────────────────────────────────
        base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        data_dir = os.path.join(base_dir, 'data')

        with open(os.path.join(data_dir, 'wordlist.json')) as f:
            wordlist = json.load(f)
        with open(os.path.join(data_dir, 'corpus.json')) as f:
            corpus = json.load(f)
        with open(os.path.join(data_dir, 'phoneme_lookup.json')) as f:
            phoneme_lookup = json.load(f)

        combo_index_path = os.path.join(data_dir, 'combo_index.json')
        combo_index = {}
        if os.path.exists(combo_index_path):
            with open(combo_index_path) as f:
                combo_index = json.load(f)

        all_entries = corpus + wordlist

        # ── Phrase → phonemes ──────────────────────────────────────────────────
        words = phrase.lower().strip().split()
        all_phonemes = []
        warnings = []

        for raw_word in words:
            word = re.sub(r"[^a-z']", '', raw_word)
            if not word:
                continue
            phonemes = lookup_word(word, phoneme_lookup)
            if phonemes:
                all_phonemes.extend(phonemes)
            else:
                warnings.append(f"'{raw_word}' not recognized — matched on remaining words")

        # All words failed
        if not all_phonemes:
            print(json.dumps({
                "results": [],
                "pattern": None,
                "syllables": None,
                "error": "unrecognized_input",
                "message": (
                    "None of these words were recognized. Try entering just the key "
                    "rhyming syllables (e.g., 'door' instead of 'hit your front door')."
                )
            }))
            return

        # ── Fingerprint ────────────────────────────────────────────────────────
        fingerprint = extract_fingerprint(all_phonemes)
        syllables = len(fingerprint)
        pattern_str = " · ".join(fingerprint)

        if syllables == 0:
            print(json.dumps({
                "results": [],
                "pattern": None,
                "syllables": 0,
                "error": "no_vowels",
                "message": "Could not identify any vowel sounds in that phrase."
            }))
            return

        # ── Match & score ──────────────────────────────────────────────────────
        results = []
        for entry in all_entries:
            if entry.get("syllables") != syllables:
                continue
            entry_fp = entry.get("fingerprint", [])
            if not entry_fp:
                continue

            score, tier = score_entry(entry_fp, fingerprint)
            if score == 0 or tier is None:
                continue

            is_corpus = entry.get("source") == "corpus"
            final_score = apply_corpus_bonus(score, tier, is_corpus)

            results.append({
                "phrase": entry["phrase"],
                "tier": tier,
                "score": final_score,
                "corpus": is_corpus
            })

        # Sort: score descending, then alphabetical ascending for ties
        results.sort(key=lambda x: (-x["score"], x["phrase"]))

        # ── Multi-word combinations ──────────────────────────────────────────
        if combo_index and syllables >= 2:
            existing_phrases = {r["phrase"].lower() for r in results}
            combo_results = generate_combos(fingerprint, combo_index, existing_phrases, count)
            results.extend(combo_results)
            # Re-sort with combos mixed in
            results.sort(key=lambda x: (-x["score"], x["phrase"]))

        results = results[:count]

        output = {
            "results": results,
            "pattern": pattern_str,
            "syllables": syllables,
            "warnings": warnings,
            "count": len(results)
        }
        print(json.dumps(output))

    except Exception as e:
        print(json.dumps({
            "results": [],
            "error": "parse_error",
            "message": "Something went wrong analyzing that phrase. Please try again."
        }))
        sys.exit(0)


if __name__ == "__main__":
    main()
