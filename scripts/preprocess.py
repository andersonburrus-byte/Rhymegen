"""
preprocess.py
Generates /data/corpus.json (ARPABET-tagged) from /data/corpus.txt or
from a source corpus with custom rhyme notation.

Run: python scripts/preprocess.py
Requires: phoneme_lookup.json to already exist (run generate_wordlist.py first).

corpus.txt format: one phrase per line, blank lines ignored, lines starting
with # are treated as comments/headers and skipped.
"""

import json
import os
import re
import shutil
import datetime
import random

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(BASE_DIR, 'data')
ARCHIVE_DIR = os.path.join(DATA_DIR, 'archive')
os.makedirs(ARCHIVE_DIR, exist_ok=True)

VOWELS = {"IH", "UH", "AH", "EH", "ER", "IY", "EY", "AY", "OW", "UW", "AO"}


def extract_fingerprint(phonemes):
    """Extract vowel fingerprint from phoneme sequence, combining AO+R."""
    fingerprint = []
    i = 0
    while i < len(phonemes):
        p = phonemes[i]
        if p == "AO" and i + 1 < len(phonemes) and phonemes[i + 1] == "R":
            fingerprint.append("AO R")
            i += 2
        elif p in VOWELS:
            fingerprint.append(p)
            i += 1
        else:
            i += 1
    return fingerprint


def phrase_to_phonemes(phrase, lookup):
    """Convert a multi-word phrase to phoneme sequence using lookup.
    Returns phoneme list or None if any word is unrecognized."""
    words = phrase.lower().strip().split()
    all_phonemes = []
    for raw_word in words:
        word = re.sub(r"[^a-z']", '', raw_word)
        if not word:
            continue

        # Direct lookup
        if word in lookup:
            all_phonemes.extend(lookup[word])
            continue

        # Suffix stripping
        found = False
        for suffix in ['ing', 'ed', 'er', 's']:
            if word.endswith(suffix) and len(word) > len(suffix):
                stem = word[:-len(suffix)]
                if stem in lookup:
                    all_phonemes.extend(lookup[stem])
                    found = True
                    break
        if not found:
            return None  # Word not recognized

    return all_phonemes if all_phonemes else None


def load_phoneme_lookup():
    path = os.path.join(DATA_DIR, 'phoneme_lookup.json')
    if not os.path.exists(path):
        raise FileNotFoundError(
            "phoneme_lookup.json not found. Run generate_wordlist.py first."
        )
    with open(path) as f:
        return json.load(f)


def parse_corpus_txt(raw):
    """Parse corpus.txt — one phrase per line, # lines and blanks skipped."""
    lines = raw.splitlines()
    phrases = []
    for line in lines:
        line = line.strip()
        if not line:
            continue
        if line.startswith('#'):
            continue
        # Skip lines that look like section headers (ALL CAPS, short)
        if line.isupper() and len(line.split()) <= 4:
            continue
        phrases.append(line)
    return phrases


def main():
    # ── Load lookup ─────────────────────────────────────────────────────────
    print("Loading phoneme_lookup.json...")
    phoneme_lookup = load_phoneme_lookup()
    print(f"  {len(phoneme_lookup)} entries loaded")

    # ── Archive previous corpus.json ─────────────────────────────────────────
    corpus_out_path = os.path.join(DATA_DIR, 'corpus.json')
    if os.path.exists(corpus_out_path):
        ts = datetime.datetime.now().strftime('%Y%m%d_%H%M%S')
        archive_path = os.path.join(ARCHIVE_DIR, f"corpus_{ts}.json")
        shutil.copy(corpus_out_path, archive_path)
        print(f"Archived previous corpus to {archive_path}")

    # ── Load corpus.txt ──────────────────────────────────────────────────────
    corpus_txt_path = os.path.join(DATA_DIR, 'corpus.txt')
    if not os.path.exists(corpus_txt_path):
        print(
            "\nWARNING: /data/corpus.txt not found.\n"
            "  Create corpus.txt with one rhyme phrase per line and re-run.\n"
            "  Generating empty corpus.json."
        )
        with open(corpus_out_path, 'w') as f:
            json.dump([], f, indent=2)
        return

    with open(corpus_txt_path, 'r', encoding='utf-8') as f:
        raw = f.read()

    raw_entries = parse_corpus_txt(raw)
    print(f"\nFound {len(raw_entries)} candidate phrases in corpus.txt")

    # ── Process each entry ───────────────────────────────────────────────────
    corpus = []
    skipped = []

    for phrase in raw_entries:
        phrase = phrase.strip()
        if not phrase:
            continue

        phonemes = phrase_to_phonemes(phrase, phoneme_lookup)
        if phonemes is None:
            skipped.append(phrase)
            continue

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

    # ── Write output ─────────────────────────────────────────────────────────
    with open(corpus_out_path, 'w') as f:
        json.dump(corpus, f, indent=2)

    # ── Validation output ────────────────────────────────────────────────────
    print(f"\n✓ Corpus generated: {len(corpus)} entries")
    print(f"  Skipped (unrecognized): {len(skipped)} entries")

    if corpus:
        print("\n--- 10 random sample entries ---")
        for entry in random.sample(corpus, min(10, len(corpus))):
            print(f"  {entry['phrase']}")
            print(f"    phonemes:    {' '.join(entry['phonemes'])}")
            print(f"    fingerprint: {entry['fingerprint']}")
            print(f"    syllables:   {entry['syllables']}")
            print()

    if skipped:
        print(f"--- First 10 skipped entries ---")
        for s in skipped[:10]:
            print(f"  {s}")
        print()
        print("Review skipped entries above. If too many are skipped, check corpus.txt format.")

    print(f"\nOutput written to: {corpus_out_path}")


if __name__ == "__main__":
    main()
