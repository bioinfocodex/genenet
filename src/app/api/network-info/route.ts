import { NextResponse } from 'next/server';
import os from 'os';
import { requireApiUser } from '@/lib/auth-guard';

export async function GET() {
  const auth = await requireApiUser();
  if ('response' in auth) return auth.response;
  const interfaces = os.networkInterfaces();
  const ips: { name: string; address: string }[] = [];

  for (const [name, addrs] of Object.entries(interfaces)) {
    if (!addrs) continue;
    for (const addr of addrs) {
      if (addr.family === 'IPv4' && !addr.internal) {
        ips.push({ name, address: addr.address });
      }
    }
  }

  return NextResponse.json({ ips, hostname: os.hostname() });
}
