"""
convert_expanded_corpus.py
Converts corpus_expanded.json (phrase + pattern notation) to corpus.json (ARPABET).
Run: python scripts/convert_expanded_corpus.py

The pattern field uses shorthand notation:
  A=EY, E=IY, I=AY, O=OW, U=UW, UH=AH, OH=AA, OOH=UH, OW=AW, OI=OY,
  AR=AA R, OR=AO R, ER=ER, EH=EH, IH=IH, AIR=EH R (approx)
  EAR=IH R (approx)

Falls back to phoneme_lookup.json for phrase resolution (same as preprocess.py).
"""

import json
import os
import re
import shutil
import datetime

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(BASE_DIR, 'data')
ARCHIVE_DIR = os.path.join(DATA_DIR, 'archive')
os.makedirs(ARCHIVE_DIR, exist_ok=True)

VOWELS = {"IH", "UH", "AH", "EH", "ER", "IY", "EY", "AY", "OW", "UW", "AO", "AA", "AW", "OY"}

# Map CMU phonemes that are variants of our VOWELS to their canonical form
# AE ("cat") → AH is the closest in our 2-tier system for short-a words
PHONEME_MAP = {"AE": "AH"}

# Manual overrides for compound words / proper nouns not in CMU dict
MANUAL_PHONEMES = {
    "koi":      ["K", "OY"],
    "hoi":      ["HH", "OY"],
    "jfk":      ["JH", "EY", "EH", "F", "K", "EY"],
    "cred":     ["K", "R", "EH", "D"],
    "bap":      ["B", "AE", "P"],
    "outkast":  ["AW", "T", "K", "AE", "S", "T"],
    "cutie":    ["K", "Y", "UW", "T", "IY"],
    "asap":     ["EY", "EH", "S", "EY", "P", "IY"],
    "nato":     ["N", "EY", "T", "OW"],
    "ipod":     ["AY", "P", "AA", "D"],
    "facetime": ["F", "EY", "S", "T", "AY", "M"],
    "ulator":   ["Y", "UW", "L", "EY", "T", "ER"],
    "venicular": ["V", "EH", "N", "IH", "K", "Y", "UW", "L", "ER"],
    "flapjack":  ["F", "L", "AE", "P", "JH", "AE", "K"],
    "knapsack":  ["N", "AE", "P", "S", "AE", "K"],
    "flashback": ["F", "L", "AE", "SH", "B", "AE", "K"],
    "rattrap":   ["R", "AE", "T", "R", "AE", "P"],
}


def extract_fingerprint(phonemes):
    fingerprint = []
    i = 0
    while i < len(phonemes):
        p = phonemes[i]
        # Normalise variants first
        p_norm = PHONEME_MAP.get(p, p)
        if p_norm in ("AO", "AA") and i + 1 < len(phonemes) and phonemes[i + 1] == "R":
            fingerprint.append(p_norm + " R")
            i += 2
        elif p_norm in VOWELS:
            fingerprint.append(p_norm)
            i += 1
        else:
            i += 1
    return fingerprint


def split_compound(word, lookup, memo=None):
    """Recursively try to split word into known sub-words."""
    if memo is None:
        memo = {}
    if word in memo:
        return memo[word]
    if word in lookup:
        memo[word] = lookup[word]
        return lookup[word]
    # Try all split points (min 2 chars each side)
    for i in range(2, len(word) - 1):
        left = word[:i]
        right = word[i:]
        if left in lookup:
            right_ph = split_compound(right, lookup, memo)
            if right_ph is not None:
                result = lookup[left] + right_ph
                memo[word] = result
                return result
    memo[word] = None
    return None


def phrase_to_phonemes(phrase, lookup):
    words = phrase.lower().strip().split()
    all_phonemes = []
    for raw_word in words:
        word = re.sub(r"[^a-z']", '', raw_word)
        if not word:
            continue

        # Manual override first
        if word in MANUAL_PHONEMES:
            all_phonemes.extend(MANUAL_PHONEMES[word])
            continue

        # Direct lookup
        if word in lookup:
            all_phonemes.extend(lookup[word])
            continue

        # Suffix stripping
        found = False
        for suffix in ['ing', 'ed', 'er', 'ers', 's', 'ly']:
            if word.endswith(suffix) and len(word) > len(suffix) + 1:
                stem = word[:-len(suffix)]
                if stem in lookup:
                    all_phonemes.extend(lookup[stem])
                    found = True
                    break
        if found:
            continue

        # Compound word splitting
        ph = split_compound(word, lookup)
        if ph is not None:
            all_phonemes.extend(ph)
            continue

        return None  # Unrecognized word

    return all_phonemes if all_phonemes else None


def load_phoneme_lookup():
    path = os.path.join(DATA_DIR, 'phoneme_lookup.json')
    if not os.path.exists(path):
        raise FileNotFoundError("phoneme_lookup.json not found. Run generate_wordlist.py first.")
    with open(path) as f:
        return json.load(f)


def main():
    print("Loading phoneme_lookup.json...")
    lookup = load_phoneme_lookup()
    print(f"  {len(lookup)} entries loaded")

    # Load corpus_expanded.json
    expanded_path = os.path.join(DATA_DIR, 'corpus_expanded.json')
    if not os.path.exists(expanded_path):
        print(f"ERROR: {expanded_path} not found.")
        return

    with open(expanded_path) as f:
        expanded = json.load(f)
    print(f"\nLoaded {len(expanded)} entries from corpus_expanded.json")

    # Archive previous corpus.json
    corpus_out_path = os.path.join(DATA_DIR, 'corpus.json')
    if os.path.exists(corpus_out_path):
        ts = datetime.datetime.now().strftime('%Y%m%d_%H%M%S')
        archive_path = os.path.join(ARCHIVE_DIR, f"corpus_{ts}.json")
        shutil.copy(corpus_out_path, archive_path)
        print(f"Archived previous corpus.json to {archive_path}")

    corpus = []
    skipped = []

    for entry in expanded:
        phrase = entry.get("phrase", "").strip()
        if not phrase:
            continue

        phonemes = phrase_to_phonemes(phrase, lookup)
        if phonemes is None:
            skipped.append(phrase)
            continue

        # Normalise variant phonemes (AE → AH etc.) so matcher.ts sees consistent symbols
        phonemes = [PHONEME_MAP.get(p, p) for p in phonemes]

        fp = extract_fingerprint(phonemes)
        if len(fp) < 1:
            skipped.append(phrase)
            continue

        corpus.append({
            "phrase": phrase,
            "phonemes": phonemes,
            "fingerprint": fp,
            "syllables": len(fp),
            "source": "corpus"
        })

    # Write corpus.json
    with open(corpus_out_path, 'w') as f:
        json.dump(corpus, f, indent=2)

    print(f"\n✓ corpus.json generated: {len(corpus)} entries")
    print(f"  Skipped (unrecognized): {len(skipped)} entries")

    if skipped:
        print(f"\n--- Skipped entries ---")
        for s in skipped:
            print(f"  {s}")

    print(f"\nOutput: {corpus_out_path}")


if __name__ == "__main__":
    main()
