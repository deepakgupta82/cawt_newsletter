/**
 * LinkedIn has no rich text. The common trick, and what tools like the TypeGrow
 * formatter do, is substitute Unicode Mathematical Alphanumeric glyphs so "bold"
 * and "italic" survive a plain-text paste. Underline and strikethrough use
 * combining marks applied per character.
 *
 * Sans-serif variants are used because they read as normal bold/italic rather
 * than a serif math font, and their code-point ranges are contiguous (no
 * reserved holes to special-case).
 */

function mapChars(text: string, upperBase: number, lowerBase: number, digitBase?: number): string {
  let out = '';
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    if (code >= 65 && code <= 90) out += String.fromCodePoint(upperBase + (code - 65));
    else if (code >= 97 && code <= 122) out += String.fromCodePoint(lowerBase + (code - 97));
    else if (digitBase !== undefined && code >= 48 && code <= 57) out += String.fromCodePoint(digitBase + (code - 48));
    else out += ch;
  }
  return out;
}

/** Appends a combining mark to each visible character (never to a newline). */
function combine(text: string, mark: string): string {
  let out = '';
  for (const ch of text) out += ch === '\n' ? ch : ch + mark;
  return out;
}

export type StyleName = 'bold' | 'italic' | 'boldItalic' | 'underline' | 'strike' | 'mono';

export const STYLES: Record<StyleName, (s: string) => string> = {
  bold: (s) => mapChars(s, 0x1d5d4, 0x1d5ee, 0x1d7ec),
  italic: (s) => mapChars(s, 0x1d608, 0x1d622),
  boldItalic: (s) => mapChars(s, 0x1d63c, 0x1d656),
  mono: (s) => mapChars(s, 0x1d670, 0x1d68a, 0x1d7f6),
  underline: (s) => combine(s, '̲'),
  strike: (s) => combine(s, '̶'),
};

/** Leading bullet/number markers, stripped before re-prefixing so toggles don't stack. */
const LIST_MARKER = /^(?:[•▸◦✅✔️⭐➡️]|\d+\.)\s+/;

export function stripListMarker(line: string): string {
  return line.replace(LIST_MARKER, '');
}
