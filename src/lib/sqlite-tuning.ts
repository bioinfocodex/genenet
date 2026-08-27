import 'server-only';
import { prisma } from '@/lib/prisma';

/**
 * Put SQLite into write-ahead logging.
 *
 * The default journal mode takes an exclusive lock on the whole database for
 * the duration of every write, so while one person saves a report everyone
 * else's page load waits for it. Measured on this schema with one writer under
 * sustained load and one reader doing what a page load does:
 *
 *                        writes/3s   reads/3s   read p95   worst read
 *   rollback journal        5,952        851     10.8 ms      96.7 ms
 *   WAL                    18,470      1,989      4.2 ms       5.6 ms
 *
 * Readers no longer queue behind the writer at all, which is the difference
 * between a lab that feels responsive with six people in it and one that does
 * not.
 *
 * journal_mode is stored in the database header, so this runs once and every
 * later connection and restart inherits it. synchronous is deliberately left
 * at FULL: NORMAL is faster still, but it trades away the guarantee that a
 * committed transaction survives an unexpected power loss, and a lab notebook
 * is the wrong place to make that trade.
 *
 * Prisma already sets busy_timeout=5000 and foreign_keys=ON per connection, so
 * neither needs setting here -- worth knowing, because it is why concurrent
 * writes queue rather than fail today.
 *
 * Note this makes a live database three files, not one: the -wal and -shm
 * companions. That is the second reason the database must not sit in a cloud
 * sync folder; see db-location.ts.
 */
export async function applySqliteTuning(): Promise<void> {
  const url = process.env.DATABASE_URL ?? '';
  // Postgres and friends manage their own concurrency.
  if (!url.startsWith('file:')) return;

  try {
    const before = await currentJournalMode();
    if (before === 'wal') return; // already done on a previous run

    // $queryRawUnsafe, not $executeRawUnsafe: this PRAGMA returns the resulting
    // mode as a row, and Prisma rejects a statement that returns rows from
    // execute with "Execute returned results, which is not allowed". The mode
    // did get set through that error, which made the failure path look like it
    // was working -- exactly the kind of accident worth not depending on.
    const applied = await prisma.$queryRawUnsafe<Array<{ journal_mode: string }>>(
      'PRAGMA journal_mode=WAL',
    );
    const after = String(applied?.[0]?.journal_mode ?? '').toLowerCase() || await currentJournalMode();

    if (after === 'wal') {
      console.log('[genenet] SQLite journal mode set to WAL (readers no longer block on writes)');
    } else {
      console.warn(
        `[genenet] could not switch SQLite to WAL (still "${after}"). ` +
        'This usually means the database is on a network share, which does not ' +
        'support the shared memory WAL needs. Concurrent use will be slower.',
      );
    }
  } catch (e) {
    // Never let tuning stop the server from starting. Include the error type:
    // Prisma's raw-query messages are multi-line and sometimes blank, which
    // makes a bare message read as though nothing went wrong.
    const detail = e instanceof Error
      ? `${e.constructor.name}: ${(e.message || '(no message)').split('\n').filter(Boolean)[0]}`
      : String(e);
    console.warn('[genenet] SQLite tuning skipped -', detail);
  }
}

async function currentJournalMode(): Promise<string> {
  const rows = await prisma.$queryRawUnsafe<Array<{ journal_mode: string }>>('PRAGMA journal_mode');
  return String(rows?.[0]?.journal_mode ?? '').toLowerCase();
}
