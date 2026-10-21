// Docket — Node checks for everything that doesn't need a window: storage, to-dos, WebM duration, AI parsing, call detection, segmenting and clean-up.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Store, toMarkdown } = require('../src/store');
const webm = require('../src/webm');
const ai = require('../src/ai');
const detect = require('../src/detect');
const T = require('../src/renderer/text');

let pass = 0, fail = 0;
const queue = [];
const t = (name, fn) => queue.push([name, fn]);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'docket-test-'));

// ---------------------------------------------------------------- storage
t('create, save, load, list, notes.md', () => {
  const s = new Store(path.join(tmp, 'A'));
  const m = s.create({ app: 'Zoom' });
  m.segments = [{ id: 'a', t0: 1, t1: 3, ch: 'me', text: 'Hello there' }, { id: 'b', t0: 4, t1: 6, ch: 'them', text: 'Hi, can you send the deck?' }];
  m.summary = { text: 'We said hi.', keyPoints: ['Greetings'], decisions: ['Ship it'] };
  s.save(m);
  assert.strictEqual(s.load(m.id).segments.length, 2);
  const l = s.list(); assert.strictEqual(l.length, 1); assert.strictEqual(l[0].words, 8); assert.ok(l[0].hasSummary);
  const md = fs.readFileSync(path.join(s.dir(m.id), 'notes.md'), 'utf8');
  assert.ok(md.includes('## Decisions') && md.includes('**[00:04] Them:** Hi, can you send the deck?'));
});
t('rejects bad ids and file names', () => {
  const s = new Store(path.join(tmp, 'B'));
  assert.throws(() => s.load('../../etc'));
  assert.throws(() => s.file('abcdefgh', '../x'));
});
t('search finds transcript words', () => {
  const s = new Store(path.join(tmp, 'C'));
  const a = s.create({}); a.segments = [{ t0: 0, t1: 1, ch: 'me', text: 'The Kingsville launch moves to March' }]; s.save(a);
  const b = s.create({}); b.notes = 'budget review'; s.save(b);
  assert.deepStrictEqual(s.search('kingsville march').map((x) => x.id), [a.id]);
  assert.deepStrictEqual(s.search('budget').map((x) => x.id), [b.id]);
});
t('to-dos: add, update, AI replace keeps edited and done ones', () => {
  const s = new Store(path.join(tmp, 'D'));
  const m = s.create({});
  const ai1 = s.replaceAiTodos(m.id, [{ text: 'Send deck', owner: 'Me' }, { text: 'Book room' }, { text: 'Call vendor' }]);
  assert.strictEqual(ai1.length, 3);
  s.updateTodo(ai1[0].id, { done: true });
  s.updateTodo(ai1[1].id, { text: 'Book the big room' });
  s.replaceAiTodos(m.id, [{ text: 'Send deck' }, { text: 'Draft agenda' }]);
  const texts = s.todos().map((x) => x.text).sort();
  assert.deepStrictEqual(texts, ['Book the big room', 'Draft agenda', 'Send deck']);
  const man = s.addTodos([{ text: 'Personal thing', due: '2026-10-23' }]);
  assert.strictEqual(man[0].source, 'manual');
  s.remove(m.id); // open to-dos from a deleted meeting go too, done ones stay
  assert.deepStrictEqual(s.todos().map((x) => x.text).sort(), ['Personal thing', 'Send deck']);
});

// ---------------------------------------------------------------- webm
function ebml(id, payload) { // id as bytes, size as 8-byte vint
  const size = Buffer.alloc(8); let v = payload.length; for (let i = 7; i >= 0; i--) { size[i] = v % 256; v = Math.floor(v / 256); } size[0] |= 0x01;
  return Buffer.concat([Buffer.from(id), size, payload]);
}
function fakeWebm() {
  const header = ebml([0x1a, 0x45, 0xdf, 0xa3], Buffer.from([0x42, 0x82, 0x84, 0x77, 0x65, 0x62, 0x6d]));
  const info = ebml([0x15, 0x49, 0xa9, 0x66], Buffer.concat([Buffer.from([0x2a, 0xd7, 0xb1, 0x83, 0x0f, 0x42, 0x40]), Buffer.from([0x4d, 0x80, 0x84, 0x74, 0x65, 0x73, 0x74])]));
  const cluster = ebml([0x1f, 0x43, 0xb6, 0x75], Buffer.alloc(40, 7));
  const segHead = Buffer.from([0x18, 0x53, 0x80, 0x67, 0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]);
  return Buffer.concat([header, segHead, info, cluster]);
}
t('webm: adds a Duration and keeps the rest intact', () => {
  const src = fakeWebm();
  assert.strictEqual(webm.getDuration(src), null);
  const out = webm.setDuration(src, 61234);
  assert.ok(Math.abs(webm.getDuration(out) - 61234) < 0.01);
  assert.ok(out.subarray(out.length - 52).equals(src.subarray(src.length - 52)));
  const again = webm.setDuration(out, 5000); // overwrites in place
  assert.strictEqual(again.length, out.length);
  assert.ok(Math.abs(webm.getDuration(again) - 5000) < 0.01);
});
t('webm: ignores files that are not WebM', () => { assert.strictEqual(webm.setDuration(Buffer.alloc(100, 1), 1000), null); });

// ---------------------------------------------------------------- AI
t('summary JSON is parsed and cleaned', () => {
  const s = ai.cleanSummary(ai.parseJson('Here you go:\n{"title":"Q4 launch","summary":"We planned.","keyPoints":["a",""],"decisions":["ship"],"actionItems":[{"task":"Send deck","owner":"Me","due":"2026-10-23","t":"01:05"},{"task":""}],"chapters":[{"title":"Intro","t":"0:00"}]}'));
  assert.strictEqual(s.title, 'Q4 launch'); assert.deepStrictEqual(s.keyPoints, ['a']);
  assert.strictEqual(s.actionItems.length, 1); assert.strictEqual(s.actionItems[0].t, 65); assert.strictEqual(s.chapters[0].t, 0);
});
t('summarize through a CLI provider (fake claude)', async () => {
  let prompt = '', argsSeen = [];
  const run = async (cmd, args, input) => { argsSeen = args; prompt = input; return { code: 0, stdout: '{"title":"Sync","summary":"Short.","actionItems":[{"task":"Do it","owner":"Them","t":"00:04"}]}', stderr: '' }; };
  const m = { startedAt: Date.now(), speakers: { me: 'Bilal', them: 'Them' }, notes: 'remember the deck', segments: [{ t0: 4, t1: 6, ch: 'them', text: 'Can you do it?' }] };
  const s = await ai.summarize(m, { provider: 'claude-cli' }, null, { run });
  assert.strictEqual(s.title, 'Sync'); assert.strictEqual(s.actionItems[0].t, 4);
  assert.ok(prompt.includes('[00:04] Them: Can you do it?') && prompt.includes('MY NOTES:\nremember the deck') && prompt.includes('"Bilal" is the person using Docket'));
  assert.ok(argsSeen.includes('--disallowedTools'));
});
t('API key provider sends the transcript to the Messages API', async () => {
  let body = null;
  const fetchImpl = async (url, opts) => { body = JSON.parse(opts.body); return { ok: true, json: async () => ({ content: [{ type: 'text', text: '{"summary":"ok"}' }] }) }; };
  const s = await ai.summarize({ startedAt: Date.now(), segments: [{ t0: 0, t1: 1, ch: 'me', text: 'hello world' }] }, { provider: 'anthropic', key: 'k' }, fetchImpl);
  assert.strictEqual(s.text, 'ok'); assert.ok(body.messages[0].content.includes('hello world'));
});
t('missing CLI gives a plain message', async () => {
  const run = async () => ({ code: 127, stdout: '', stderr: 'zsh: command not found: claude' });
  await assert.rejects(ai.summarize({ segments: [{ t0: 0, t1: 1, ch: 'me', text: 'x y z' }] }, { provider: 'claude-cli' }, null, { run }), /isn't installed/);
});

// ---------------------------------------------------------------- detection
t('call detection from window titles', () => {
  const cases = [
    ['Zoom Meeting', 'Zoom'], ['Zoom Workplace', null], ['Zoom', null],
    ['Meet - abc-defg-hij - Google Chrome', 'Google Meet'], ['Meet – Weekly marketing sync', 'Google Meet'], ['Google Meet - Google Chrome', null],
    ['Meeting with Sarah | Microsoft Teams', 'Microsoft Teams'], ['Chat | Sarah Lee | Microsoft Teams', null], ['Calendar | Microsoft Teams', null],
    ['Huddle with Ana – Slack', 'Slack'], ['Inbox (3) - Gmail - Google Chrome', null], ['Cisco Webex Meetings', 'Webex']
  ];
  for (const [name, app] of cases) assert.strictEqual((detect.match(name) || {}).app || null, app, name);
  assert.strictEqual(detect.match('Meet – Weekly marketing sync').title, 'Weekly marketing sync');
  assert.strictEqual(detect.match('Meet - abc-defg-hij - Google Chrome').title, '');
});
t('watcher fires start once and end after the grace period', async () => {
  let names = ['Zoom Meeting'], starts = 0, ends = 0;
  const w = detect.makeWatcher({ list: async () => names, onStart: () => starts++, onEnd: () => ends++, every: 1e9, graceMs: 0 });
  await w.tick(); await w.tick();
  names = ['Finder']; await new Promise((r) => setTimeout(r, 5)); await w.tick();
  assert.deepStrictEqual([starts, ends], [1, 1]);
});

// ---------------------------------------------------------------- segmenting + text
function tone(sec, amp, sr = 16000) { const a = new Float32Array(Math.round(sec * sr)); for (let i = 0; i < a.length; i++) a[i] = amp * Math.sin(i / sr * 2 * Math.PI * 220) * (0.6 + 0.4 * Math.sin(i / sr * 2 * Math.PI * 3)); return a; }
const noise = (sec, amp) => { const a = new Float32Array(Math.round(sec * 16000)); for (let i = 0; i < a.length; i++) a[i] = (Math.random() * 2 - 1) * amp; return a; };
t('segmenter: two utterances separated by a pause', () => {
  const out = [];
  const seg = new T.Segmenter({ onSegment: (x) => out.push(x) });
  const parts = [noise(1, 0.001), tone(2.2, 0.2), noise(1.5, 0.001), tone(3, 0.2), noise(1.2, 0.001)];
  let t0 = 0; for (const p of parts) { for (let i = 0; i < p.length; i += 2048) seg.push(p.subarray(i, i + 2048), t0 + i / 16000); t0 += p.length / 16000; }
  seg.flush();
  assert.strictEqual(out.length, 2);
  assert.ok(Math.abs(out[0].t0 - 1) < 0.4 && Math.abs(out[1].t0 - 4.7) < 0.4, JSON.stringify(out.map((x) => [x.t0, x.t1])));
});
t('segmenter: cuts long speech at the max length', () => {
  const out = []; const seg = new T.Segmenter({ onSegment: (x) => out.push(x) });
  const p = tone(60, 0.2); for (let i = 0; i < p.length; i += 2048) seg.push(p.subarray(i, i + 2048), i / 16000);
  seg.flush();
  assert.ok(out.length >= 3 && out.every((x) => x.t1 - x.t0 <= 24.1));
});
t('segmenter: ignores clicks and hum', () => {
  const out = []; const seg = new T.Segmenter({ onSegment: (x) => out.push(x) });
  const p = noise(5, 0.002); p.set(tone(0.09, 0.4), 30000);
  for (let i = 0; i < p.length; i += 2048) seg.push(p.subarray(i, i + 2048), i / 16000);
  seg.flush(); assert.strictEqual(out.length, 0);
});
t('cleanText drops Whisper filler', () => {
  assert.strictEqual(T.cleanText('[BLANK_AUDIO]'), '');
  assert.strictEqual(T.cleanText(' (music) '), '');
  assert.strictEqual(T.cleanText('Thanks for watching!'), '');
  assert.strictEqual(T.cleanText('Thank you.', { speech: 0.4 }), '');
  assert.strictEqual(T.cleanText('Thank you.', { speech: 2 }), 'Thank you.');
  assert.strictEqual(T.cleanText('I mean, I mean, I mean, I mean, I mean the plan works.'), 'I mean the plan works.');
});
t('echo: the mic repeating the call is dropped either order', () => {
  let l = [];
  l = T.addSegment(l, { t0: 10, t1: 14, ch: 'them', text: 'We should move the launch to next Thursday' });
  l = T.addSegment(l, { t0: 10.4, t1: 14.2, ch: 'me', text: 'we should move the launch to next thursday' });
  assert.strictEqual(l.length, 1);
  let k = [];
  k = T.addSegment(k, { t0: 20.3, t1: 23, ch: 'me', text: 'Can everyone see my screen right now' });
  k = T.addSegment(k, { t0: 20, t1: 23, ch: 'them', text: 'Can everyone see my screen right now?' });
  assert.deepStrictEqual(k.map((x) => x.ch), ['them']);
  k = T.addSegment(k, { t0: 24, t1: 25, ch: 'me', text: 'Yes I can see it fine' });
  assert.strictEqual(k.length, 2);
  let s = [];
  s = T.addSegment(s, { t0: 5.61, t1: 7.65, ch: 'me', text: 'Ask not!' });
  s = T.addSegment(s, { t0: 5.65, t1: 7.69, ch: 'them', text: 'AS NOT!' });
  s = T.addSegment(s, { t0: 9, t1: 9.6, ch: 'me', text: 'Yeah.' }); // a real reply, not echo
  assert.deepStrictEqual(s.map((x) => x.ch), ['them', 'me']);
});
t('suggested to-dos without AI', () => {
  const s = T.suggestTodos([
    { ch: 'me', t0: 5, text: "Sounds good. I'll send the updated deck to Maria by Friday." },
    { ch: 'them', t0: 9, text: 'Could you also loop in the design team?' },
    { ch: 'them', t0: 12, text: "Let's see how it goes. We need to finalize the budget next week." },
    { ch: 'me', t0: 15, text: "I think that's right." }
  ], { me: 'Me', them: 'Sarah' });
  assert.strictEqual(s.length, 3, JSON.stringify(s));
  assert.deepStrictEqual([s[0].owner, s[0].due.toLowerCase()], ['Me', 'by friday']);
  assert.ok(/^Send the updated deck to Maria$/.test(s[0].text), s[0].text);
  assert.strictEqual(s[1].owner, 'Me');
  assert.ok(/finalize the budget/i.test(s[2].text) && s[2].owner === '');
});

(async () => {
  for (const [name, fn] of queue) {
    try { await fn(); pass++; console.log('  ✓ ' + name); }
    catch (e) { fail++; console.log('  ✗ ' + name + '\n    ' + (e.stack || e).toString().split('\n').slice(0, 4).join('\n    ')); }
  }
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
