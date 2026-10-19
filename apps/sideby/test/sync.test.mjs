import test from 'node:test';
import assert from 'node:assert/strict';
import { planCorrection, projectedPosition, significantChange, formatTime } from '../ui/lib/sync.mjs';
import { ClockSync } from '../ui/lib/clock.mjs';
import { generateCode, parseInvite, formatCode, findInviteLink, inviteText } from '../ui/lib/codes.mjs';

const pb = (o = {}) => ({ t: 100, paused: false, rate: 1, at: 10_000, live: false, lag: null, duration: 600, ...o });
const local = (o = {}) => ({ t: 100, paused: false, rate: 1, duration: 600, ...o });

test('projects host position forward while playing', () => {
  assert.equal(projectedPosition(pb(), 12_000), 102);
  assert.equal(projectedPosition(pb({ paused: true }), 12_000), 100);
  assert.equal(projectedPosition(pb({ rate: 2 }), 11_000), 102);
});

test('in sync needs no command', () => {
  const r = planCorrection(local({ t: 102.05 }), pb(), 12_000);
  assert.equal(r.status, 'synced');
  assert.equal(r.cmd, null);
});

test('small drift nudges playback rate, large drift seeks', () => {
  const behind = planCorrection(local({ t: 101.5 }), pb(), 12_000);
  assert.equal(behind.status, 'catching-up');
  assert.ok(behind.cmd.rate > 1);
  const ahead = planCorrection(local({ t: 102.6 }), pb(), 12_000);
  assert.ok(ahead.cmd.rate < 1);
  const far = planCorrection(local({ t: 50 }), pb(), 12_000);
  assert.equal(far.cmd.seek, 102);
});

test('seek cooldown prevents seek loops but pause still applies', () => {
  const r = planCorrection(local({ t: 50 }), pb(), 12_000, { localNow: 5000, lastSeekAt: 4500 });
  assert.equal(r.cmd, null);
  const p = planCorrection(local({ t: 100 }), pb({ paused: true }), 12_000);
  assert.equal(p.cmd.paused, true);
});

test('ads and different videos are not fought', () => {
  assert.equal(planCorrection(local({ ad: true }), pb(), 12_000).status, 'ad');
  assert.equal(planCorrection(local({ duration: 30 }), pb(), 12_000).status, 'mismatch');
});

test('live streams align by distance behind the live edge', () => {
  const host = pb({ live: true, lag: 6, duration: Infinity, t: 5000 });
  const ok = planCorrection(local({ live: true, lag: 7, duration: Infinity, t: 9000 }), host, 12_000);
  assert.equal(ok.status, 'live-synced');
  const far = planCorrection(local({ live: true, lag: 20, duration: Infinity }), host, 12_000);
  assert.equal(far.cmd.seekLag, 6);
});

test('significant change detection', () => {
  const a = pb();
  assert.equal(significantChange(a, { ...a, t: 102.1, at: 12_000 }, 12_000), false);
  assert.equal(significantChange(a, { ...a, t: 130, at: 12_000 }, 12_000), true);
  assert.equal(significantChange(a, { ...a, paused: true }, 10_000), true);
});

test('clock sync picks low-latency samples', () => {
  const c = new ClockSync();
  c.add(0, 5050, 100);   // offset 5000, rtt 100
  c.add(200, 5210, 220); // offset 5000, rtt 20
  c.add(300, 9000, 900); // noisy, rtt 600
  assert.equal(c.offset, 5000);
  assert.equal(c.rtt, 20);
});

test('room codes round-trip through every invite format', () => {
  for (let i = 0; i < 200; i++) {
    const code = generateCode();
    assert.match(code, /^[2-9A-HJKMNP-Z]{9}$/);
    assert.equal(parseInvite(formatCode(code)), code);
    assert.equal(parseInvite(`sideby://join/${code}`), code);
    assert.equal(parseInvite(formatCode(code).toLowerCase()), code);
    assert.equal(findInviteLink(inviteText(code, { name: 'Bilal' })), code);
    assert.equal(parseInvite(inviteText(code)), code);
  }
  assert.equal(parseInvite('hello'), null);
  assert.equal(parseInvite('ABC-DEF-GH1'), null);
  assert.equal(findInviteLink('ABC-DEF-GHJ'), null);
  assert.equal(formatTime(3725), '1:02:05');
});
