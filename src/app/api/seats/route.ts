import { NextResponse } from 'next/server';
import { getSeatInfo } from '@/app/actions/team';
import { requireApiAdmin } from '@/lib/auth-guard';

export async function GET() {
  const auth = await requireApiAdmin();
  if ('response' in auth) return auth.response;
  const info = await getSeatInfo();
  return NextResponse.json(info);
}
