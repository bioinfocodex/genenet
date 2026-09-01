/**
 * Access below the level of workspace role.
 *
 * ADMIN and MEMBER answer "does this person work here". They cannot answer the
 * question a lab actually has the first time a rotation student or an external
 * collaborator arrives: this person should see one project and nothing else.
 *
 * The design constraint that shapes everything here: an existing install must
 * not change behaviour on upgrade. If projects became private by default,
 * everyone would lose access to everything the moment this shipped. So a
 * project is open until it is marked restricted, and only then do memberships
 * decide. That is a deliberate trade — it means access is opt-in to restrict
 * rather than opt-in to grant, which is the weaker default — and it is the only
 * version that can be turned on in a running lab without a migration day.
 */

export const LEVELS = ['VIEW', 'EDIT', 'MANAGE'] as const;
export type Level = (typeof LEVELS)[number];

export const LEVEL_LABELS: Record<Level, string> = {
  VIEW: 'Can view',
  EDIT: 'Can edit',
  MANAGE: 'Can manage',
};

export const LEVEL_DESCRIPTIONS: Record<Level, string> = {
  VIEW: 'Read everything in the project. Cannot change anything.',
  EDIT: 'Add and change records in the project.',
  MANAGE: 'Everything in Edit, plus adding and removing people.',
};

const RANK: Record<Level, number> = { VIEW: 1, EDIT: 2, MANAGE: 3 };

/** True when `held` is at least as permissive as `needed`. */
export function satisfies(held: Level, needed: Level): boolean {
  return RANK[held] >= RANK[needed];
}

export function isLevel(v: string): v is Level {
  return (LEVELS as readonly string[]).includes(v);
}

export interface AccessInput {
  /** The project, or null when the record belongs to no project. */
  project: { id: string; restricted: boolean } | null;
  /** The membership row for this user on this project, if any. */
  membership: { level: string } | null;
  user: { id: string; role: string };
}

export interface AccessResult {
  allowed: boolean;
  /** Why, in words that can be shown to the person refused. */
  reason: string;
  /** The level the user effectively holds, for deciding what to render. */
  level: Level | null;
}

/**
 * Whether this user may act on this project at this level.
 *
 * Workspace admins pass everything. That is a real decision rather than an
 * oversight: an admin can already read the database, edit any record through
 * the admin panel, and change their own role back. Pretending a project
 * restriction constrains them would be security theatre, and worse, it would
 * make an admin locked out of a project believe the restriction meant something
 * it does not.
 */
export function checkAccess(input: AccessInput, needed: Level): AccessResult {
  const { project, membership, user } = input;

  if (user.role === 'ADMIN') {
    return { allowed: true, reason: 'Workspace admin.', level: 'MANAGE' };
  }

  // A record attached to no project is governed by workspace role alone.
  if (!project) {
    return { allowed: true, reason: 'Not part of a restricted project.', level: 'EDIT' };
  }

  if (!project.restricted) {
    // An open project grants edit, never manage. Managing membership is what
    // restricting a project is *for*, so letting any member do it on an open
    // project would leave the restriction switch itself unprotected — anyone
    // could restrict a project and lock everyone else out of it.
    if (needed === 'MANAGE') {
      return {
        allowed: false,
        reason: 'Only a workspace admin can change who has access to an open project.',
        level: 'EDIT',
      };
    }
    return { allowed: true, reason: 'This project is open to the workspace.', level: 'EDIT' };
  }

  if (!membership) {
    return {
      allowed: false,
      reason: 'This project is restricted and you have not been added to it.',
      level: null,
    };
  }

  const held = isLevel(membership.level) ? membership.level : 'VIEW';
  if (satisfies(held, needed)) {
    return { allowed: true, reason: `You have ${LEVEL_LABELS[held].toLowerCase()} on this project.`, level: held };
  }

  return {
    allowed: false,
    reason: `This needs ${LEVEL_LABELS[needed].toLowerCase()}; you have ${LEVEL_LABELS[held].toLowerCase()}.`,
    level: held,
  };
}

/**
 * The `where` clause that hides restricted projects a user is not in.
 *
 * Returned as a filter rather than applied by the caller so that every list
 * query uses the same logic. A list that forgets it leaks the existence of
 * records — and the names of restricted projects are often the thing that most
 * needs hiding.
 */
export function visibleProjectFilter(user: { id: string; role: string }) {
  if (user.role === 'ADMIN') return {};
  return {
    OR: [
      { restricted: false },
      { members: { some: { userId: user.id } } },
    ],
  };
}

/**
 * The same idea for records that hang off a project.
 *
 * `projectId: null` has to be included explicitly: a record belonging to no
 * project is not hidden by a project restriction, and leaving it out of the
 * filter would quietly remove every unfiled record from every list.
 */
export function visibleByProjectFilter(user: { id: string; role: string }) {
  if (user.role === 'ADMIN') return {};
  return {
    OR: [
      { projectId: null },
      { project: { restricted: false } },
      { project: { members: { some: { userId: user.id } } } },
    ],
  };
}

export interface MemberView {
  userId: string;
  name: string;
  email: string;
  level: Level;
  /** True for workspace admins, who hold access without a membership row. */
  implicit: boolean;
}

/**
 * Everyone who can reach a project, memberships and admins together.
 *
 * Listing only the membership rows would show an empty list for a project that
 * three admins can read, which reads as "nobody has access" and is wrong in the
 * direction that matters.
 */
export function effectiveMembers(
  members: { userId: string; level: string; user: { name: string; email: string } }[],
  admins: { id: string; name: string; email: string }[],
): MemberView[] {
  const out: MemberView[] = members.map(m => ({
    userId: m.userId,
    name: m.user.name,
    email: m.user.email,
    level: isLevel(m.level) ? m.level : 'VIEW',
    implicit: false,
  }));

  const named = new Set(out.map(m => m.userId));
  for (const a of admins) {
    if (named.has(a.id)) continue;
    out.push({ userId: a.id, name: a.name, email: a.email, level: 'MANAGE', implicit: true });
  }

  return out.sort((a, b) =>
    RANK[b.level] - RANK[a.level] ||
    Number(a.implicit) - Number(b.implicit) ||
    a.name.localeCompare(b.name));
}

/**
 * Refuse to leave a restricted project with nobody who can manage it.
 *
 * Not a theoretical worry: removing the last manager from a project no admin
 * happens to be watching leaves a project only the database can fix.
 */
export function canRemoveMember(
  members: { userId: string; level: string }[], userId: string,
): { allowed: boolean; reason: string } {
  const managers = members.filter(m => m.level === 'MANAGE');
  if (managers.length === 1 && managers[0].userId === userId) {
    return {
      allowed: false,
      reason: 'This is the only person who can manage the project. Give someone else Can manage first.',
    };
  }
  return { allowed: true, reason: '' };
}
