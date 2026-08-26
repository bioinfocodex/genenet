import { NextResponse } from 'next/server';
import { getSeatInfo } from '@/app/actions/team';

export async function GET() {
  const info = await getSeatInfo();
  return NextResponse.json(info);
}
