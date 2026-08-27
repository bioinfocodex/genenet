'use server';
import { randomInt } from 'crypto';
import { prisma } from '@/lib/prisma';
import { requireAdmin as sharedRequireAdmin } from '@/lib/auth-guard';
import { revalidatePath } from 'next/cache';

// Was already reading the role from the database rather than the token, which
// was right; the shared guard adds the status check on top.
async function requireAdmin() {
  const user = await sharedRequireAdmin();
  return { userId: user.id, role: user.role };
}

function generateInviteCode(): string {
  // randomInt rather than Math.random: this code creates an account when
  // redeemed, so it needs to be unguessable rather than merely arbitrary.
  // The alphabet omits I, O, 0 and 1 on purpose -- these get read aloud and
  // typed by hand.
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = 'LAB-';
  for (let i = 0; i < 5; i++) code += chars[randomInt(chars.length)];
  return code;
}

/**
 * What the invite and SMTP actions hand back.
 *
 * Declared rather than inferred so the client can narrow on `success` instead
 * of casting the result to `any` -- a cast there would also have swallowed a
 * genuine shape change on this side.
 */
export type InviteResult =
  | { error: string }
  | { success: true; code: string; inviteLink: string; emailError?: string };

export type SmtpTestResult =
  | { error: string }
  | { success: true; message: string };

// ─── Team size ────────────────────────────────────────────────────────────────

/**
 * How many people are in the workspace.
 *
 * There is no ceiling. GeneNet is not licensed per seat, so a lab that grows
 * is not a lab that has to ask anyone for permission -- this is a count, not
 * a quota.
 */
export async function getTeamInfo() {
  const [ws, total] = await Promise.all([
    prisma.workspaceSettings.findUnique({ where: { id: 'workspace' } }),
    prisma.user.count({ where: { status: { not: 'REMOVED' } } }),
  ]);
  return {
    used: total,
    companyName: ws?.companyName ?? ws?.workspaceName ?? 'Lab',
  };
}

// ─── Invite a member by email ─────────────────────────────────────────────────

export async function inviteMember(formData: FormData): Promise<InviteResult> {
  const session = await requireAdmin();
  const email = (formData.get('email') as string).trim().toLowerCase();
  const name  = (formData.get('name') as string).trim();

  if (!email) return { error: 'Email is required.' };

  // Check not already a user
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) return { error: 'This email already has an account.' };

  // Generate unique invite code
  let code = generateInviteCode();
  while (await prisma.invite.findUnique({ where: { code } })) {
    code = generateInviteCode();
  }

  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

  const invite = await prisma.invite.create({
    data: { code, email, name, expiresAt, createdById: session.userId },
  });

  // Send email (non-fatal — invite is already saved)
  const ws = await prisma.workspaceSettings.findUnique({ where: { id: 'workspace' } });
  const baseUrl = ws?.serverUrl ?? process.env.SERVER_URL ?? 'http://localhost:3000';
  const inviteLink = `${baseUrl}/register?code=${code}`;

  let emailError: string | undefined;
  try {
    await sendInviteEmail({ to: email, name, inviteLink, code, companyName: ws?.companyName ?? ws?.workspaceName ?? 'Lab' });
    await prisma.invite.update({ where: { id: invite.id }, data: { emailSent: true } });
  } catch (err) {
    emailError = err instanceof Error ? err.message : String(err);
    console.error('📧 SMTP failed:', emailError);
    console.log(`\n📧 INVITE LINK (email failed — share manually):\n${inviteLink}\nCode: ${code}\n`);
  }

  revalidatePath('/admin/team');
  return {
    success: true,
    code: invite.code,
    inviteLink,
    emailError,
  };
}

// ─── Resend invite email ──────────────────────────────────────────────────────

export async function resendInvite(formData: FormData) {
  await requireAdmin();
  const id = formData.get('id') as string;

  const invite = await prisma.invite.findUnique({ where: { id } });
  if (!invite || invite.usedAt) return { error: 'Invalid or already used invite.' };

  const ws = await prisma.workspaceSettings.findUnique({ where: { id: 'workspace' } });
  const baseUrl = ws?.serverUrl ?? process.env.SERVER_URL ?? 'http://localhost:3000';
  const inviteLink = `${baseUrl}/register?code=${invite.code}`;
  const companyName = ws?.companyName ?? ws?.workspaceName ?? 'Lab';

  let emailError: string | undefined;
  try {
    await sendInviteEmail({
      to: invite.email ?? '',
      name: invite.name ?? '',
      inviteLink,
      code: invite.code,
      companyName,
    });
    await prisma.invite.update({ where: { id }, data: { emailSent: true } });
  } catch (err) {
    emailError = err instanceof Error ? err.message : String(err);
    console.error('📧 SMTP failed:', emailError);
    console.log(`\n📧 INVITE LINK (email failed — share manually):\n${inviteLink}\nCode: ${invite.code}\n`);
  }

  revalidatePath('/admin/team');
  return { success: true, inviteLink, emailError };
}

// ─── Upgrade seat limit ───────────────────────────────────────────────────────


// ─── Email sender (nodemailer or console fallback) ────────────────────────────

async function sendInviteEmail({ to, name, inviteLink, code, companyName }: {
  to: string; name: string; inviteLink: string; code: string; companyName: string;
}) {
  // Try nodemailer if SMTP env vars are set
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const from = process.env.SMTP_FROM ?? user ?? 'noreply@genenet.lab';

  if (host && user && pass) {
    const nodemailer = await import('nodemailer');
    const port = parseInt(process.env.SMTP_PORT ?? '587');
    const transporter = nodemailer.default.createTransport({
      host,
      port,
      secure: port === 465,          // true only for port 465
      requireTLS: port !== 465,      // Office 365 requires STARTTLS on 587
      auth: { user, pass },
      tls: { ciphers: 'SSLv3' },    // needed for Office 365 compatibility
    });

    await transporter.sendMail({
      from: `GeneNet Lab <${from}>`,
      to,
      subject: `You're invited to join ${companyName} on GeneNet`,
      html: inviteEmailHtml({ name, inviteLink, code, companyName }),
    });
  } else {
    // Fallback: log to console (no SMTP configured)
    console.log(`\n📧 INVITE EMAIL (no SMTP configured)\nTo: ${to}\nName: ${name}\nInvite Link: ${inviteLink}\nCode: ${code}\n`);
  }
}

// ─── Test SMTP connection ─────────────────────────────────────────────────────

export async function testSmtp(formData: FormData): Promise<SmtpTestResult> {
  await requireAdmin();
  const to   = formData.get('to') as string;
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const from = process.env.SMTP_FROM ?? user ?? 'noreply@genenet.lab';

  if (!host || !user || !pass) {
    return { error: 'SMTP_HOST, SMTP_USER, and SMTP_PASS must be set in .env' };
  }

  try {
    const nodemailer = await import('nodemailer');
    const port = parseInt(process.env.SMTP_PORT ?? '587');
    const transporter = nodemailer.default.createTransport({
      host,
      port,
      secure: port === 465,
      requireTLS: port !== 465,
      auth: { user, pass },
      tls: { ciphers: 'SSLv3' },
    });

    await transporter.verify();
    await transporter.sendMail({
      from: `GeneNet Lab <${from}>`,
      to: to || user,
      subject: 'GeneNet — SMTP test',
      html: `<p>✅ SMTP is working correctly via <strong>${host}:${port}</strong>.<br>Invite emails will be delivered.</p>`,
    });

    return { success: true, message: `Test email sent to ${to || user}` };
  } catch (err) {
    return { error: String(err instanceof Error ? err.message : err) };
  }
}

function inviteEmailHtml({ name, inviteLink, code, companyName }: {
  name: string; inviteLink: string; code: string; companyName: string;
}) {
  return `
<!DOCTYPE html>
<html>
<body style="font-family: -apple-system, sans-serif; background: #0d1117; color: #e6edf3; margin: 0; padding: 2rem;">
  <div style="max-width: 520px; margin: 0 auto; background: #161b22; border: 1px solid #30363d; border-radius: 16px; padding: 2.5rem;">
    <h1 style="font-size: 1.5rem; margin-bottom: 0.5rem;">🧬 You're invited to GeneNet</h1>
    <p style="color: #8b949e;">Hi ${name || 'there'},</p>
    <p style="color: #8b949e;">You've been invited to join <strong style="color: #e6edf3;">${companyName}</strong> on GeneNet Lab Management Software.</p>

    <div style="background: #0d1117; border: 1px solid #30363d; border-radius: 10px; padding: 1.25rem; margin: 1.5rem 0; text-align: center;">
      <div style="font-size: 0.75rem; color: #8b949e; margin-bottom: 0.5rem;">YOUR INVITE CODE</div>
      <div style="font-size: 1.75rem; font-weight: 800; font-family: monospace; letter-spacing: 0.15em; color: #58a6ff;">${code}</div>
    </div>

    <a href="${inviteLink}" style="display: block; text-align: center; padding: 0.85rem; background: #58a6ff; color: #0d1117; border-radius: 8px; font-weight: 700; text-decoration: none; font-size: 1rem; margin-bottom: 1.5rem;">
      Join the Lab →
    </a>

    <p style="color: #8b949e; font-size: 0.85rem;">Or go to <a href="${inviteLink}" style="color: #58a6ff;">${inviteLink}</a></p>
    <p style="color: #484f58; font-size: 0.75rem; margin-top: 1.5rem;">This invite expires in 7 days. If you didn't expect this email, you can ignore it.</p>
  </div>
</body>
</html>`;
}
