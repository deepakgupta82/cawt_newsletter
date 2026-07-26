/**
 * The banner prepended to a scheduled draft when it is emailed to reviewers.
 *
 * The reviewer sees exactly what recipients would get (the edition HTML sits
 * below), with two actions on top: Approve, which opens a confirm-and-send page,
 * and Edit, which opens the newsletter in the app. Approve does not send on its
 * own click - it links to a confirmation page - so an email client that
 * prefetches links cannot fire a real send.
 */
export function renderReviewEmail(opts: {
  newsletterName: string;
  editionHtml: string;
  approveUrl: string;
  editUrl: string;
  recipientCount: number;
}): string {
  const { newsletterName, editionHtml, approveUrl, editUrl, recipientCount } = opts;
  const banner = `
<div style="background:#0b1220;padding:20px 24px;font-family:Arial,Helvetica,sans-serif;color:#e5e7eb;">
  <div style="font-size:11px;letter-spacing:0.08em;text-transform:uppercase;color:#8aa;opacity:0.8;">Scheduled draft</div>
  <div style="font-size:17px;font-weight:600;color:#ffffff;margin-top:4px;">${escapeHtml(newsletterName)} is ready to review</div>
  <div style="font-size:13px;color:#c9d2dd;margin-top:6px;">
    On approval this goes to ${recipientCount} recipient${recipientCount === 1 ? '' : 's'}. Nothing is sent until you approve.
  </div>
  <div style="margin-top:16px;">
    <a href="${approveUrl}" style="display:inline-block;background:#0e7c6b;color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;padding:10px 20px;border-radius:8px;">Approve &amp; send</a>
    <a href="${editUrl}" style="display:inline-block;margin-left:10px;background:transparent;color:#e5e7eb;text-decoration:none;font-size:14px;font-weight:600;padding:10px 20px;border-radius:8px;border:1px solid #33415a;">Edit in app</a>
  </div>
</div>
<div style="height:8px;background:#f3f4f6;"></div>
`;
  return `<div>${banner}${editionHtml}</div>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
