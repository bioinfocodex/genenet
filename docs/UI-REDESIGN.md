# Giving the window back to the sequence

A plan, in phases, for the sequence editor's chrome: the menu bar, the
toolbars, and the circular and linear maps.

This is a plan only. Nothing here is implemented yet.

## What is actually wrong

Measured in the running app at 1440x900, on a 4,927 bp plasmid.

| | circular map | linear map |
|---|---|---|
| drawing size | 484 x 484 | 484 x 183 |
| share of the window | **18.1%** | **6.8%** |
| chrome stacked above it | 353 px (39% of height) | 547 px (61% of height) |
| page height needed | 1403 px | 1198 px |

The last row is the part to sit with: the window is 900 px tall and the page
needs 1403 px, so the map cannot be seen whole without scrolling, and
scrolling pushes the toolbar that drives it off the top.

### Where the height goes

Everything is stacked horizontally, one band on top of another, before the
drawing is allowed to start:

```
  0  ┌────────────────────────────────────────┐
     │ global header (search, avatar)      70 │
 102 │ breadcrumb                          20 │
 142 │ title block (name, badges, button) 122 │
 309 │ menu bar: File Edit Features …      33 │
 342 │ toolbar row: enzymes, sites, draw   ~. │
 353 ├────────────────────────────────────────┤
     │ the map finally begins                 │
```

### Where the width goes

```
  sidebar  gutter  tab rail   map      stats
   260       32      178      518       272     = 1440
   18%                12%     36%       19%
```

The map column is declared `flex: 1 1 360px` and so competes as an equal with
the rail and the statistics panel rather than being the thing the page is for.
The SVG's own `max-width: 800px` never comes into play; the column runs out
first at 518 px.

## What Benchling and SnapGene do instead

Both reach the same answer from different directions, and it is not "smaller
buttons".

**Chrome lives on a vertical edge, not in a horizontal stack.** SnapGene's map
controls are a side toolbar of icon buttons, each opening a dropdown for the
detail; the circular and linear switch is two buttons on that toolbar rather
than a row of its own. A vertical rail costs width once, and width is what a
16:9 window has spare. Our stack costs height five times over, and height is
what it has least of.

**Panels collapse.** Benchling's side panels close by clicking the icon that
opened them, so the editor is one key away from filling the window.

**The drawing is allowed to get shorter.** SnapGene 5.1 changed linear maps so
enzyme sites and annotations may overlap, specifically to reduce map height
while keeping them legible. Our linear map at 183 px tall is not tall because
the sequence needs it; it is tall because nothing is allowed to overlap.

## The phases

Each phase stands alone, ships on its own, and has a number to check it
against. They are ordered by payoff per unit of risk, so stopping after any
one of them still leaves things better.

---

### Phase 1 — Collapse the stack into one bar

**Target:** chrome above the drawing from 353 px to **under 120 px**.

Fold the breadcrumb, the title block and the menu bar into a single bar about
44 px tall: name on the left, the File/Edit/Features menus next to it, actions
on the right. The metadata now taking 122 px (length, topology, GC content,
enzyme and feature counts) moves to a status strip along the bottom edge,
where SnapGene keeps the same information — it is reference, not navigation,
and reference does not belong above the thing it describes.

**Risk:** low. Rearranging existing controls, no behaviour change.

---

### Phase 2 — Make the editor fit the window

**Target:** no page scroll at 1440x900; the map column at **55% or more** of
content width.

Today the page grows and the window scrolls. Instead the editor should be a
full-height column that fits the viewport exactly: the bar from Phase 1 at the
top, the status strip at the bottom, and the canvas taking everything between
and scrolling internally when it must. The map column loses `flex: 1 1 360px`
and becomes the one element that absorbs free space.

Comments move off the bottom of the page into the side panel of Phase 4;
today they sit below the map and are the main reason the document reaches
1403 px.

**Risk:** medium. Full-height flex layouts interact with the print route,
which must stay paginated — it deliberately does not fit a window.

---

### Phase 3 — One vertical rail instead of two horizontal bars

**Target:** 178 px tab rail + 33 px menu row becomes a **single 56 px rail**,
returning about 120 px of width and a full band of height.

The Map / Sequence / Features / Enzymes / Primers / ORFs / Translation tabs
and the map's own display controls become one narrow icon rail down the left
of the canvas, in SnapGene's arrangement: an icon per view, each with a
dropdown carrying the options that currently need a row of their own. Circular
and linear become two buttons on that rail rather than a separate control.

Icons need labels on hover and a tooltip that names the keyboard shortcut; an
unlabelled rail is faster for the daily user and worse for everyone else, so
the rail should be expandable to show labels, and remember that choice.

**Risk:** medium. This is the phase that changes muscle memory. Worth shipping
behind a preference that defaults to the new rail, with the old layout
available for a release.

---

### Phase 4 — Panels that get out of the way

**Target:** with panels collapsed, the map gets **70% or more** of window
width — against 36% today.

Statistics and comments become one right-hand panel with tabs, collapsing to a
narrow strip on click, in Benchling's pattern. The collapsed state is
remembered per person rather than reset on every navigation.

A full-width mode that hides the workspace sidebar as well belongs here too:
one key for "just the map", which is what somebody checking an insert's
orientation actually wants.

**Risk:** low, given Phase 2. Mostly state and persistence.

---

### Phase 5 — Make the drawing itself worth the space

The first four phases hand the map the window. This one earns it.

**Linear map.** Let annotations overlap rather than reserving a row each —
the change SnapGene made in 5.1 — which is what collapses 183 px of mostly
empty height. Then use the width that Phase 2 frees: more bases per row, and
a wrapped multi-row mode for reading a region closely.

**Circular map.** The drawing is 484 px across because its column is; at 800
it can carry labels that currently collide and get dropped. Add zoom-to-fit
and zoom-to-selection, so a 4,927 bp plasmid and a 250 kb chromosome are both
legible.

**Both.** A density control — comfortable and compact — because a shared
screen in a lab meeting and a laptop at a bench are not the same problem.

**Risk:** medium to high, and the only phase that changes what is drawn rather
than where. It wants the browser-verification loop the rest of the project
uses: render a known plasmid, compare before and after, check label collisions
at several zoom levels.

---

## How to tell whether it worked

The same measurements, rerun. Numbers rather than impressions, because
"cleaner" is not checkable and these are.

| measure | now | after |
|---|---|---|
| circular map, share of window | 18.1% | 45% or more |
| linear map, share of window | 6.8% | 25% or more |
| chrome above the drawing | 353 px | under 120 px |
| page height at 1440x900 | 1403 px | 900 px, no scroll |
| map share of width, panels open | 36% | 55% or more |
| map share of width, panels closed | n/a | 70% or more |

Worth checking at 1280x800 as well, which is a 13-inch laptop and the case
where the current layout is worst.

## Two things deliberately not in this plan

**The colours, type and spacing are not the problem.** They may want work, but
the measurements say the problem is layout, and changing both at once makes it
impossible to tell which helped.

**Molbuilder find and replace is still a stub** — `onFind` does nothing and
`onReplace` computes a replacement, discards it, and says so in an alert.
That is a missing feature rather than a layout fault, and it should not be
folded into this work.

## Sources

- [SnapGene: set view options in Map and Sequence views](https://support.snapgene.com/hc/en-us/articles/10383749614612-Set-View-Options-for-DNA-and-RNA-Sequences-in-Map-and-Sequence-views)
- [SnapGene: display a circular plasmid as a linear map](https://support.snapgene.com/hc/en-us/articles/10383772948884-Display-a-Circular-Plasmid-as-a-Linear-Horizontal-Map)
- [SnapGene 5.1.0 release notes — overlapping annotations to reduce map height](https://www.snapgene.com/updates/snapgene-5-1-0-release-notes)
- [Benchling: the basics, including collapsing side panels](https://help.benchling.com/hc/en-us/articles/9684234496013-The-Basics-of-Benchling)
- [Benchling: the molecular biology toolbar and its placement](https://help.benchling.com/hc/en-us/articles/13527975078029-Why-is-my-Molecular-Biology-toolbar-on-the-left-side-and-not-the-right-side)
