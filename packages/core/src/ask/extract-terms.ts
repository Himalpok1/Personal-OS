// Deterministic term extraction for Cloud Ask (Checkpoint 8.6B, ADR-059-style
// query handling extended to a new surface).
//
// Turns a user's free-text question into a small, bounded, lowercase set of
// terms used to retrieve candidate notes/tasks locally -- BEFORE anything is
// sent to a model. Nothing here reads a database, calls a provider, or knows
// what SQL is; it is pure string handling so the bounds are unit-testable
// without either.
//
// WHY A MINIMUM OF 3, NOT 2 (unlike SEARCH_QUERY_MIN_CHARS)
//
// A 2-character survivor like "re" or "up" matches most of a corpus, which lets
// RANKING rather than the QUESTION decide what gets sent to a paid cloud model
// -- a materially worse failure mode for Ask than for local-only search, where
// a bad match just wastes a screen tap. 3 removes that whole class of common
// short fragments without a stopword-list entry for each one.
import { stripUnsummarizableCharacters } from "../mail/provider-strings.js";

/** Shortest a term may be after stopword removal. */
export const ASK_TERM_MIN_CHARS = 3;

/** Most distinct terms extracted from one question. */
export const ASK_MAX_TERMS = 8;

/**
 * Common English function words, dropped because they carry no retrieval
 * signal and would otherwise occupy a term slot in almost every question.
 * Deliberately NOT exhaustive -- it only needs to catch what a real question
 * actually contains, not model a language.
 */
const STOPWORDS: ReadonlySet<string> = new Set([
  "the",
  "and",
  "for",
  "are",
  "was",
  "were",
  "been",
  "being",
  "have",
  "has",
  "had",
  "does",
  "did",
  "doing",
  "will",
  "would",
  "should",
  "could",
  "can",
  "may",
  "might",
  "must",
  "shall",
  "this",
  "that",
  "these",
  "those",
  "you",
  "your",
  "yours",
  "his",
  "her",
  "hers",
  "its",
  "our",
  "ours",
  "their",
  "theirs",
  "them",
  "what",
  "which",
  "who",
  "whom",
  "whose",
  "where",
  "when",
  "why",
  "how",
  "not",
  "than",
  "then",
  "there",
  "here",
  "with",
  "from",
  "about",
  "into",
  "over",
  "after",
  "before",
  "again",
  "further",
  "once",
  "all",
  "any",
  "both",
  "each",
  "few",
  "more",
  "most",
  "other",
  "some",
  "such",
  "only",
  "own",
  "same",
  "too",
  "very",
  "just",
  "now",
  "also",
]);

/**
 * Splits `question` into lowercase, deduplicated, stopword-filtered terms.
 *
 * Deterministic and total: any input (including one that is empty, all
 * punctuation, or all stopwords) yields SOME array, possibly empty. An empty
 * array is the caller's signal to make no model call at all -- see
 * `apps/api/src/ask/select-context.ts`.
 */
export function extractAskTerms(question: string): string[] {
  const normalized = (stripUnsummarizableCharacters(question) ?? "").toLowerCase();
  const words = normalized.split(/[^a-z0-9]+/).filter((word) => word.length > 0);

  const terms: string[] = [];
  const seen = new Set<string>();
  for (const word of words) {
    if (word.length < ASK_TERM_MIN_CHARS) continue;
    if (STOPWORDS.has(word)) continue;
    if (seen.has(word)) continue;
    seen.add(word);
    terms.push(word);
    if (terms.length >= ASK_MAX_TERMS) break;
  }
  return terms;
}
