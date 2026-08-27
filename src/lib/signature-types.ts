/**
 * The parts of the signature model that both sides need.
 *
 * Deliberately free of 'server-only' and of any server import. The signing UI
 * is a client component and needs the list of meanings to render the choices;
 * importing them from lib/signature.ts pulled Prisma, next/headers and the
 * session into the client bundle, which fails the build.
 */

export type SignableModel = 'Procedure' | 'Experiment' | 'Report';

/**
 * What a signature asserts. 21 CFR Part 11 requires the meaning to be recorded
 * and displayed, because authorship, review, approval and witnessing are
 * different claims and a signature that does not say which is not evidence of
 * anything in particular.
 */
export const MEANINGS = {
  authored:  'I wrote this record',
  reviewed:  'I have reviewed this record',
  approved:  'I approve this record',
  witnessed: 'I witnessed this work being performed',
} as const;

export type Meaning = keyof typeof MEANINGS;

export function isMeaning(v: string): v is Meaning {
  return Object.prototype.hasOwnProperty.call(MEANINGS, v);
}

export interface SignatureView {
  id: string;
  at: Date;
  meaning: Meaning;
  meaningText: string;
  signerName: string;
  signerEmail: string;
  note: string | null;
  /** False when the record changed after this signature was applied. */
  current: boolean;
}
