import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  EVENTS, isEvent, sign, verify, MAX_SIGNATURE_AGE_S,
  retryDelay, outcomeOf, MAX_ATTEMPTS, problemWithUrl, examplePayload,
} from '../src/lib/webhooks.ts';

const SECRET = 'whsec_a_long_random_string';
const BODY = JSON.stringify({ event: 'sample.used', id: 'whd_1' });
const NOW = Date.parse('2026-10-21T09:30:00.000Z');

describe('proving a delivery came from here', () => {
  test('a signature this made verifies', () => {
    assert.deepEqual(verify(BODY, sign(BODY, SECRET, NOW), SECRET, NOW), { ok: true });
  });

  test('a changed body does not', () => {
    const header = sign(BODY, SECRET, NOW);
    const r = verify(BODY.replace('sample.used', 'sample.created'), header, SECRET, NOW);
    assert.equal(r.ok, false);
    assert.match(r.why!, /does not match/);
  });

  test('the wrong secret does not', () => {
    assert.equal(verify(BODY, sign(BODY, SECRET, NOW), 'whsec_other', NOW).ok, false);
  });

  test('an old signature is refused, so a capture cannot be replayed for ever', () => {
    // The timestamp is inside the signed string rather than beside it. A
    // signature over the body alone stays valid no matter when it arrives.
    const header = sign(BODY, SECRET, NOW);
    const later = NOW + (MAX_SIGNATURE_AGE_S + 60) * 1000;
    const r = verify(BODY, header, SECRET, later);
    assert.equal(r.ok, false);
    assert.match(r.why!, /seconds old/);
  });

  test('a signature from the future is refused too', () => {
    const header = sign(BODY, SECRET, NOW + 3600_000);
    const r = verify(BODY, header, SECRET, NOW);
    assert.equal(r.ok, false);
    assert.match(r.why!, /in the future/);
  });

  test('one still inside the window is accepted', () => {
    const header = sign(BODY, SECRET, NOW);
    assert.ok(verify(BODY, header, SECRET, NOW + (MAX_SIGNATURE_AGE_S - 10) * 1000).ok);
  });

  test('a header that is not a header is refused rather than throwing', () => {
    for (const h of ['', 'nonsense', 't=abc,v1=def', 'v1=abc', 't=1']) {
      const r = verify(BODY, h, SECRET, NOW);
      assert.equal(r.ok, false, h);
    }
  });

  test('a signature of the wrong length does not throw on the comparison', () => {
    // timingSafeEqual throws when the lengths differ, which would leak the
    // length through an exception instead of a comparison.
    const r = verify(BODY, 't=' + Math.floor(NOW / 1000) + ',v1=aa', SECRET, NOW);
    assert.equal(r.ok, false);
  });

  test('the header is in the shape receivers already know', () => {
    assert.match(sign(BODY, SECRET, NOW), /^t=\d+,v1=[0-9a-f]{64}$/);
  });
});

describe('not giving up at the first timeout', () => {
  test('waits double each time, from ten seconds', () => {
    const first = retryDelay(1, 'x');
    const second = retryDelay(2, 'x');
    assert.ok(first >= 9000 && first <= 11000, `${first}`);
    assert.ok(second >= 18000 && second <= 22000, `${second}`);
  });

  test('jitter is deterministic, so a schedule can be reasoned about afterwards', () => {
    assert.equal(retryDelay(3, 'abc'), retryDelay(3, 'abc'));
  });

  test('two deliveries to one endpoint do not come back at the same instant', () => {
    // A hundred deliveries to an endpoint that went down must not all retry
    // together.
    const a = retryDelay(3, 'delivery-a');
    const b = retryDelay(3, 'delivery-b');
    assert.notEqual(a, b);
  });

  test('attempt zero is no wait', () => {
    assert.equal(retryDelay(0), 0);
  });
});

describe('what to do about a response', () => {
  test('2xx is delivered', () => {
    assert.deepEqual(outcomeOf({ status: 200 }, 1), { kind: 'delivered', status: 200 });
    assert.equal(outcomeOf({ status: 204 }, 1).kind, 'delivered');
  });

  test('5xx is tried again', () => {
    const r = outcomeOf({ status: 503 }, 1, 'x');
    assert.equal(r.kind, 'retry');
    assert.ok((r as { inMs: number }).inMs > 0);
  });

  test('4xx is not, because the endpoint understood and refused', () => {
    // Sending it again fifty times is how a webhook becomes a denial of
    // service against somebody who has already said no.
    const r = outcomeOf({ status: 404 }, 1);
    assert.equal(r.kind, 'failed');
    assert.match((r as { why: string }).why, /refusal rather than a hiccup/);
    assert.equal(outcomeOf({ status: 401 }, 1).kind, 'failed');
  });

  test('429 is the exception, because it means not now rather than no', () => {
    const r = outcomeOf({ status: 429 }, 1, 'x');
    assert.equal(r.kind, 'retry');
    assert.match((r as { why: string }).why, /left alone/);
  });

  test('a connection that never answered is tried again', () => {
    const r = outcomeOf({ error: 'connect ETIMEDOUT' }, 2, 'x');
    assert.equal(r.kind, 'retry');
  });

  test('the last attempt gives up rather than scheduling another', () => {
    assert.equal(outcomeOf({ status: 503 }, MAX_ATTEMPTS, 'x').kind, 'failed');
    assert.equal(outcomeOf({ error: 'timeout' }, MAX_ATTEMPTS).kind, 'failed');
  });
});

describe('where a delivery is allowed to go', () => {
  test('an ordinary https endpoint is fine', () => {
    assert.equal(problemWithUrl('https://hooks.example.org/lab'), null);
    assert.equal(problemWithUrl('http://example.org:8080/x?y=1'), null);
  });

  test('addresses inside the machine or the network are refused', () => {
    /*
     * A webhook URL is given by a person and fetched by the server, which is
     * the exact shape of a server-side request forgery.
     */
    for (const url of [
      'http://localhost:5432/',
      'http://127.0.0.1/',
      'http://10.0.0.5/hook',
      'http://192.168.1.10/hook',
      'http://172.16.4.4/hook',
      'http://[::1]/hook',
      'http://printer.local/hook',
    ]) {
      assert.ok(problemWithUrl(url), url);
    }
  });

  test('the cloud metadata service is named, because that is the one that gets stolen', () => {
    assert.match(problemWithUrl('http://169.254.169.254/latest/meta-data/')!, /metadata/);
  });

  test('other protocols are refused', () => {
    assert.ok(problemWithUrl('file:///etc/passwd'));
    assert.ok(problemWithUrl('ftp://example.org/'));
    assert.ok(problemWithUrl('not a url'));
  });

  test('a local address is allowed only when something explicitly asks', () => {
    // Which is what the built-in test endpoint needs, and nothing else.
    assert.equal(problemWithUrl('http://localhost:3000/api/v1/webhook-test', { allowLocal: true }), null);
  });
});

describe('the events on offer', () => {
  test('each has a label and is recognised', () => {
    for (const e of EVENTS) {
      assert.ok(isEvent(e), e);
      assert.ok(examplePayload(e).event === e);
    }
  });

  test('something that is not an event is not one', () => {
    assert.equal(isEvent('sample.exploded'), false);
  });

  test('the example payload carries what a receiver needs to route it', () => {
    const p = examplePayload('sample.used');
    assert.ok(p.id && p.at && p.subject.kind && p.subject.id);
  });
});
