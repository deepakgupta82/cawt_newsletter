/**
 * Sanitising for editor-produced rich text.
 *
 * The editor never edits raw email HTML. It edits the fields inside a block,
 * with a restricted set of marks, and the server renders the branded template
 * around them. So the allow-list here is short on purpose: anything an email
 * client will not render consistently has nowhere useful to go anyway.
 *
 * Applied on save and again at render time. Belt and braces, because a stored
 * value could predate a tightening of the rules.
 */

const ALLOWED_TAGS = new Set(['b', 'strong', 'i', 'em', 'u', 'a', 'br', 'p', 'ul', 'ol', 'li']);
const VOID_TAGS = new Set(['br']);

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function escapeAttribute(value: string): string {
  return escapeHtml(value);
}

/** Only http(s) and mailto survive. Blocks javascript: and data: URLs. */
export function safeUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (url.protocol === 'http:' || url.protocol === 'https:' || url.protocol === 'mailto:') {
      return url.toString();
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Strips every tag outside the allow-list, drops all attributes except href on
 * anchors, and forces safe link targets.
 */
export function sanitizeRichText(input: string): string {
  const withoutDangerous = input
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|iframe|object|embed|link|meta)[\s\S]*?<\/\1>/gi, '')
    .replace(/<(script|style|iframe|object|embed|link|meta)[^>]*\/?>/gi, '');

  return withoutDangerous.replace(/<\/?([a-zA-Z][a-zA-Z0-9]*)([^>]*)>/g, (match, rawTag: string, attrs: string) => {
    const tag = rawTag.toLowerCase();
    if (!ALLOWED_TAGS.has(tag)) return '';

    const isClosing = match.startsWith('</');
    if (isClosing) return `</${tag}>`;
    if (VOID_TAGS.has(tag)) return `<${tag} />`;

    if (tag === 'a') {
      const hrefMatch = /href\s*=\s*["']([^"']*)["']/i.exec(attrs);
      const href = hrefMatch?.[1] ? safeUrl(hrefMatch[1]) : null;
      if (!href) return '<span>';
      return `<a href="${escapeAttribute(href)}" target="_blank" rel="noopener noreferrer">`;
    }

    return `<${tag}>`;
  });
}

/** Rich text to readable plain text, for the text/plain alternative part. */
export function richTextToPlain(input: string): string {
  return input
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<li>/gi, '  - ')
    .replace(/<\/li>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
