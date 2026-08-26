import { NextRequest, NextResponse } from 'next/server';

/**
 * Self-hosted, always-inline-rendered stand-in listing page for
 * `verify_seller_bond_listing` — for a seller without a live marketplace
 * listing to embed the verification code into yet (or for testing).
 *
 * This used to be an apps/api (Fly) route. Moved here deliberately:
 * Fly's `recallraid-api` app runs a single region (`iad`), and GenVM's
 * validator set is geographically distributed — confirmed live that
 * `verify_seller_bond_listing` against the Fly-hosted version kept
 * landing on MAJORITY_DISAGREE even with the leader and at least one
 * validator both fetching it successfully and agreeing, meaning some
 * OTHER validators simply couldn't reach it reliably. Vercel's edge
 * network serves this from a point of presence near wherever the request
 * actually originates, which should be far more consistently reachable
 * for a globally-distributed validator set than one single-region origin.
 *
 * Deliberately NOT served via the Cloudinary evidence-upload pipeline
 * either: Cloudinary forces `Content-Disposition: attachment` on every
 * raw HTML upload (a non-configurable anti-XSS policy), which makes
 * GenVM's browser-based `gl.nondet.web.render` treat it as a file
 * download rather than a page to render.
 *
 * Deliberately does NOT look up the bond (chain RPC or cache) to find its
 * code — the code is passed straight through as a query parameter (the
 * seller already has it, it's returned from `create_seller_bond` and
 * shown in the dashboard), so this route does zero I/O. `code` is
 * HTML-escaped before being embedded, so this stays safe even though it
 * echoes caller input.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const id = params.id;
  const rawCode = req.nextUrl.searchParams.get('code') ?? '';
  if (!rawCode) {
    return NextResponse.json({ error: "query parameter 'code' is required (your bond's verification_code)" }, { status: 400 });
  }
  const code = escapeHtml(rawCode);
  const html =
    `<!doctype html><html><head><title>RecallRaid demo listing #${escapeHtml(id)}</title></head>` +
    `<body><h1>RecallRaid demo listing page</h1>` +
    `<p style="color:#b00;font-weight:bold">TESTNET / DEMO PAGE ONLY. Verifying against this page proves control of ` +
    `this RecallRaid demo route, NOT ownership of any real third-party marketplace listing. Do not treat a bond ` +
    `verified against this page as equivalent to verified marketplace-listing ownership.</p>` +
    `<p>Stand-in page for Clean Inventory Bond #${escapeHtml(id)}, used only when a real marketplace listing isn't ` +
    `available to embed the code into (e.g. local/StudioNet testing).</p>` +
    `<p>Verification code: <strong>${code}</strong></p></body></html>`;
  return new NextResponse(html, { headers: { 'content-type': 'text/html; charset=utf-8' } });
}
