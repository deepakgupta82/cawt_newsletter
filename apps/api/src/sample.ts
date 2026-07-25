/**
 * Normalises a pasted or uploaded sample into text that preserves structure.
 *
 * HTML is the best input: heading levels are explicit, so section nesting comes
 * through exactly rather than being inferred from font size. Plain text still
 * works, it just gives the extractor less to go on.
 */
export function normaliseSample(raw: string): { text: string; format: 'html' | 'text' } {
  const looksLikeHtml = /<\/?(?:html|body|div|p|h[1-6]|table|span|br)\b/i.test(raw);
  if (!looksLikeHtml) return { text: raw.trim(), format: 'text' };

  const text = raw
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
    // Keep heading level as a markdown-style marker so structure survives.
    .replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, (_, inner: string) => `\n\n# ${strip(inner)}\n`)
    .replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, (_, inner: string) => `\n\n## ${strip(inner)}\n`)
    .replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, (_, inner: string) => `\n\n### ${strip(inner)}\n`)
    .replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, (_, inner: string) => `\n\n#### ${strip(inner)}\n`)
    .replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_, inner: string) => `\n- ${strip(inner)}`)
    // Anchors become "text (href)" so citation style is visible to the extractor.
    .replace(/<a[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_, href: string, inner: string) => {
      const label = strip(inner);
      return label ? `${label} (${href})` : href;
    })
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|table|section)>/gi, '\n\n')
    .replace(/<[^>]+>/g, ' ');

  return { text: decode(text).replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim(), format: 'html' };
}

function strip(value: string): string {
  return decode(value.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function decode(value: string): string {
  return value
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&mdash;/g, '-')
    .replace(/&ndash;/g, '-')
    .replace(/&hellip;/g, '...')
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)));
}
