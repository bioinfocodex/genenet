/**
 * Which files are open, and which one you are looking at.
 *
 * Small enough to look obvious and wrong often enough to be worth pinning
 * down: closing the tab you are on has to land somewhere sensible, opening
 * something already open must not open it twice, and the ceiling has to drop
 * the oldest rather than refuse the newest -- refusing is the behaviour that
 * makes people think the tree is broken.
 */

export const MAX_TABS = 8;

export interface Desk {
  open: string[];
  active: string | null;
}

/** Open a file, or focus it when it is already open. */
export function openTab(desk: Desk, id: string, max = MAX_TABS): Desk {
  if (desk.open.includes(id)) return { open: desk.open, active: id };
  const open = [...desk.open, id];
  return { open: open.length > max ? open.slice(open.length - max) : open, active: id };
}

/**
 * Close a file.
 *
 * Focus moves to the tab on the left, or the right when there is nothing to
 * the left -- what every editor does, and the thing people notice only when
 * it is wrong. Closing a tab you are not looking at leaves your place alone.
 */
export function closeTab(desk: Desk, id: string): Desk {
  const at = desk.open.indexOf(id);
  if (at === -1) return desk;
  const open = desk.open.filter(x => x !== id);
  if (desk.active !== id) return { open, active: open.includes(desk.active ?? '') ? desk.active : open[0] ?? null };
  const active = open[at - 1] ?? open[at] ?? open[0] ?? null;
  return { open, active };
}

/** The desk, as it travels in the URL. */
export function readDesk(open: string | null | undefined, active: string | null | undefined, max = MAX_TABS): Desk {
  const ids = (open ?? '').split(',').map(s => s.trim()).filter(Boolean).slice(0, max);
  // De-duplicated: a hand-edited URL should not open the same file twice.
  const unique = [...new Set(ids)];
  return { open: unique, active: active && unique.includes(active) ? active : unique[0] ?? null };
}

export function writeDesk(desk: Desk): string {
  const q = new URLSearchParams();
  if (desk.open.length) q.set('open', desk.open.join(','));
  if (desk.active) q.set('active', desk.active);
  const s = q.toString();
  return s ? `?${s}` : '';
}
