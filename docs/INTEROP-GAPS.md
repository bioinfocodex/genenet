# Getting data in and out

A second gap analysis against SnapGene and Benchling, this time about
interoperability rather than drawing. The first one
([SNAPGENE-GAPS.md](SNAPGENE-GAPS.md)) asked what the maps cannot show. This
one asks what a lab cannot bring with them.

## What reverse engineering could and could not reach

Worth stating plainly, because the honest answer shaped the rest.

**Benchling cannot be reverse engineered here, and should not be.** It is a
hosted application with no artefact on this machine. The only thing REA could
observe is a browser tab somebody is already signed into, which would show
that person's own workspace rather than anything about how Benchling is
built. Its gaps have to come from its documentation and its interface, which
is where the ones below come from.

**SnapGene is installed**, so its binary could be opened. It was not, beyond
confirming it exists. Taking apart a competitor's program to copy how it
implements a feature is not interoperability; it is lifting protected work,
and the feature list is published anyway. What is legitimate -- and what this
document is about -- is its *file format*, so that files a lab already owns
can be read.

That turned out not to need decompiling either. Biopython ships a documented
reader for the format, and it is already installed on this machine. Reading
an open-source parser is faster than inferring the same thing from compiled
code, and it is authoritative in a way that inference is not.

## The format, as verified

The `.dna` file is a sequence of packets: one type byte, a four-byte
big-endian length, then that many bytes.

| type | holds |
|---|---|
| `0x09` | the cookie that must come first: the string `SnapGene`, then type and version words |
| `0x00` | the bases, behind a flags byte whose low bit means circular |
| `0x0A` | the features, as XML, with ranges, strand and `Segment` elements for spliced ones |
| `0x05` | the primers, as XML |
| `0x06` | the notes, as XML |

Confirmed on a real file rather than from the description: the Addgene
plasmid in Downloads reads as **4,791 bp, circular, with 32 features** --
twenty primer binding sites, six CDSs, two terminators, two promoters, an
origin and a misc feature. All of that is data GeneNet has a column for.

## The gap

**GeneNet cannot open a SnapGene file at all.** The import control accepts
`.gb`, `.gbk`, `.genbank`, `.fasta`, `.fa` and `.fna`. There is no `.dna`,
and no way to add one.

That is worse than it sounds, because of who it affects. A lab that has used
SnapGene has its entire construct history in that format -- the files on this
machine are in Downloads and in OneDrive, which is exactly where they
accumulate. Every one of them has to be opened in SnapGene and re-exported as
GenBank before GeneNet will look at it, and the person doing that is deciding
whether to adopt GeneNet at the same time.

It also runs the other way. There is no way to hand a collaborator a file
they can open in the tool they use.

## What Benchling still has that we do not

From its documentation and interface, not from its code. Lower confidence
than the format work above, and worth checking against a live account before
anybody builds from it.

Most of the Benchling gap is already closed -- the registry, the notebook,
requests and workflows, the API and its Python client, webhooks, single
sign-on and the audit trail all exist. What remains:

**Custom entity schemas.** Benchling lets an organisation define its own
entity types with their own fields and validation -- a construct here has a
vector and an insert, a strain has a genotype and a parent. We have fixed
tables with fixed columns. This is the largest remaining difference and the
one a big lab notices first.

**Registration rules.** Naming schemes and identifier formats that the
registry enforces on entry, rather than a code issued after the fact.

**Granular permissions.** `ProjectMember` exists, but access decisions are
mostly admin-or-not. Benchling has per-project and per-folder roles.

## The phases

Ordered by how many people each one unblocks per week of work.

### Phase 1 — Read SnapGene files

Import `.dna`: bases, topology, features with their strands and spliced
segments, primers, and notes. A parser in `src/lib/`, tested against real
files rather than invented ones -- the three on this machine, and a circular
and a linear example at minimum.

The parser must be defensive about packets it does not know. The format has
types beyond the five above, and skipping an unrecognised packet by its
declared length is what lets a file written by a newer version still open.

**Why first:** it is the difference between a lab being able to try GeneNet
and not.

### Phase 2 — Write SnapGene files

Export `.dna` so a collaborator can open what we made. Harder than reading,
because a file we write has to be one SnapGene accepts, and the only way to
know is to open it there.

Worth doing with a round trip as the test: read one of the real files, write
it back, and compare what the parser sees of both.

### Phase 3 — Custom entity schemas

Let an installation define its own entity types and fields, with validation,
rather than taking the columns we chose. The large piece of work here, and
the one that decides whether GeneNet fits a lab's own vocabulary or asks the
lab to use ours.

Naming and identifier rules belong with it, since both are about what the
registry demands on entry.

### Phase 4 — Permissions worth the name

Per-project and per-folder roles rather than admin-or-not. Smaller than
Phase 3 and dependent on nothing in it, so it can be taken whenever a
multi-group installation needs it.

## How to tell whether it worked

| | now | after |
|---|---|---|
| a lab's SnapGene library | re-export every file by hand | opens directly |
| sending a construct to a SnapGene user | they cannot open it | they can |
| a construct's own fields | ours | theirs |
| who can see a project | admin, or everyone | the people on it |

## What this does not cover

The drawing gaps are in [SNAPGENE-GAPS.md](SNAPGENE-GAPS.md) and the layout
work in [UI-REDESIGN.md](UI-REDESIGN.md). The minimap is the one item still
open there.
