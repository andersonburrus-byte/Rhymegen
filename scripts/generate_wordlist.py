"""
generate_wordlist.py
Run once locally: python scripts/generate_wordlist.py
Outputs:
  data/wordlist.json       — multisyllabic words with phonemes + fingerprint
  data/phoneme_lookup.json — flat word→phonemes dict (used by matching.py at runtime)
  data/combo_index.json    — words indexed by syllable count & final phoneme (for multi-word combos)

Proper noun filtering:
  Uses wordfreq English frequency scores to exclude surnames and obscure proper nouns.
  Words below MIN_WORD_FREQ are dropped from the WORDLIST (they stay in phoneme_lookup
  so they can still be used to resolve phrases the user types in).
"""

import nltk
import json
import os
import re

# wordfreq must be installed: pip install wordfreq
try:
    from wordfreq import word_frequency
    HAS_WORDFREQ = True
except ImportError:
    HAS_WORDFREQ = False
    print("WARNING: wordfreq not installed. Run: pip install wordfreq")
    print("  Continuing without frequency filtering — proper nouns will not be removed.")

# Ensure NLTK data is available
nltk.download('cmudict', quiet=True)
nltk.download('names', quiet=True)

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(BASE_DIR, 'data')
os.makedirs(DATA_DIR, exist_ok=True)

VOWELS = {"IH", "UH", "AH", "EH", "ER", "IY", "EY", "AY", "OW", "UW", "AO", "AA", "AW", "OY"}

# AE ("cat", "carry") → EH groups short front vowels so "carry"/"scary"/"harry"
# all land in the same fingerprint bucket.
PHONEME_NORM = {"AE": "EH"}

# ── Proper noun filter settings ───────────────────────────────────────────────
# Minimum wordfreq English frequency to appear in wordlist results.
# wordfreq scores range from ~1e-9 (extremely rare) to ~0.07 (most common words).
# 1e-6 keeps: "hurricane", "bicycle", "envelope" — drops: "shumaker", "nunemaker"
MIN_WORD_FREQ = 1e-6

# Surname-heavy suffixes — words matching these AND below freq threshold get extra scrutiny
SURNAME_SUFFIXES = re.compile(
    r'(berg|stein|mann|feld|baum|haus|maker|wick|worth|burg|ford|son|ton|'
    r'ley|ner|ger|owski|ewski|ski|icz|wicz|kov|ova|ian|yan|'
    r'aaberg|enberg|enberg)$'
)

# Build NLTK first-name set for additional filtering
from nltk.corpus import names as nltk_names
FIRST_NAMES = set(n.lower() for n in nltk_names.words())
# ─────────────────────────────────────────────────────────────────────────────


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


def is_useful_word(word):
    """
    Return True if the word should appear in rhyme results.
    Filters out surnames, obscure proper nouns, and junk entries.
    """
    # Skip possessives and contractions in results (they're fine in phoneme_lookup)
    if "'" in word:
        return False

    # Skip words with non-alpha characters
    if not re.match(r'^[a-z]+$', word):
        return False

    # Very short words are single-syllable candidates — already filtered by fp length
    # but double-check
    if len(word) < 3:
        return False

    if not HAS_WORDFREQ:
        return True

    freq = word_frequency(word, 'en')

    # Hard drop: frequency below threshold — almost certainly a surname or proper noun
    if freq < MIN_WORD_FREQ:
        return False

    # Borderline zone (1e-6 to 5e-6): apply surname suffix heuristic as extra check
    if freq < 5e-6 and SURNAME_SUFFIXES.search(word):
        return False

    # NLTK first-names list: only drop if also low frequency
    # (don't drop "martin", "dean", "warren" — they're real words too)
    if word in FIRST_NAMES and freq < 2e-6:
        return False

    return True


entries = nltk.corpus.cmudict.entries()  # list of (word, phonemes)

seen = set()
wordlist = []
phoneme_lookup = {}
filtered_count = 0

for word, phonemes in entries:
    # Skip duplicate pronunciations — keep first (most common)
    if word in seen:
        continue
    seen.add(word)

    # Skip words with digits or non-alpha characters (except apostrophes for contractions)
    if not re.match(r"^[a-z']+$", word):
        continue

    # Strip stress numbers from phonemes (IH0 → IH, AO1 → AO, etc.)
    clean = [p.rstrip('012') for p in phonemes]

    fp = extract_fingerprint(clean)

    # Only keep multisyllabic words (2+ vowel nuclei)
    if len(fp) < 2:
        continue

    # Always add to phoneme_lookup (used to resolve user's input phrases)
    phoneme_lookup[word] = clean

    # Apply proper noun filter before adding to wordlist (search results)
    if not is_useful_word(word):
        filtered_count += 1
        continue

    freq = word_frequency(word, 'en') if HAS_WORDFREQ else 0.0
    wordlist.append({
        "phrase": word,
        "phonemes": clean,
        "fingerprint": fp,
        "syllables": len(fp),
        "source": "wordlist",
        "freq": freq,
    })

# Write wordlist.json
wordlist_path = os.path.join(DATA_DIR, 'wordlist.json')
with open(wordlist_path, 'w') as f:
    json.dump(wordlist, f)

# Write phoneme_lookup.json — includes ALL words (even filtered ones) so
# matching.py can resolve any word the user types, including names
phoneme_lookup_full = {}
seen2 = set()
for word, phonemes in nltk.corpus.cmudict.entries():
    if word in seen2:
        continue
    seen2.add(word)
    if not re.match(r"^[a-z']+$", word):
        continue
    clean = [p.rstrip('012') for p in phonemes]
    phoneme_lookup_full[word] = clean

lookup_path = os.path.join(DATA_DIR, 'phoneme_lookup.json')
with open(lookup_path, 'w') as f:
    json.dump(phoneme_lookup_full, f)

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
        continue  # no vowels

    syl = len(fp)
    if syl > 5:
        continue  # skip very long words

    # Word frequency filter: skip rare words from combo results
    if HAS_WORDFREQ:
        freq = word_frequency(word, 'en')
        if freq < 1e-6:
            continue
    else:
        freq = 0.0

    entry = {"w": word, "fp": fp, "f": round(freq, 8)}

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

# Sort each bucket by frequency descending so highest-freq words are scanned first
for syl_key in by_syl:
    by_syl[syl_key].sort(key=lambda e: e.get("f", 0), reverse=True)
for final_key in by_final:
    for syl_key in by_final[final_key]:
        by_final[final_key][syl_key].sort(key=lambda e: e.get("f", 0), reverse=True)

combo_index = {"by_syl": by_syl, "by_final": by_final}
combo_path = os.path.join(DATA_DIR, 'combo_index.json')
with open(combo_path, 'w') as f:
    json.dump(combo_index, f, separators=(',', ':'))

combo_size_mb = os.path.getsize(combo_path) / 1024 / 1024
print(f"Generated combo index: {combo_word_count} words ({combo_size_mb:.1f} MB)")
for syl_key in sorted(by_syl.keys(), key=int):
    print(f"  {syl_key}-syllable: {len(by_syl[syl_key])} words")
print(f"Output: {combo_path}")

print(f"\nGenerated {len(wordlist)} wordlist entries (multisyllabic, filtered)")
print(f"  Filtered out: {filtered_count} proper nouns / obscure words")
print(f"Generated {len(phoneme_lookup_full)} phoneme lookup entries (all words)")
print(f"Output: {wordlist_path}")
print(f"Output: {lookup_path}")
