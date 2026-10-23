# Validating a GeneNet deployment

A regulated lab cannot use software because it works. It has to be able to
show that *this copy, on this machine* is the version that was qualified, and
that what it depends on is as it was when somebody signed for it.

This describes what the application can prove about itself, and — just as
importantly — what it cannot. Nothing here makes a lab compliant. It produces
evidence detailed enough to be argued with, which is all a tool can honestly
do; the judgements stay with whoever signs.

## What is already designed for this

These exist because 21 CFR Part 11 and Annex 11 ask for them, and they were
built into the record rather than added over it:

- **Signatures are over content, not over rows.** A notebook entry's signature
  covers a digest of its title, date, body *and the state of every record it
  embeds* (`lib/notebook.ts`, `lib/notebook-embeds.ts`). Editing a construct an
  entry displays makes the entry report that what it shows is not what was
  signed.
- **Signed entries are never edited.** A correction is a new entry that
  supersedes the old one, and both stay readable.
- **An audit log** records who changed what and when (`lib/audit.ts`), with
  dates and binary fields redacted into a readable form rather than serialised
  as `{}`.
- **Sample quantities are computed from recorded uses**, never typed
  (`lib/quantities.ts`), so a remaining amount cannot silently go stale.
- **API tokens are stored hashed**, with a scope and an expiry, and the
  plaintext is shown once.

## Installation qualification

```bash
npm run qualify                 # print the report
npm run qualify -- --out IQ.txt # write it
npm run qualify -- --record     # record this schema as the qualified one
```

It runs against the installation it is in: the real database, the real
environment, the real versions. It exits non-zero when a check fails, so a
deployment pipeline can refuse to finish on an installation that is not what
it should be.

What it checks:

| Check | Fails when |
| --- | --- |
| Application version and revision | — (recorded; a dirty working copy warns) |
| Node runtime | below the version the application needs |
| Database reachable, and which engine | `DATABASE_URL` unset, or the database does not answer |
| Schema matches the qualified one | a table or column is **missing** |
| Session secret | unset or under 32 characters |
| Outbound mail, local webhooks | — (warnings about configuration) |

A column that is *present but unexpected* is a warning rather than a failure.
It does not break the application, but an undocumented change is the thing an
audit is looking for, so it is never silent.

**Record the baseline on the installation being qualified**, and keep
`docs/qualified-schema.json` under change control. A baseline recorded after
the drift it was meant to catch proves nothing.

## Operational qualification

The test suite is the operational evidence: 1,400-odd tests over the
arithmetic a lab depends on — melting temperatures against Biopython, protein
pI against ExPASy ProtParam, Code 128 barcodes decoded back by an independent
scanner, restriction and assembly against known constructs.

```bash
npm test
```

Run it on the deployed installation, not only in CI, and file the output. A
suite that passes on a build server proves the code is right; the same suite
passing on the lab's machine is what proves the deployment is.

## What this does not do

Said plainly, because a validation document that overclaims is worse than none:

- **No electronic signature binding to a biometric or a second factor.** A
  signature here is a logged-in user re-entering their password.
- **No enforced password policy or account lockout beyond the login rate
  limit.** Those are expected to come from the operating environment.
- **No automated archival or retention schedule.** Backups are manual or
  scheduled by the administrator (`lib/backup.ts`), and on PostgreSQL the
  application declines to take one at all rather than producing something that
  is not a backup.
- **No formal change-control workflow inside the application.** Git history
  and this report are the evidence; the process around them is the lab's.
- **The qualification report is not signed by the application.** It is text,
  to be printed and signed by people, because a tool attesting to its own
  correctness attests to nothing.

## PostgreSQL

SQLite is right for one server. PostgreSQL is supported and is exercised by CI
on every change: the schema is derived from the SQLite one
(`npm run schema:postgres`), pushed to a real PostgreSQL instance, and the
suite, build and qualification report all run against it.

Two behaviours differ between the engines and are handled rather than left to
be discovered:

- **Search.** `LIKE` ignores case on SQLite and respects it on PostgreSQL, so
  searching `puc19` would find pUC19 on one and nothing on the other. Every
  search goes through `insensitiveContains` (`lib/db-provider.ts`), which adds
  `mode: "insensitive"` where it is understood.
- **Backups.** `VACUUM INTO` is SQLite's. On PostgreSQL the application refuses
  and points at `pg_dump`, rather than offering a button that half works.

`lib/db-provider.ts` carries the full list, and the qualification report prints
it, so a migration can be ticked off rather than remembered.
