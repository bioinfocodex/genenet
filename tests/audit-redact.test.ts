import { test } from 'node:test';
import assert from 'node:assert/strict';
import { redact } from '../src/lib/audit.ts';

test('dates are kept as ISO strings, not lost as empty objects', () => {
  const at = new Date('2026-10-13T12:00:00Z');
  assert.deepEqual(redact({ createdAt: at }), { createdAt: '2026-10-13T12:00:00.000Z' });
});

test('binary columns are summarised by size, not copied', () => {
  const data = Buffer.from(new Uint8Array(1234));
  assert.deepEqual(redact({ data, fileName: 'a.ab1' }), { data: '[binary, 1234 bytes]', fileName: 'a.ab1' });
});

test('password hashes are still redacted, nested or not', () => {
  assert.deepEqual(redact({ user: { passwordHash: 'x', name: 'n' } }), { user: { passwordHash: '[redacted]', name: 'n' } });
});
