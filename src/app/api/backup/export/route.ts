import { NextResponse } from 'next/server';
import { requireApiAdmin } from '@/lib/auth-guard';
import { exportWorkspace } from '@/lib/backup';

/**
 * Download the whole workspace as JSON.
 *
 * Admin-only: this is every record in the lab in one response.
 */
export async function GET() {
  const auth = await requireApiAdmin();
  if ('response' in auth) return auth.response;

  const data = await exportWorkspace();
  const stamp = new Date().toISOString().slice(0, 10);

  return new NextResponse(JSON.stringify(data, null, 2), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="genenet-export-${stamp}.json"`,
      // A workspace export must never be cached by a proxy or the browser.
      'Cache-Control': 'no-store, private',
    },
  });
}
