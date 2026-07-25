import { richTextToPlain } from '@cawt/render';

/**
 * Deterministic claim verification.
 *
 * Every figure, percentage, currency amount, year and quoted phrase in a
 * generated story is checked against the text of the sources it was built
 * from. Anything that does not appear is flagged before a human ever sees the
 * draft marked ready.
 *
 * This runs in plain code, not through a model. It costs nothing, it cannot
 * itself hallucinate, and it catches the exact failure mode that matters most
 * for a newsletter published under CAWT's name: a number that was never in the
 * source. A model-based check runs after this one and catches softer problems,
 * but this is the gate that has teeth.
 */

export interface FactCheckFinding {
  kind: 'number' | 'percentage' | 'money' | 'year' | 'quote';
  claim: string;
  message: string;
}

/** Numbers written with separators, decimals, or scale words. */
const MONEY = /(?:US\$|\$|€|£|₹|Rs\.?\s?)\s?\d[\d,.]*\s?(?:billion|bn|million|mn|m|crore|lakh|k|trillion)?/gi;
const PERCENTAGE = /\d[\d,.]*\s?(?:%|per cent|percent)/gi;
const YEAR = /\b(?:19|20)\d{2}\b/g;
const BARE_NUMBER = /\b\d[\d,]*(?:\.\d+)?\b/g;
const QUOTE = /[“"]([^”"]{12,180})[”"]/g;

/** Comparable form: digits only, so "$1.6 billion" and "1.6bn" line up. */
function normaliseNumeric(value: string): string {
  return value
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/,/g, '')
    .replace(/(?:us\$|\$|€|£|₹|rs\.?)/g, '')
    .replace(/billion|bn/g, 'b')
    .replace(/million|mn/g, 'm')
    .replace(/trillion/g, 't')
    .replace(/percent|per cent/g, '%');
}

function normaliseText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9%.$€£₹\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function collect(pattern: RegExp, text: string): string[] {
  const out = new Set<string>();
  for (const match of text.matchAll(pattern)) {
    const value = (match[1] ?? match[0]).trim();
    if (value) out.add(value);
  }
  return [...out];
}

/**
 * @param generated  The story body (and any why-it-matters text) as produced.
 * @param sourceText Concatenated text of every source the story cites.
 */
export function checkStoryAgainstSources(generated: string, sourceText: string): FactCheckFinding[] {
  const claim = richTextToPlain(generated);
  const haystackRaw = sourceText;
  const haystackNormalised = normaliseText(sourceText);
  const haystackNumeric = normaliseNumeric(sourceText);

  const findings: FactCheckFinding[] = [];

  const checkNumeric = (values: string[], kind: FactCheckFinding['kind'], label: string) => {
    for (const value of values) {
      if (!haystackNumeric.includes(normaliseNumeric(value))) {
        findings.push({
          kind,
          claim: value,
          message: `${label} "${value}" does not appear in any cited source.`,
        });
      }
    }
  };

  checkNumeric(collect(MONEY, claim), 'money', 'Amount');
  checkNumeric(collect(PERCENTAGE, claim), 'percentage', 'Percentage');
  checkNumeric(collect(YEAR, claim), 'year', 'Year');

  // Bare numbers are noisy, so only check ones that are not already covered by
  // a money or percentage match and are large enough to be a real claim.
  const covered = new Set([...collect(MONEY, claim), ...collect(PERCENTAGE, claim)].map(normaliseNumeric));
  const bare = collect(BARE_NUMBER, claim).filter((value) => {
    const normalised = normaliseNumeric(value);
    if ([...covered].some((entry) => entry.includes(normalised))) return false;
    return Number(value.replace(/,/g, '')) >= 3;
  });
  checkNumeric(bare, 'number', 'Figure');

  for (const quoted of collect(QUOTE, claim)) {
    if (!haystackNormalised.includes(normaliseText(quoted)) && !haystackRaw.includes(quoted)) {
      findings.push({
        kind: 'quote',
        claim: quoted,
        message: `Quotation "${quoted.slice(0, 60)}..." was not found verbatim in any cited source.`,
      });
    }
  }

  return findings;
}

/**
 * Detects the case CAWT's current newsletter already handles well: two sources
 * reporting different figures for the same thing. Reporting the disagreement
 * beats silently picking one.
 */
export function detectConflictingFigures(sourceTexts: string[]): string[] {
  if (sourceTexts.length < 2) return [];

  const perSource = sourceTexts.map((text) => new Set(collect(MONEY, text).map(normaliseNumeric)));
  const conflicts: string[] = [];

  for (let i = 0; i < perSource.length; i++) {
    for (let j = i + 1; j < perSource.length; j++) {
      const a = perSource[i]!;
      const b = perSource[j]!;
      if (a.size === 0 || b.size === 0) continue;
      const shared = [...a].some((value) => b.has(value));
      if (!shared) {
        conflicts.push(
          `Cited sources give different figures (${[...a].join(', ')} vs ${[...b].join(', ')}). State the discrepancy rather than choosing one.`,
        );
      }
    }
  }

  return [...new Set(conflicts)];
}
