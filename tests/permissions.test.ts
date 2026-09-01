import test from 'node:test';
import assert from 'node:assert/strict';
import {
  satisfies, isLevel, checkAccess, visibleProjectFilter, visibleByProjectFilter,
  effectiveMembers, canRemoveMember,
} from '../src/lib/permissions.ts';

const member = { id: 'u1', role: 'MEMBER' };
const admin = { id: 'a1', role: 'ADMIN' };
const open = { id: 'p1', restricted: false };
const shut = { id: 'p2', restricted: true };

test('levels are ordered, and a higher one satisfies a lower', () => {
  assert.equal(satisfies('MANAGE', 'VIEW'), true);
  assert.equal(satisfies('MANAGE', 'EDIT'), true);
  assert.equal(satisfies('EDIT', 'VIEW'), true);
  assert.equal(satisfies('EDIT', 'EDIT'), true);
  assert.equal(satisfies('VIEW', 'EDIT'), false);
  assert.equal(satisfies('EDIT', 'MANAGE'), false);
});

test('only the three known levels are levels', () => {
  assert.equal(isLevel('VIEW'), true);
  assert.equal(isLevel('OWNER'), false);
  assert.equal(isLevel('view'), false);
});

test('an existing install does not change behaviour: open projects stay open', () => {
  // This is the whole point of the restricted flag defaulting to false. If
  // this test fails, upgrading locks a lab out of its own data.
  for (const level of ['VIEW', 'EDIT'] as const) {
    const r = checkAccess({ project: open, membership: null, user: member }, level);
    assert.equal(r.allowed, true, level);
  }
});

test('a record belonging to no project is governed by workspace role alone', () => {
  const r = checkAccess({ project: null, membership: null, user: member }, 'EDIT');
  assert.equal(r.allowed, true);
});

test('a restricted project is closed to a non-member', () => {
  const r = checkAccess({ project: shut, membership: null, user: member }, 'VIEW');
  assert.equal(r.allowed, false);
  assert.match(r.reason, /restricted and you have not been added/);
  assert.equal(r.level, null);
});

test('a member of a restricted project gets exactly the level they hold', () => {
  const viewer = { project: shut, membership: { level: 'VIEW' }, user: member };
  assert.equal(checkAccess(viewer, 'VIEW').allowed, true);
  const denied = checkAccess(viewer, 'EDIT');
  assert.equal(denied.allowed, false);
  assert.match(denied.reason, /needs can edit; you have can view/);

  const editor = { project: shut, membership: { level: 'EDIT' }, user: member };
  assert.equal(checkAccess(editor, 'EDIT').allowed, true);
  assert.equal(checkAccess(editor, 'MANAGE').allowed, false);

  const manager = { project: shut, membership: { level: 'MANAGE' }, user: member };
  assert.equal(checkAccess(manager, 'MANAGE').allowed, true);
});

test('a membership row with a nonsense level is treated as the weakest, not the strongest', () => {
  const r = checkAccess({ project: shut, membership: { level: 'SUPERUSER' }, user: member }, 'EDIT');
  assert.equal(r.allowed, false);
  assert.equal(r.level, 'VIEW');
});

test('nobody but an admin can manage an open project', () => {
  // Otherwise any member could restrict a project and lock everyone else out,
  // which leaves the restriction switch itself unprotected.
  const r = checkAccess({ project: open, membership: null, user: member }, 'MANAGE');
  assert.equal(r.allowed, false);
  assert.match(r.reason, /Only a workspace admin/);
  assert.equal(checkAccess({ project: open, membership: null, user: admin }, 'MANAGE').allowed, true);
});

test('a workspace admin passes everything, deliberately', () => {
  for (const project of [open, shut, null]) {
    for (const level of ['VIEW', 'EDIT', 'MANAGE'] as const) {
      const r = checkAccess({ project, membership: null, user: admin }, level);
      assert.equal(r.allowed, true, `${project?.id ?? 'none'} ${level}`);
    }
  }
});

test('the project filter hides restricted projects a user is not in', () => {
  const f = visibleProjectFilter(member) as { OR: unknown[] };
  assert.equal(f.OR.length, 2);
  assert.deepEqual(f.OR[0], { restricted: false });
  assert.deepEqual(f.OR[1], { members: { some: { userId: 'u1' } } });
  // An admin's filter is empty: they see everything.
  assert.deepEqual(visibleProjectFilter(admin), {});
});

test('the record filter keeps unfiled records visible', () => {
  // Leaving this branch out would quietly remove every record with no project
  // from every list, which looks exactly like data loss.
  const f = visibleByProjectFilter(member) as { OR: unknown[] };
  assert.deepEqual(f.OR[0], { projectId: null });
  assert.equal(f.OR.length, 3);
  assert.deepEqual(visibleByProjectFilter(admin), {});
});

test('the member list includes admins, who hold access without a row', () => {
  const members = [
    { userId: 'u1', level: 'VIEW', user: { name: 'Ann', email: 'a@x' } },
    { userId: 'u2', level: 'EDIT', user: { name: 'Bo', email: 'b@x' } },
  ];
  const admins = [{ id: 'a1', name: 'Zed', email: 'z@x' }];
  const view = effectiveMembers(members, admins);

  assert.equal(view.length, 3);
  // Sorted by level, so the strongest access reads first.
  assert.equal(view[0].userId, 'a1');
  assert.equal(view[0].level, 'MANAGE');
  assert.equal(view[0].implicit, true, 'an admin holds access without a membership row');
  assert.deepEqual(view.slice(1).map(v => v.userId), ['u2', 'u1']);
});

test('an admin who also has a membership row appears once', () => {
  const members = [{ userId: 'a1', level: 'VIEW', user: { name: 'Zed', email: 'z@x' } }];
  const admins = [{ id: 'a1', name: 'Zed', email: 'z@x' }];
  const view = effectiveMembers(members, admins);
  assert.equal(view.length, 1);
  assert.equal(view[0].implicit, false, 'the explicit row wins');
});

test('a project with no members but three admins does not read as "nobody has access"', () => {
  const view = effectiveMembers([], [
    { id: 'a1', name: 'A', email: 'a@x' },
    { id: 'a2', name: 'B', email: 'b@x' },
    { id: 'a3', name: 'C', email: 'c@x' },
  ]);
  assert.equal(view.length, 3);
});

test('the last manager cannot be removed', () => {
  const members = [
    { userId: 'u1', level: 'MANAGE' },
    { userId: 'u2', level: 'EDIT' },
  ];
  const r = canRemoveMember(members, 'u1');
  assert.equal(r.allowed, false);
  assert.match(r.reason, /only person who can manage/);
  // Removing anyone else is fine.
  assert.equal(canRemoveMember(members, 'u2').allowed, true);
});

test('one of two managers can be removed', () => {
  const members = [
    { userId: 'u1', level: 'MANAGE' },
    { userId: 'u2', level: 'MANAGE' },
  ];
  assert.equal(canRemoveMember(members, 'u1').allowed, true);
});
