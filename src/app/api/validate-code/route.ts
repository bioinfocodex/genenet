import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function POST(req: NextRequest) {
  try {
    const { code } = await req.json();
    if (!code) return NextResponse.json({ error: 'No code provided.' }, { status: 400 });

    const ws = await prisma.workspaceSettings.findUnique({ where: { id: 'workspace' } });
    if (!ws?.connectionCode || ws.connectionCode !== code.toUpperCase()) {
      return NextResponse.json({ error: 'Invalid connection code.' }, { status: 401 });
    }

    return NextResponse.json({ success: true, workspaceName: ws.workspaceName });
  } catch {
    return NextResponse.json({ error: 'Server error.' }, { status: 500 });
  }
}
