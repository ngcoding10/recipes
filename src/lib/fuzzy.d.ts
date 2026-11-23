// Types for fuzzy.js (the shared typo-tolerant search, copied unchanged from the backend repository).
export const FUZZY_VERSION: string;
/** Lower-case, strip accents and apostrophes, turn everything else that isn't a letter or digit into a space. */
export function foldText(s: unknown): string;
/** Edit distance where a swap of two neighbouring letters counts once; returns max + 1 when it exceeds `max`. */
export function editDistance(a: string, b: string, max?: number): number;
/** How well a typed word matches a real word, 0 (not at all) to 1 (exactly). */
export function wordScore(typed: string, word: string): number;

export interface FuzzyIndex<T> {
  readonly size: number;
  search(query: string, options?: { limit?: number; filter?: ((item: T) => boolean) | null; minScore?: number }): Array<{ item: T; score: number }>;
}
export function createFuzzyIndex<T>(items: T[], textsOf: (item: T) => string | string[], options?: { weight?: (item: T) => number }): FuzzyIndex<T>;
