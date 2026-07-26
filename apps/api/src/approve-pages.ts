/**
 * Minimal self-contained HTML for the emailed Approve flow. Served by the API,
 * not the SPA, so the link works without a client build or a login.
 */

const SHELL = (title: string, body: string): string => `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
  body{margin:0;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;background:#f3f4f6;color:#1c1917;
    display:flex;min-height:100vh;align-items:center;justify-content:center;padding:24px;}
  .card{background:#fff;border:1px solid #e7e5e4;border-radius:16px;max-width:440px;width:100%;padding:28px;
    box-shadow:0 1px 3px rgba(0,0,0,0.06);}
  h1{font-size:18px;margin:0 0 6px;}
  p{font-size:14px;line-height:1.55;color:#57534e;margin:0 0 18px;}
  .sub{font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:#0e7c6b;font-weight:700;margin-bottom:10px;}
  button,.btn{display:inline-block;border:0;font-size:14px;font-weight:600;padding:11px 20px;border-radius:9px;
    cursor:pointer;text-decoration:none;}
  .primary{background:#0e7c6b;color:#fff;}
  .ghost{background:#fff;color:#44403c;border:1px solid #e7e5e4;margin-left:8px;}
</style></head><body><div class="card">${body}</div></body></html>`;

export function confirmPage(opts: {
  newsletterName: string;
  subject: string;
  recipientCount: number;
  token: string;
  editUrl: string;
}): string {
  const { newsletterName, subject, recipientCount, token, editUrl } = opts;
  return SHELL(
    'Approve and send',
    `<div class="sub">${esc(newsletterName)}</div>
     <h1>Send this edition?</h1>
     <p>"${esc(subject)}" will be emailed to <strong>${recipientCount}</strong> recipient${
       recipientCount === 1 ? '' : 's'
     }. This cannot be undone.</p>
     <form method="POST" action="/api/approve">
       <input type="hidden" name="token" value="${esc(token)}">
       <button class="primary" type="submit">Confirm &amp; send</button>
       <a class="btn ghost" href="${esc(editUrl)}">Edit instead</a>
     </form>`,
  );
}

export function resultPage(title: string, message: string, editUrl?: string): string {
  return SHELL(
    title,
    `<h1>${esc(title)}</h1><p>${esc(message)}</p>${
      editUrl ? `<a class="btn ghost" href="${esc(editUrl)}">Open in app</a>` : ''
    }`,
  );
}

function esc(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
