'use server';
import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { prisma } from '@/lib/prisma';
import { requireUser } from '@/lib/auth-guard';
import { verifyPassword } from '@/lib/password';
import { contentHashFor } from '@/lib/signature';
import { isMeaning, type SignableModel } from '@/lib/signature-types';
import {
  POLICIES, checkLimit, recordFailure, recordSuccess,
  failureDelay, describeWait, clientKey, logAttempt,
} from '@/lib/rate-limit';

const SIGNABLE = new Set<SignableModel>(['Procedure', 'Experiment', 'Report']);

export async function signRecord(formData: FormData): Promise<{ ok: true } | { error: string }> {
  const user = await requireUser();

  const model = formData.get('model') as string;
  const recordId = (formData.get('recordId') as string ?? '').trim();
  const meaning = (formData.get('meaning') as string ?? '').trim();
  const password = formData.get('password') as string ?? '';
  const note = ((formData.get('note') as string) ?? '').trim() || null;

  if (!SIGNABLE.has(model as SignableModel)) return { error: 'That kind of record cannot be signed.' };
  if (!recordId) return { error: 'No record to sign.' };
  if (!isMeaning(meaning)) return { error: 'Choose what your signature means.' };
  if (!password) return { error: 'Enter your password to sign.' };

  // The password prompt is the second authentication component Part 11 asks
  // for, so it is also a place someone could guess at. Same limiter as login.
  const key = clientKey(await headers(), 'signature');
  const gate = checkLimit(key, POLICIES.login);
  if (!gate.allowed) {
    logAttempt('signature', key, 'locked');
    return { error: `Too many attempts. Try again in ${describeWait(gate.retryAfterMs)}.` };
  }

  const full = await prisma.user.findUnique({
    where: { id: user.id },
    select: { passwordHash: true },
  });
  if (!full?.passwordHash || !verifyPassword(password, full.passwordHash)) {
    const after = recordFailure(key, POLICIES.login);
    logAttempt('signature', key, after.allowed ? 'failed' : 'locked');
    await failureDelay();
    return {
      error: after.allowed
        ? 'That password is not correct. Nothing was signed.'
        : `That password is not correct. Too many attempts -- try again in ${describeWait(after.retryAfterMs)}.`,
    };
  }
  recordSuccess(key);

  // Hash what is being signed, so a later edit cannot make this signature look
  // like an endorsement of text the signer never saw.
  const contentHash = await contentHashFor(model as SignableModel, recordId);
  if (!contentHash) return { error: 'That record no longer exists.' };

  await prisma.signature.create({
    data: {
      model, recordId, meaning, contentHash, note,
      signerId: user.id,
      signerName: user.name,
      signerEmail: user.email,
    },
  });

  const path = model === 'Procedure' ? `/procedures/${recordId}`
    : model === 'Report' ? `/reports/${recordId}`
    : '/experiments';
  revalidatePath(path);
  return { ok: true };
}
