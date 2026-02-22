/**
 * reranker.ts — AI-powered usability reranking via Anthropic API.
 *
 * Takes the top N phonetic matches and asks claude-haiku-3-5 to score each
 * 0–10 for how recognisable and useful it would be in a rap/hip-hop context.
 * The AI score is blended with the phonetic score to produce a final ranking.
 *
 * Falls back gracefully to phonetic-only ranking if the API call fails or
 * ANTHROPIC_API_KEY is not set.
 */

import Anthropic from "@anthropic-ai/sdk";
import type { RhymeResult } from "./matcher";

// How many phonetic matches to send to the AI for reranking
export const RERANK_POOL = 50;

// Weight of AI score vs phonetic score in final sort (0–1)
// 0.4 = AI has meaningful influence but phonetics still dominate
const AI_WEIGHT = 0.4;
const PHONETIC_WEIGHT = 1 - AI_WEIGHT;

export interface RerankedResult extends RhymeResult {
  aiScore?: number; // 0–10 from AI, undefined if reranking skipped
}

/**
 * Rerank results using Anthropic API.
 * Returns the same array sorted by blended score.
 * Safe to call even if API key is missing — falls back to input order.
 */
export async function rerank(
  results: RhymeResult[],
  inputPhrase: string
): Promise<RerankedResult[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || results.length === 0) {
    return results;
  }

  // Only rerank the pool (top N by phonetic score)
  const toRerank = results.slice(0, RERANK_POOL);
  const rest = results.slice(RERANK_POOL);

  try {
    const client = new Anthropic({ apiKey });

    const phraseList = toRerank
      .map((r, i) => `${i + 1}. ${r.phrase}`)
      .join("\n");

    const prompt = `You are helping a rapper find the best rhymes for the phrase "${inputPhrase}".

Below is a numbered list of phonetically matched words and phrases. Score each one from 0 to 10 based on how RECOGNISABLE and USEFUL it would be in a rap or hip-hop song — prioritising common words, everyday phrases, pop culture references, and emotionally resonant language. Penalise obscure words, technical jargon, proper nouns that aren't widely known, and awkward-sounding phrases.

${phraseList}

Reply with ONLY a JSON array of numbers (one score per item, in the same order). Example for 3 items: [7, 2, 9]
No explanation, no markdown, just the raw JSON array.`;

    const message = await client.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 256,
      messages: [{ role: "user", content: prompt }],
    });

    const text =
      message.content[0].type === "text" ? message.content[0].text.trim() : "";

    // Parse the score array — be defensive
    const match = text.match(/\[[\d.,\s]+\]/);
    if (!match) throw new Error(`Unexpected AI response: ${text}`);

    const scores: number[] = JSON.parse(match[0]);
    if (scores.length !== toRerank.length) {
      throw new Error(
        `Score count mismatch: got ${scores.length}, expected ${toRerank.length}`
      );
    }

    // Normalise phonetic scores to 0–10 range for fair blending
    const maxPhonetic = Math.max(...toRerank.map((r) => r.score), 1);

    const reranked: RerankedResult[] = toRerank.map((r, i) => {
      const aiScore = Math.max(0, Math.min(10, scores[i] ?? 0));
      const normPhonetic = (r.score / maxPhonetic) * 10;
      const blended = PHONETIC_WEIGHT * normPhonetic + AI_WEIGHT * aiScore;
      return { ...r, aiScore, _blended: blended } as RerankedResult & {
        _blended: number;
      };
    });

    // Sort by blended score descending, then alphabetical for ties
    reranked.sort(
      (a, b) =>
        ((b as { _blended?: number })._blended ?? 0) -
          ((a as { _blended?: number })._blended ?? 0) ||
        a.phrase.localeCompare(b.phrase)
    );

    // Strip internal _blended field before returning
    const cleaned: RerankedResult[] = reranked.map(({ ...r }) => {
      delete (r as { _blended?: number })._blended;
      return r;
    });

    // Append the non-reranked tail (no AI score)
    return [...cleaned, ...rest];
  } catch (err) {
    // Reranking failed — log and fall back to phonetic order silently
    console.error("Reranking failed, falling back to phonetic order:", err);
    return results;
  }
}
