// Screenshots of every screen in dark and light on the sample trips (WAYPOINT_DEMO), plus a drag on the
// timeline and the offline pack at phone size.   xvfb-run -a node test/e2e/shots.js   → test/e2e/out/*.png
'use strict';
const path = require('path');
const fs = require('fs');
const os = require('os');
const { _electron: electron, chromium } = require('playwright');
const ROOT = path.join(__dirname, '..', '..');
const OUT = path.join(__dirname, 'out');
fs.mkdirSync(OUT, { recursive: true });
const errors = [];
const http = require('http');
const srv = http.createServer((q, r) => { r.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); r.end(`<html><head><title>Confirmation | Booking.com</title></head><body style="font:16px system-ui;padding:40px;max-width:720px"><h1>Thanks, Bilal! Your booking in Porto is confirmed.</h1><p>Booking number: <b>5517203391</b> · PIN 4410</p><p>Ribeira Loft · Check-in Mon · 3 nights · 2 guests</p><p>Total price € 540.00</p></body></html>`); });
let SITE = '';

(async () => {
  await new Promise(r => srv.listen(0, '127.0.0.1', r)); SITE = `http://127.0.0.1:${srv.address().port}/confirmation`;
  for (const theme of ['dark', 'light']) {
    const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'waypoint-shots-'));
    const data = path.join(ud, 'Trips');
    fs.writeFileSync(path.join(ud, 'settings.json'), JSON.stringify({ theme, onboarded: true, me: 'Bilal', dataDir: data }));
    const app = await electron.launch({ executablePath: require(path.join(ROOT, 'node_modules', 'electron')), args: [ROOT, '--no-sandbox'], env: { ...process.env, WAYPOINT_DEMO: '1', WAYPOINT_USER_DATA: ud, WAYPOINT_DATA: data, WAYPOINT_MULTI: '1', WAYPOINT_TEST_SITE: SITE } });
    const page = await app.firstWindow();
    await page.setViewportSize({ width: 1320, height: 840 });
    page.on('console', m => { if (m.type() === 'error') errors.push(`${theme} console: ${m.text()}`); });
    page.on('pageerror', e => errors.push(`${theme} pageerror: ${e.message}`));
    await page.waitForSelector('body.ready');
    await page.evaluate(() => { S.trip = null; go('trips'); });
    await page.waitForTimeout(700);
    const shot = (n) => page.screenshot({ path: path.join(OUT, `${theme}-${n}.png`) });
    await shot('01-trips');
    await page.click('.hero');
    await page.waitForTimeout(500);
    await shot('02-overview');
    await page.click('#nav [data-view="timeline"]');
    await page.waitForTimeout(500);
    await shot('03-timeline');
    if (theme === 'dark') {
      // drag the second plan an hour later, then stretch it
      const item = page.locator('.tl-item', { hasText: 'LX Factory' });
      await item.scrollIntoViewIfNeeded();
      const box = await item.boundingBox();
      const z = await page.evaluate(() => zoomPx());
      await page.mouse.move(box.x + box.width / 2, box.y + 10);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width / 2, box.y + 10 + z / 2, { steps: 6 });
      await page.mouse.move(box.x + box.width / 2, box.y + 10 + z, { steps: 6 });
      await page.screenshot({ path: path.join(OUT, `${theme}-04-dragging.png`) });
      await page.mouse.up();
      await page.waitForTimeout(400);
      await shot('05-after-drag');
      const moved = await page.evaluate(() => { const it = S.trip.items.find(i => i.id === S.sel); return it && `${it.title} ${it.start}-${it.end}`; });
      console.log('dragged →', moved);
      // drag onto the next day's chip
      const b2 = await page.locator('.tl-item.sel').boundingBox();
      const chip = await page.locator('.tl-day').nth(3).boundingBox();
      await page.mouse.move(b2.x + 20, b2.y + 10); await page.mouse.down();
      await page.mouse.move(chip.x + 30, chip.y + 30, { steps: 10 });
      await page.waitForTimeout(150);
      await page.screenshot({ path: path.join(OUT, `${theme}-06-drag-to-day.png`) });
      await page.mouse.up();
      await page.waitForTimeout(300);
      console.log('moved to day →', await page.evaluate(() => { const it = S.trip.items.find(i => i.id === S.sel); return it && it.day; }), 'chip day', await page.locator('.tl-day').nth(3).getAttribute('data-day'));
      await page.evaluate(() => { S.sel = null; render(); });
    }
    await page.click('#tlMode [data-m="list"]');
    await page.waitForTimeout(400);
    await shot('07-all-days');
    await page.click('#tlMode [data-m="day"]');
    for (const [n, v] of [['08', 'bookings'], ['09', 'docs'], ['10', 'budget'], ['11', 'research']]) {
      await page.click(`#nav [data-view="${v}"]`);
      await page.waitForTimeout(600);
      await shot(`${n}-${v}`);
    }
    await page.evaluate(() => takeSheet('phone'));
    await page.waitForTimeout(800);
    await shot('12-take-phone');
    await page.click('.take-tabs [data-tab="pack"]'); await page.waitForTimeout(250); await shot('13-take-pack');
    await page.click('.take-tabs [data-tab="file"]'); await page.waitForTimeout(250); await shot('14-take-file');
    await page.evaluate(() => closeSheet());
    await page.evaluate(() => bookingSheet(S.trip.bookings[0]));
    await page.waitForTimeout(300); await shot('15-booking-sheet');
    await page.evaluate(() => closeSheet());
    await page.evaluate(() => tripSheet());
    await page.waitForTimeout(300); await shot('16-new-trip');
    await page.evaluate(() => closeSheet());
    await page.evaluate(() => go('settings')); await page.waitForTimeout(300); await shot('17-settings');
    if (theme === 'dark') {
      // phone page served over the network, at iPhone size
      const info = await page.evaluate(() => call('shareInfo', S.trip.id));
      const url = info.url.replace(/\/\/[^:]+:/, '//127.0.0.1:');
      const b = await chromium.launch();
      const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148', colorScheme: 'dark' });
      const p = await ctx.newPage();
      p.on('pageerror', e => errors.push('phone pageerror: ' + e.message));
      await p.goto(url); await p.waitForTimeout(500);
      await p.screenshot({ path: path.join(OUT, 'phone-1-days.png') });
      await p.click('[data-v="bookings"]'); await p.waitForTimeout(200); await p.screenshot({ path: path.join(OUT, 'phone-2-bookings.png') });
      await p.click('[data-v="docs"]'); await p.waitForTimeout(400); await p.screenshot({ path: path.join(OUT, 'phone-3-docs.png') });
      await p.click('[data-v="info"]'); await p.waitForTimeout(200); await p.screenshot({ path: path.join(OUT, 'phone-4-info.png'), fullPage: true });
      // the saved offline copy, opened from disk with the network off
      const off = await (await ctx.request.get(url + 'offline.html')).text();
      const f = path.join(ud, 'offline.html'); fs.writeFileSync(f, off);
      const ctx2 = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: 'light', offline: true });
      const p2 = await ctx2.newPage();
      p2.on('pageerror', e => errors.push('offline pageerror: ' + e.message));
      await p2.goto('file://' + f); await p2.waitForTimeout(400);
      await p2.screenshot({ path: path.join(OUT, 'phone-5-offline-light.png') });
      await p2.click('[data-v="docs"]'); await p2.waitForTimeout(200);
      await p2.click('#v-docs [data-doc]'); await p2.waitForTimeout(400);
      await p2.screenshot({ path: path.join(OUT, 'phone-6-offline-doc.png') });
      console.log('offline pack size', (off.length / 1024).toFixed(0) + ' KB');
      await b.close();
      // PDF itinerary
      const pdf = path.join(ud, 'itinerary.pdf');
      await app.evaluate(async ({ dialog, shell }, out) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: out }); shell.openPath = async () => ''; shell.showItemInFolder = () => {}; }, pdf);
      await page.evaluate(() => call('savePdf', S.trip.id));
      console.log('pdf', fs.existsSync(pdf) ? fs.statSync(pdf).size + ' bytes' : 'MISSING');
      fs.copyFileSync(pdf, path.join(OUT, 'itinerary.pdf'));
    }

    if (theme === 'dark') {
      // ── Book: flights (sample service), checkout, booked
      await page.evaluate(() => go('book')); await page.waitForTimeout(500);
      await page.evaluate(() => { BK.fq.from = 'IAH'; render(); }); await page.waitForTimeout(200);
      await shot('20-book-form');
      await page.click('#fForm button[type=submit]'); await page.waitForSelector('.offer', { timeout: 10000 }); await page.waitForTimeout(300);
      await shot('21-flight-results');
      await page.click('.offer'); await page.waitForTimeout(300);
      await page.evaluate(() => { const set = (n, v) => document.querySelectorAll(`.pax [name=${n}]`).forEach((f, i) => { f.value = v[i] || v[0]; }); set('given', ['Bilal', 'Kiana']); set('family', ['Ahmad', 'Campbell']); set('born', ['1995-03-14', '1996-07-02']); set('email', ['bilal@example.com', 'kiana@example.com']); set('phone', ['+17135550100', '+17135550101']); document.querySelectorAll('.pax [name=gender]')[1].value = 'f'; });
      await shot('22-flight-checkout');
      await page.click('#buy'); await page.waitForSelector('.booked', { timeout: 15000 }); await page.waitForTimeout(400);
      await shot('23-flight-booked');
      console.log('flight booking →', await page.evaluate(() => { const b = S.trip.bookings.filter(x => x.booked); return b.map(x => `${x.title} ${x.startDate} ${x.startTime} ref ${x.ref} docs ${x.docs.length}`).join(' | '); }));
      await page.click('#bkTl'); await page.waitForTimeout(500); await shot('24-flight-on-timeline');
      // stays
      await page.evaluate(() => { go('book'); BK.tab = 'stays'; render(); }); await page.waitForTimeout(300);
      await page.click('#sForm button[type=submit]'); await page.waitForSelector('.hotel', { timeout: 10000 }); await page.waitForTimeout(300);
      await shot('25-stay-results');
      await page.click('.hotel'); await page.waitForTimeout(300); await shot('26-hotel-rooms');
      await page.click('[data-room]'); await page.waitForSelector('#buy:not([disabled])', { timeout: 10000 });
      await page.evaluate(() => { const v = { given: 'Bilal', family: 'Ahmad', email: 'bilal@example.com', phone: '+17135550100' }; for (const k in v) document.querySelector(`.pax [name=${k}]`).value = v[k]; });
      await shot('27-stay-checkout');
      await page.click('#buy'); await page.waitForSelector('.booked', { timeout: 15000 }); await page.waitForTimeout(300);
      await page.click('#bkList'); await page.waitForTimeout(500); await shot('28-bookings-after');
      // settings › booking
      await page.evaluate(() => { S.setFocus = 'booking'; go('settings'); }); await page.waitForTimeout(500); await shot('29-settings-booking');
      // the booking browser on a local "confirmation" page, then Save to trip
      await page.evaluate((u) => call('openSite', 'stays', 'booking', { city: 'Porto', checkin: S.trip.start, checkout: S.trip.end, adults: 2 }, S.trip.id));
      await page.waitForTimeout(1200);
      const wins = app.windows();
      const barPage = wins.find(w => w.url().endsWith('browser.html'));
      await new Promise(r => setTimeout(r, 2500));
      if (barPage) await barPage.screenshot({ path: path.join(OUT, `${theme}-30-browser-bar.png`) });
      if (barPage) { await barPage.click('#save'); }
      await page.waitForTimeout(2500);
      await page.bringToFront();
      await shot('31-captured-booking');
      console.log('captured →', await page.evaluate(() => { const f = (n) => { const el = document.querySelector(`#bkFields [name=${n}]`); return el ? el.value : '?'; }; return [f('provider'), f('ref'), f('cost'), f('currency'), f('startDate')].join(' / '); }));
      await page.evaluate(() => closeSheet());
    }
    await page.setViewportSize({ width: 960, height: 640 });
    await page.evaluate(() => go('timeline')); await page.waitForTimeout(400);
    await shot('18-small-timeline');
    await page.evaluate(() => go('overview')); await page.waitForTimeout(300);
    await shot('19-small-overview');
    await app.close();
  }
  // first run, empty
  const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'waypoint-shots-'));
  fs.writeFileSync(path.join(ud, 'settings.json'), JSON.stringify({ theme: 'dark', dataDir: path.join(ud, 'Trips') }));
  const app = await electron.launch({ executablePath: require(path.join(ROOT, 'node_modules', 'electron')), args: [ROOT, '--no-sandbox'], env: { ...process.env, WAYPOINT_USER_DATA: ud, WAYPOINT_MULTI: '1' } });
  const page = await app.firstWindow();
  await page.setViewportSize({ width: 1320, height: 840 });
  page.on('pageerror', e => errors.push('first pageerror: ' + e.message));
  await page.waitForSelector('body.ready'); await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT, 'dark-00-first-run.png') });
  await page.click('#firstSample'); await page.waitForTimeout(900);
  await page.screenshot({ path: path.join(OUT, 'dark-00b-sample.png') });
  await app.close();
  srv.close();
  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no page errors');
  console.log('shots in', OUT);
})().catch(e => { console.error(e); console.log(errors.join('\n')); process.exit(1); });
