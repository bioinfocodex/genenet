/**
 * Which database this installation is on, and the places that differ.
 *
 * Prisma hides most of the difference between SQLite and PostgreSQL, which is
 * what makes the move a configuration change. It does not hide all of it, and
 * the parts it does not hide are worse for being quiet: a query that works on
 * both and *means* something different on each is harder to find than one that
 * fails outright.
 *
 * This module is the list of those places. Everything in it was found by
 * asking what the same query does on the other engine, rather than by waiting
 * for somebody to migrate and discover it.
 */

export type Provider = 'sqlite' | 'postgresql';

/**
 * The provider implied by a connection string.
 *
 * Read from the URL rather than from the schema, because the schema's provider
 * is fixed at build time and the URL is what the running process is actually
 * talking to. A deployment that changed one and not the other should behave
 * like the database it has, not like the one it was generated for.
 */
export function providerFor(url: string | undefined): Provider {
  if (!url) return 'sqlite';
  return /^postgres(ql)?:\/\//i.test(url.trim()) ? 'postgresql' : 'sqlite';
}

export const provider = (): Provider => providerFor(process.env.DATABASE_URL);

export const isPostgres = () => provider() === 'postgresql';

/**
 * A case-insensitive "contains", on either engine.
 *
 * This is the difference that would have been found by a user rather than by
 * us. SQLite's LIKE is case-insensitive for ASCII by default, so searching
 * "puc19" finds pUC19. PostgreSQL's LIKE is case-sensitive, so the same search
 * finds nothing -- and the search box does not look broken, it looks like the
 * record is not there, which is worse.
 *
 * Prisma spells the fix `mode: 'insensitive'`, which the SQLite connector does
 * not accept at all. So it is added only where it is understood, and the two
 * engines are made to agree rather than left to differ.
 */
export function insensitiveContains(value: string): { contains: string; mode?: 'insensitive' } {
  return isPostgres() ? { contains: value, mode: 'insensitive' } : { contains: value };
}

/** The same, for an exact match that should ignore case. */
export function insensitiveEquals(value: string): { equals: string; mode?: 'insensitive' } {
  return isPostgres() ? { equals: value, mode: 'insensitive' } : { equals: value };
}

/**
 * Whether this engine can take a snapshot of itself.
 *
 * SQLite can, with VACUUM INTO. PostgreSQL's equivalent is pg_dump, which is
 * a separate process with its own credentials and is not something to shell
 * out to from a web request. On Postgres the backup page says so and points at
 * the tooling the database already has, rather than offering a button that
 * half works.
 */
export const canSnapshotInProcess = () => provider() === 'sqlite';

export const SNAPSHOT_NOTE =
  'This installation is on PostgreSQL, where a snapshot is taken with pg_dump by '
  + 'whoever administers the database — it needs credentials and a filesystem this '
  + 'application does not have. Point your existing backup schedule at it instead.';

/**
 * Differences worth knowing before a migration, for the deployment check.
 *
 * Kept as data rather than prose so the validation report can print it and a
 * reader can tick them off, which is what an installation qualification is.
 */
export const PORTABILITY_NOTES: { area: string; note: string }[] = [
  {
    area: 'Search',
    note: 'LIKE is case-insensitive on SQLite and case-sensitive on PostgreSQL. '
      + 'Every search here goes through insensitiveContains, which adds mode: "insensitive" on PostgreSQL.',
  },
  {
    area: 'Backups',
    note: 'VACUUM INTO is SQLite only. On PostgreSQL the backup page refuses rather than '
      + 'producing a file that is not a backup.',
  },
  {
    area: 'Tuning',
    note: 'The WAL and cache settings in lib/sqlite-tuning.ts no-op for a non-file URL, '
      + 'so nothing has to be removed.',
  },
  {
    area: 'Sorting',
    note: 'Text ordering follows the database collation. PostgreSQL sorts by the locale of '
      + 'the database; SQLite sorts by byte. Lists ordered by name may differ in where '
      + 'accented and capitalised names fall.',
  },
  {
    area: 'Migrations',
    note: 'The SQLite database here was built with prisma db push. A PostgreSQL deployment '
      + 'should use prisma migrate deploy against a migrations directory, so the schema is '
      + 'reproducible rather than pushed.',
  },
];
