'use server';
import { requireUser } from '@/lib/auth-guard';
import { startSearch, collect, type Collected, type StartedSearch, type Refused } from '@/lib/blast-service';
import {
  PROGRAMS, DATABASES, type BlastProgram, type BlastDatabase,
} from '@/lib/blast';

/**
 * Sending a search to NCBI, on behalf of somebody logged in.
 *
 * Guarded, and not only because the rest of the application is. These two
 * actions are callable endpoints that make the lab's server contact a third
 * party, and an unauthenticated one would let a passer-by spend the
 * institution's daily allowance -- after which nobody in the building can
 * BLAST anything until it rolls over.
 */

/** Only the identifiers this version knows, whatever arrives in the form. */
function readProgram(v: FormDataEntryValue | null): BlastProgram | null {
  const found = PROGRAMS.find(p => p.id === v);
  return found ? found.id : null;
}
function readDatabase(v: FormDataEntryValue | null): BlastDatabase | null {
  return typeof v === 'string' && v in DATABASES ? (v as BlastDatabase) : null;
}

export async function runBlast(formData: FormData): Promise<StartedSearch | Refused> {
  await requireUser();

  const query = (formData.get('query') as string | null) ?? '';
  const program = readProgram(formData.get('program'));
  const database = readDatabase(formData.get('database'));
  if (!program || !database) {
    return { ok: false, error: 'That program or database is not one this version offers.' };
  }

  const expect = Number(formData.get('expect'));
  const title = (formData.get('title') as string | null) ?? undefined;

  return startSearch({
    query,
    program,
    database,
    expect: Number.isFinite(expect) && expect > 0 ? expect : undefined,
    title: title?.trim() || undefined,
  });
}

export async function checkBlast(formData: FormData): Promise<Collected> {
  await requireUser();
  const rid = (formData.get('rid') as string | null)?.trim() ?? '';
  /*
   * NCBI's request ids are upper-case alphanumeric. Checked because this value
   * goes into a URL sent to a third party, and an id from a form is not an id
   * until something says so.
   */
  if (!/^[A-Z0-9]{6,32}$/.test(rid)) {
    return { ok: false, state: 'failed', error: 'That is not a BLAST request id.' };
  }
  return collect(rid);
}
