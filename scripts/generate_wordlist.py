"""
generate_wordlist.py
Run once locally: python scripts/generate_wordlist.py
Outputs:
  data/wordlist.json       — multisyllabic words with phonemes + fingerprint
  data/phoneme_lookup.json — flat word→phonemes dict (used by matching.py at runtime)
"""

import nltk
import json
import os
import re

# Ensure cmudict is available
nltk.download('cmudict', quiet=True)

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(BASE_DIR, 'data')
os.makedirs(DATA_DIR, exist_ok=True)

VOWELS = {"IH", "UH", "AH", "EH", "ER", "IY", "EY", "AY", "OW", "UW", "AO", "AA", "AW", "OY"}


def extract_fingerprint(phonemes):
    fingerprint = []
    i = 0
    while i < len(phonemes):
        p = phonemes[i]
        if p in ("AO", "AA") and i + 1 < len(phonemes) and phonemes[i + 1] == "R":
            fingerprint.append(p + " R")  # "AO R" or "AA R"
            i += 2
        elif p in VOWELS:
            fingerprint.append(p)
            i += 1
        else:
            i += 1
    return fingerprint


entries = nltk.corpus.cmudict.entries()  # list of (word, phonemes)

seen = set()
wordlist = []
phoneme_lookup = {}

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

    wordlist.append({
        "phrase": word,
        "phonemes": clean,
        "fingerprint": fp,
        "syllables": len(fp),
        "source": "wordlist"
    })
    phoneme_lookup[word] = clean

# Write wordlist.json
wordlist_path = os.path.join(DATA_DIR, 'wordlist.json')
with open(wordlist_path, 'w') as f:
    json.dump(wordlist, f)

# Write phoneme_lookup.json (all words including single-syllable, for runtime lookup)
# Re-scan to include single-syllable words so matching.py can resolve every word in a phrase
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

print(f"Generated {len(wordlist)} wordlist entries (multisyllabic only)")
print(f"Generated {len(phoneme_lookup_full)} phoneme lookup entries (all words)")
print(f"Output: {wordlist_path}")
print(f"Output: {lookup_path}")
