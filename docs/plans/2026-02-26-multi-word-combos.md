# Multi-Word Phrase Combination — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add runtime 2-word and 3-word phrase generation to matching.py so phonemes underserved by single-word matches (AW, OY, etc.) get high-quality results.

**Architecture:** A new `combo_index.json` file (generated at preprocessing time) indexes all words including single-syllable by syllable count and final phoneme. At runtime, `matching.py` loads this index, splits the target fingerprint at every possible boundary, finds words that fill each piece, scores concatenated fingerprints using the existing `score_entry()`, and merges multi-word results into the main ranked list.

**Tech Stack:** Python 3.11 (matching engine), wordfreq (quality filtering), existing JSON data pipeline.

**Design doc:** `docs/plans/2026-02-26-multi-word-combos-design.md`

---

## Important Context

- **No test framework exists.** Tests are standalone Python scripts run directly.
- **Project root:** `/Volumes/Work Disk/2026/RhymeGen Software/rhymegen`
- **`generate_pairs.py` exists but is superseded** by this approach. It only combined 2+ syllable words and missed single-syllable rhyme anchors. Do NOT use or modify it.
- **PHONEME_NORM inconsistency:** `generate_wordlist.py` maps `AE→EH`. `matching.py` has no PHONEME_NORM at all, so AE vowels are silently dropped from input fingerprints. Must fix.
- **Key constants** shared across files:
  - `VOWELS = {"IH","UH","AH","EH","ER","IY","EY","AY","OW","UW","AO","AA","AW","OY"}`
  - `PHONEME_NORM = {"AE": "EH"}`
- **Existing scoring functions** `score_entry()` and `apply_corpus_bonus()` in `matching.py` are reused as-is.

---

### Task 1: Fix PHONEME_NORM in matching.py

**Files:**
- Modify: `scripts/matching.py`

**Why:** `matching.py` doesn't normalize AE→EH. When a user types a word with the AE sound (e.g., "cat"), that syllable is dropped from the fingerprint because AE isn't in VOWELS. The wordlist fingerprints already have AE normalized to EH (done by `generate_wordlist.py`), so input fingerprints must match.

**Step 1: Add PHONEME_NORM constant**

In `scripts/matching.py`, after the VOWELS line (line 22), add:

```python
PHONEME_NORM = {"AE": "EH"}
```

**Step 2: Update extract_fingerprint to use PHONEME_NORM**

Replace the current `extract_fingerprint` function (lines 25-38) with:

```python
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
```

**Step 3: Verify the fix**

Run:
```bash
cd /Volumes/Work\ Disk/2026/RhymeGen\ Software/rhymegen
python3 -c "
import json, sys
sys.path.insert(0, 'scripts')
# Inline test: 'black cat' should have 2 syllables after normalization
VOWELS = {'IH','UH','AH','EH','ER','IY','EY','AY','OW','UW','AO','AA','AW','OY'}
PHONEME_NORM = {'AE': 'EH'}
def extract_fingerprint(phonemes):
    fp = []
    i = 0
    while i < len(phonemes):
        p = PHONEME_NORM.get(phonemes[i], phonemes[i])
        if p in ('AO','AA') and i+1<len(phonemes) and PHONEME_NORM.get(phonemes[i+1],phonemes[i+1])=='R':
            fp.append(p+' R'); i+=2
        elif p in VOWELS:
            fp.append(p); i+=1
        else:
            i+=1
    return fp
with open('data/phoneme_lookup.json') as f:
    lookup = json.load(f)
# Test words with AE
for word in ['cat','black','happy','carry','back']:
    ph = lookup.get(word,[])
    fp = extract_fingerprint(ph)
    print(f'{word}: phonemes={ph} -> fingerprint={fp} ({len(fp)} syl)')
"
```

Expected: Each word shows a fingerprint with EH where AE would be. "cat" → `['EH']` (1 syl), "happy" → `['EH', 'IY']` (2 syl).

**Step 4: Verify existing behavior unchanged**

Run:
```bash
python3 scripts/matching.py '{"phrase": "hit your front door", "count": 5}'
```

Expected: Results with Tier 1/2 matches, same as before (AE normalization doesn't affect this phrase).

**Step 5: Commit**

```bash
git add scripts/matching.py
git commit -m "fix: add PHONEME_NORM to matching.py so AE vowels aren't dropped from input fingerprints"
```

---

### Task 2: Add combo_index.json generation to generate_wordlist.py

**Files:**
- Modify: `scripts/generate_wordlist.py`

**What:** After generating `wordlist.json` and `phoneme_lookup.json`, also generate `data/combo_index.json` — all words (including single-syllable) indexed by syllable count and final phoneme.

**Step 1: Add combo index generation**

At the end of `scripts/generate_wordlist.py`, before the final print statements, add the following block. This builds the index from `phoneme_lookup_full` (which includes ALL words):

```python
# ── Generate combo_index.json ────────────────────────────────────────────────
# Index ALL words (including single-syllable) by syllable count and final phoneme
# for runtime multi-word combination in matching.py
print("\nGenerating combo index...")

by_syl = {}        # syl_count -> list of {w, fp}
by_final = {}      # final_phoneme -> syl_count -> list of {w, fp}

combo_word_count = 0

for word, phonemes in phoneme_lookup_full.items():
    # Skip words with apostrophes or non-alpha (keep clean words only)
    if not re.match(r'^[a-z]+$', word):
        continue

    fp = extract_fingerprint(phonemes)
    if len(fp) < 1:
        continue  # no vowels (rare edge case)

    syl = len(fp)
    if syl > 5:
        continue  # skip very long words — not useful for combinations

    # Word frequency filter: skip very rare words from combo results
    if HAS_WORDFREQ:
        freq = word_frequency(word, 'en')
        if freq < 1e-7:  # more permissive than wordlist filter — we want coverage
            continue
    else:
        freq = 0.0

    entry = {"w": word, "fp": fp}

    # Index by syllable count
    syl_key = str(syl)
    if syl_key not in by_syl:
        by_syl[syl_key] = []
    by_syl[syl_key].append(entry)

    # Index by final phoneme + syllable count
    final = fp[-1]
    if final not in by_final:
        by_final[final] = {}
    if syl_key not in by_final[final]:
        by_final[final][syl_key] = []
    by_final[final][syl_key].append(entry)

    combo_word_count += 1

combo_index = {"by_syl": by_syl, "by_final": by_final}
combo_path = os.path.join(DATA_DIR, 'combo_index.json')
with open(combo_path, 'w') as f:
    json.dump(combo_index, f, separators=(',', ':'))

combo_size_mb = os.path.getsize(combo_path) / 1024 / 1024
print(f"Generated combo index: {combo_word_count} words ({combo_size_mb:.1f} MB)")
for syl_key in sorted(by_syl.keys(), key=int):
    print(f"  {syl_key}-syllable: {len(by_syl[syl_key])} words")
print(f"Output: {combo_path}")
```

**Step 2: Run generate_wordlist.py**

```bash
cd /Volumes/Work\ Disk/2026/RhymeGen\ Software/rhymegen
python3 scripts/generate_wordlist.py
```

Expected output includes new lines showing combo index stats. Verify:
- `combo_index.json` exists in `data/`
- File size is ~3-8 MB
- 1-syllable count is ~5,000-15,000 words (after frequency filter)
- 2-5 syllable counts populated

**Step 3: Verify combo_index.json structure**

```bash
python3 -c "
import json
with open('data/combo_index.json') as f:
    idx = json.load(f)
print('Top-level keys:', list(idx.keys()))
print('by_syl keys:', sorted(idx['by_syl'].keys(), key=int))
print('by_final phonemes:', sorted(idx['by_final'].keys()))
print()
# Check AW coverage — the whole reason we're doing this
for syl in sorted(idx['by_final'].get('AW', {}).keys(), key=int):
    words = idx['by_final']['AW'][syl]
    print(f'AW, {syl}-syl: {len(words)} words — e.g. {[w[\"w\"] for w in words[:5]]}')
"
```

Expected: `by_final` includes `AW` with entries at syllable counts 1, 2, 3. Shows words like "down", "now", "round", "how" at 1-syllable.

**Step 4: Commit**

```bash
git add scripts/generate_wordlist.py data/combo_index.json
git commit -m "feat: generate combo_index.json for multi-word phrase combination"
```

---

### Task 3: Add generate_combos() to matching.py

**Files:**
- Modify: `scripts/matching.py`

**What:** Add a `generate_combos()` function that creates 2-word and 3-word combinations at runtime. This is the core new logic.

**Step 1: Add the combo generation function**

In `scripts/matching.py`, after the `apply_corpus_bonus()` function (after line 114), add:

```python
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
                    continue  # skip Tier 4 combos — single-word Tier 4 already covers those

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

                        # Early exit if we have enough
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
```

**Step 2: Verify the function parses without errors**

```bash
python3 -c "
import sys; sys.path.insert(0, 'scripts')
exec(open('scripts/matching.py').read().split('def main')[0])
print('generate_combos function loaded OK')
print('MAX_COMBO_RESULTS:', MAX_COMBO_RESULTS)
print('COMBO_TIEBREAK_PENALTY:', COMBO_TIEBREAK_PENALTY)
"
```

Expected: Prints constants without errors.

**Step 3: Commit**

```bash
git add scripts/matching.py
git commit -m "feat: add generate_combos() for runtime multi-word phrase generation"
```

---

### Task 4: Integrate combo results into matching.py main()

**Files:**
- Modify: `scripts/matching.py`

**What:** Load `combo_index.json` and call `generate_combos()` in the `main()` function. Merge combo results with single-word results.

**Step 1: Add combo_index.json loading**

In `scripts/matching.py`, inside `main()`, after the existing file loading block (after line 136 — the `phoneme_lookup` load), add:

```python
        combo_index_path = os.path.join(data_dir, 'combo_index.json')
        combo_index = {}
        if os.path.exists(combo_index_path):
            with open(combo_index_path) as f:
                combo_index = json.load(f)
```

**Step 2: Call generate_combos() and merge results**

In `main()`, after the single-word results sorting (after line 208 — the `results.sort(...)` line), before `results = results[:count]`, add:

```python
        # ── Multi-word combinations ──────────────────────────────────────────
        if combo_index and syllables >= 2:
            existing_phrases = {r["phrase"].lower() for r in results}
            combo_results = generate_combos(fingerprint, combo_index, existing_phrases, count)
            results.extend(combo_results)
            # Re-sort with combos mixed in
            results.sort(key=lambda x: (-x["score"], x["phrase"]))
```

**Step 3: Test end-to-end with "body verb now"**

```bash
python3 scripts/matching.py '{"phrase": "body verb now", "count": 20}' | python3 -m json.tool
```

Expected:
- Results now include 2-word and 3-word combinations
- Tier 1 and Tier 2 matches present (not all Tier 4)
- Phrases like "[word] down", "[word] now", "[word] round" appear
- Pattern still shows `AA · IY · ER · AW`

**Step 4: Test with a phrase that already works well (no regression)**

```bash
python3 scripts/matching.py '{"phrase": "hit your front door", "count": 10}' | python3 -m json.tool
```

Expected: Still returns good single-word Tier 1/2 results. Combo results mixed in but don't displace existing good matches.

**Step 5: Test edge cases**

```bash
# Single syllable — combos should not run (need >= 2 syllables)
python3 scripts/matching.py '{"phrase": "door", "count": 5}' | python3 -m json.tool

# 2-syllable — simplest combo case
python3 scripts/matching.py '{"phrase": "breakdown", "count": 10}' | python3 -m json.tool

# Phrase with unknown word — combos should still work on recognized portion
python3 scripts/matching.py '{"phrase": "woadie verb now", "count": 10}' | python3 -m json.tool
```

Expected:
- Single syllable: normal results, no combos
- 2-syllable: combos appear alongside single-word results
- Unknown word: warning shown, combos generated for recognized words

**Step 6: Commit**

```bash
git add scripts/matching.py
git commit -m "feat: integrate multi-word combos into matching engine results"
```

---

### Task 5: Performance validation

**Files:** None (testing only)

**Step 1: Time the engine with combos**

```bash
time python3 scripts/matching.py '{"phrase": "body verb now", "count": 50}'
```

Expected: Total time under 5 seconds. If over 5s, reduce `MAX_PREFIX_SCAN` or the 3-word scan caps in `generate_combos()`.

**Step 2: Time with a longer phrase (more syllables = more split points)**

```bash
time python3 scripts/matching.py '{"phrase": "hit your front door more", "count": 50}'
```

Expected: Under 5 seconds. 5-syllable targets have more split points but the cap limits prevent blowup.

**Step 3: If performance exceeds 5 seconds**

Reduce constants in matching.py:
- `MAX_PREFIX_SCAN`: reduce from 2000 to 1000
- 3-word scan caps: reduce from 500 to 200
- `MAX_COMBO_RESULTS`: reduce from 200 to 100

Re-run timing tests after each adjustment.

**Step 4: Commit (if tuning was needed)**

```bash
git add scripts/matching.py
git commit -m "perf: tune combo generation scan limits"
```

---

### Task 6: Deploy and verify on Vercel

**Step 1: Push to GitHub**

```bash
git push origin main
```

Vercel auto-deploys from GitHub. Wait for deployment to complete.

**Step 2: Test on live site**

Open https://rhymegen.vercel.app and search "body verb now". Verify:
- Multi-word results appear in the list
- Tier 1/2 matches present
- Response completes within Vercel's 10s timeout
- No errors in the UI

**Step 3: Test cold start**

Wait 5+ minutes, then search again. Verify the cold start + combo generation still completes within 10 seconds.

---

### Task 7: Clean up obsolete generate_pairs.py

**Files:**
- Delete: `scripts/generate_pairs.py`

**Why:** Superseded by combo_index.json + runtime generation. The old script only combined 2+ syllable words and missed single-syllable rhyme anchors.

**Step 1: Remove the file**

```bash
git rm scripts/generate_pairs.py
git commit -m "chore: remove generate_pairs.py, superseded by combo_index runtime generation"
```
