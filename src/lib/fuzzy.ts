/**
 * A small, allocation-light subsequence fuzzy matcher for the command palette.
 * No dependency — this is ~80 lines and gives us scoring plus the matched
 * character indices needed to highlight results.
 */

export interface FuzzyMatch {
  score: number;
  /** Indices into the haystack that matched, ascending. */
  indices: number[];
}

const SCORE_EXACT_PREFIX = 120;
const SCORE_WORD_BOUNDARY = 18;
const SCORE_CAMEL_BOUNDARY = 14;
const SCORE_CONSECUTIVE = 12;
const SCORE_MATCH = 4;
const PENALTY_GAP = -1;
const PENALTY_LEADING = -0.5;

function isBoundary(prev: string | undefined): boolean {
  if (prev === undefined) return true;
  return prev === ' ' || prev === '-' || prev === '_' || prev === '/' || prev === '.' || prev === ':';
}

/**
 * Scores `needle` against `haystack`. Returns `null` when the needle is not a
 * subsequence of the haystack. An empty needle matches with score 0.
 *
 * @example
 * fuzzyMatch('atd', 'Auto-plan the day') // -> { score: …, indices: [0, 5, 14] }
 */
export function fuzzyMatch(needle: string, haystack: string): FuzzyMatch | null {
  if (!needle) return { score: 0, indices: [] };
  if (!haystack) return null;

  const n = needle.toLowerCase();
  const h = haystack.toLowerCase();
  if (n.length > h.length) return null;

  // Fast path: a contiguous substring match is always the best interpretation.
  const direct = h.indexOf(n);
  if (direct !== -1) {
    const indices: number[] = [];
    for (let i = 0; i < n.length; i += 1) indices.push(direct + i);
    let score = SCORE_MATCH * n.length + SCORE_CONSECUTIVE * (n.length - 1);
    if (direct === 0) score += SCORE_EXACT_PREFIX;
    else if (isBoundary(h[direct - 1])) score += SCORE_WORD_BOUNDARY * 2;
    score += PENALTY_LEADING * direct;
    return { score, indices };
  }

  const indices: number[] = [];
  let score = 0;
  let hi = 0;
  let lastMatch = -2;

  for (let ni = 0; ni < n.length; ni += 1) {
    const ch = n[ni]!;
    let found = -1;
    while (hi < h.length) {
      if (h[hi] === ch) {
        found = hi;
        break;
      }
      hi += 1;
    }
    if (found === -1) return null;

    score += SCORE_MATCH;
    if (found === lastMatch + 1) score += SCORE_CONSECUTIVE;
    if (isBoundary(h[found - 1])) score += SCORE_WORD_BOUNDARY;
    else if (haystack[found] !== h[found]) score += SCORE_CAMEL_BOUNDARY; // uppercase
    if (found > lastMatch + 1 && lastMatch >= 0) score += PENALTY_GAP * (found - lastMatch - 1);

    indices.push(found);
    lastMatch = found;
    hi = found + 1;
  }

  score += PENALTY_LEADING * (indices[0] ?? 0);
  return { score, indices };
}

/**
 * Scores a needle against several fields, keeping the best. Later fields are
 * weighted down so a title hit always beats a subtitle hit.
 *
 * @example
 * fuzzyScore('rev', ['Daily review', 'Navigation']) // best of title/keywords
 */
export function fuzzyScore(needle: string, fields: readonly string[]): FuzzyMatch | null {
  let best: FuzzyMatch | null = null;
  for (let i = 0; i < fields.length; i += 1) {
    const m = fuzzyMatch(needle, fields[i] ?? '');
    if (!m) continue;
    const weighted: FuzzyMatch = { score: m.score - i * 6, indices: i === 0 ? m.indices : [] };
    if (!best || weighted.score > best.score) best = weighted;
  }
  return best;
}

/**
 * Splits a string into matched / unmatched runs for highlight rendering.
 *
 * @example
 * highlightSegments('Daily review', [0, 1]) // [{text:'Da',hit:true},…]
 */
export function highlightSegments(
  text: string,
  indices: readonly number[],
): Array<{ text: string; hit: boolean }> {
  if (!indices.length) return [{ text, hit: false }];
  const set = new Set(indices);
  const out: Array<{ text: string; hit: boolean }> = [];
  let buf = '';
  let bufHit = set.has(0);
  for (let i = 0; i < text.length; i += 1) {
    const hit = set.has(i);
    if (hit !== bufHit && buf) {
      out.push({ text: buf, hit: bufHit });
      buf = '';
    }
    bufHit = hit;
    buf += text[i];
  }
  if (buf) out.push({ text: buf, hit: bufHit });
  return out;
}
