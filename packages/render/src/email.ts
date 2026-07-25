import type { Brand, Edition, EditionBlock, EditionLeafBlock, SourceRef } from '@cawt/domain';
import { escapeAttribute, escapeHtml, richTextToPlain, safeUrl, sanitizeRichText } from './sanitize.js';

/**
 * Renders a block tree to email HTML.
 *
 * Table-based and inline-styled throughout, because Outlook's rendering engine
 * does not support flexbox, grid, or external stylesheets. The model never
 * produces any of this: it composes blocks, and this file is the only thing
 * that decides what they look like. That is what keeps the layout tested and
 * consistent no matter what shape the newsletter takes.
 */

export interface RenderOptions {
  brand: Brand;
  /** Appended as an unsubscribe link. Required for any external send. */
  unsubscribeUrl?: string;
  /** Suppresses the footer for in-app preview. */
  preview?: boolean;
}

const CONTENT_WIDTH = 600;

function renderSources(sources: SourceRef[], accent: string): string {
  // One anchor per source, with the publisher as link text. The current Logic
  // App concatenates bare hostnames into a single unclickable run
  // ("www.law360.comwww.law360.com"), which makes verification impossible.
  const links = sources
    .map((source) => {
      const href = safeUrl(source.url);
      if (!href) return null;
      const label = escapeHtml(source.publisher || new URL(href).hostname);
      return `<a href="${escapeAttribute(href)}" style="color:${accent};text-decoration:underline;" title="${escapeAttribute(source.title)}">${label}</a>`;
    })
    .filter((value): value is string => value !== null);

  if (links.length === 0) return '';
  return `<div style="margin:8px 0 0;font-size:13px;line-height:20px;color:#6B7280;">Sources: ${links.join(' &middot; ')}</div>`;
}

function renderLeaf(block: EditionLeafBlock, options: RenderOptions): string {
  const { brand } = options;

  switch (block.type) {
    case 'group_label':
      return `<div style="margin:24px 0 12px;font-family:${brand.fontFamily};font-size:15px;font-weight:700;color:${brand.primaryColor};letter-spacing:0.2px;">${escapeHtml(block.text)}</div>`;

    case 'empty_state':
      return `<div style="margin:0 0 16px;font-size:15px;line-height:24px;color:#6B7280;font-style:italic;">${escapeHtml(block.text)}</div>`;

    case 'divider':
      return `<div style="margin:24px 0;border-top:1px solid #E5E7EB;line-height:1px;font-size:1px;">&nbsp;</div>`;

    case 'prose': {
      const label = block.label
        ? `<strong style="color:${brand.primaryColor};">${escapeHtml(block.label)}</strong> `
        : '';
      return `<p style="margin:0 0 16px;font-size:15px;line-height:24px;color:#374151;">${label}${sanitizeRichText(block.text)}</p>`;
    }

    case 'story': {
      if (block.style === 'headline_only') {
        return `<div style="margin:0 0 12px;">
  <div style="font-size:15px;line-height:23px;font-weight:600;color:${brand.primaryColor};">${escapeHtml(block.headline)}</div>
  ${renderSources(block.sources, brand.accentColor)}
</div>`;
      }

      if (block.style === 'compact_list') {
        return `<div style="margin:0 0 10px;font-size:15px;line-height:23px;color:#374151;">
  <strong style="color:${brand.primaryColor};">${escapeHtml(block.headline)}</strong> &mdash; ${sanitizeRichText(block.body)}
  ${renderSources(block.sources, brand.accentColor)}
</div>`;
      }

      const why = block.whyItMatters
        ? `<p style="margin:10px 0 0;font-size:15px;line-height:24px;color:#4B5563;"><em>Why it matters:</em> ${sanitizeRichText(block.whyItMatters)}</p>`
        : '';

      const warnings =
        block.warnings.length > 0
          ? `<div style="margin:10px 0 0;padding:8px 12px;background:#FFFBEB;border-left:3px solid #F59E0B;font-size:13px;line-height:20px;color:#92400E;">${block.warnings.map(escapeHtml).join('<br />')}</div>`
          : '';

      return `<div style="margin:0 0 26px;">
  <h3 style="margin:0 0 8px;font-family:${brand.fontFamily};font-size:17px;line-height:25px;font-weight:700;color:${brand.primaryColor};">${escapeHtml(block.headline)}</h3>
  <p style="margin:0;font-size:15px;line-height:24px;color:#374151;">${sanitizeRichText(block.body)}</p>
  ${why}
  ${warnings}
  ${renderSources(block.sources, brand.accentColor)}
</div>`;
    }

    default: {
      const exhaustive: never = block;
      return exhaustive;
    }
  }
}

function renderBlock(block: EditionBlock, options: RenderOptions): string {
  if (block.type !== 'section') return renderLeaf(block, options);

  const { brand } = options;
  const lead = block.lead
    ? `<p style="margin:0 0 16px;font-size:15px;line-height:24px;color:#6B7280;">${sanitizeRichText(block.lead)}</p>`
    : '';

  return `<div style="margin:0 0 12px;">
  <h2 style="margin:32px 0 4px;padding:0 0 8px;border-bottom:2px solid ${brand.accentColor};font-family:${brand.fontFamily};font-size:22px;line-height:30px;font-weight:700;color:${brand.primaryColor};">${escapeHtml(block.heading)}</h2>
  ${lead}
  ${block.children.map((child) => renderLeaf(child, options)).join('\n')}
</div>`;
}

export function renderEditionHtml(edition: Edition, options: RenderOptions): string {
  const { brand } = options;

  const header = brand.headerText
    ? `<div style="margin:0 0 6px;font-size:13px;letter-spacing:1.2px;text-transform:uppercase;color:${brand.accentColor};font-weight:700;">${escapeHtml(brand.headerText)}</div>`
    : '';

  const unsubscribe = options.unsubscribeUrl
    ? ` &middot; <a href="${escapeAttribute(options.unsubscribeUrl)}" style="color:#6B7280;text-decoration:underline;">Unsubscribe</a>`
    : '';

  const footer = options.preview
    ? ''
    : `<div style="margin:32px 0 0;padding:16px 0 0;border-top:1px solid #E5E7EB;font-size:12px;line-height:19px;color:#6B7280;">
  ${escapeHtml(brand.footerText)}<br />
  <a href="mailto:${escapeAttribute(brand.contactAddress)}" style="color:#6B7280;text-decoration:underline;">${escapeHtml(brand.contactAddress)}</a>${unsubscribe}
  ${brand.disclaimer ? `<br /><br />${escapeHtml(brand.disclaimer)}` : ''}
</div>`;

  const body = edition.blocks.map((block) => renderBlock(block, options)).join('\n');

  return `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${escapeHtml(edition.title)}</title>
<!--[if mso]><style type="text/css">body,table,td{font-family:Arial,Helvetica,sans-serif !important;}</style><![endif]-->
</head>
<body style="margin:0;padding:0;background-color:#F3F4F6;-webkit-font-smoothing:antialiased;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(edition.preheader ?? '')}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#F3F4F6;">
  <tr>
    <td align="center" style="padding:24px 12px;">
      <table role="presentation" width="${CONTENT_WIDTH}" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:${CONTENT_WIDTH}px;background-color:${brand.backgroundColor};border-radius:10px;border:1px solid #E5E7EB;">
        <tr>
          <td style="padding:32px 36px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#111827;">
            ${header}
            <h1 style="margin:0 0 4px;font-family:${brand.fontFamily};font-size:27px;line-height:35px;font-weight:700;color:${brand.primaryColor};">${escapeHtml(edition.title)}</h1>
            ${body}
            ${footer}
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
}

export function renderEditionText(edition: Edition, options: RenderOptions): string {
  const lines: string[] = [edition.title, '='.repeat(Math.min(edition.title.length, 70)), ''];

  const leaf = (block: EditionLeafBlock): void => {
    switch (block.type) {
      case 'group_label':
        lines.push(block.text.toUpperCase(), '');
        break;
      case 'empty_state':
        lines.push(block.text, '');
        break;
      case 'divider':
        lines.push('-'.repeat(40), '');
        break;
      case 'prose':
        lines.push(`${block.label ? `${block.label} ` : ''}${richTextToPlain(block.text)}`, '');
        break;
      case 'story': {
        lines.push(block.headline);
        lines.push(richTextToPlain(block.body));
        if (block.whyItMatters) lines.push(`Why it matters: ${richTextToPlain(block.whyItMatters)}`);
        for (const warning of block.warnings) lines.push(`[!] ${warning}`);
        if (block.sources.length > 0) {
          lines.push(`Sources: ${block.sources.map((source) => `${source.publisher} <${source.url}>`).join(' | ')}`);
        }
        lines.push('');
        break;
      }
    }
  };

  for (const block of edition.blocks) {
    if (block.type === 'section') {
      lines.push('', block.heading.toUpperCase(), '-'.repeat(Math.min(block.heading.length, 70)), '');
      if (block.lead) lines.push(richTextToPlain(block.lead), '');
      block.children.forEach(leaf);
    } else {
      leaf(block);
    }
  }

  if (!options.preview) {
    lines.push('', '-'.repeat(40), options.brand.footerText, options.brand.contactAddress);
    if (options.unsubscribeUrl) lines.push(`Unsubscribe: ${options.unsubscribeUrl}`);
  }

  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}
