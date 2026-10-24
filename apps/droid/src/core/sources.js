// Where apps come from. F-Droid has a real search API and signed builds, so Droid searches it directly.
// Play Store apps come from the Play Store itself (Google Play devices) or Aurora Store (no Google account),
// and the big APK sites open in Droid's browser, where any APK you download installs itself.
'use strict';
const { fetchJson, fetchText } = require('./download');

const FDROID = 'https://f-droid.org';

async function fdroidSearch(q) {
  const j = await fetchJson(`https://search.f-droid.org/api/search_apps?q=${encodeURIComponent(q)}`, { timeout: 15000 });
  return (j.apps || []).map((a) => {
    const id = (a.url || '').split('/packages/')[1]?.replace(/\/$/, '') || null;
    return { source: 'fdroid', id, name: a.name, summary: a.summary || '', icon: a.icon || null, url: a.url };
  }).filter((a) => a.id);
}

// Picks the build to download. Some apps publish one build per processor, sharing a version name, so
// this tries the suggested build first and lists the rest as fallbacks.
async function fdroidPackage(id) {
  const j = await fetchJson(`${FDROID}/api/v1/packages/${encodeURIComponent(id)}`, { timeout: 15000 });
  const seen = new Set();
  const builds = (j.packages || []).filter((p) => !seen.has(p.versionCode) && seen.add(p.versionCode));
  const sug = j.suggestedVersionCode;
  const sugName = (builds.find((p) => p.versionCode === sug) || builds[0] || {}).versionName;
  const ordered = [...builds.filter((p) => p.versionCode === sug), ...builds.filter((p) => p.versionName === sugName && p.versionCode !== sug), ...builds.filter((p) => p.versionName !== sugName)];
  return {
    id, versionName: sugName || null,
    builds: ordered.map((p) => ({ versionName: p.versionName, versionCode: p.versionCode, url: `${FDROID}/repo/${id}_${p.versionCode}.apk` })),
  };
}

// Pulls a few lines of description from the app's F-Droid page (best effort).
async function fdroidAbout(id) {
  try {
    const html = await fetchText(`${FDROID}/en/packages/${encodeURIComponent(id)}/`, { timeout: 15000 });
    const desc = (html.match(/<div class="package-description"[^>]*>([\s\S]*?)<\/div>/) || [])[1] || '';
    const text = desc.replace(/<br\s*\/?>/g, '\n').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();
    const shots = [...html.matchAll(/class="[^"]*screenshot[^"]*"><img src="([^"]+)"/g)].map((m) => new URL(m[1], FDROID).toString()).slice(0, 6);
    return { text: text.slice(0, 1600), shots };
  } catch { return { text: '', shots: [] }; }
}

// Hand-picked starters. Aurora Store is the bridge to Play Store apps on devices without Google Play.
const STARTERS = [
  { id: 'com.aurora.store', name: 'Aurora Store', summary: 'Download Play Store apps without a Google account.', tag: 'Play Store apps' },
  { id: 'org.fdroid.fdroid', name: 'F-Droid', summary: 'The open-source app store, on the device itself.', tag: 'App store' },
  { id: 'org.mozilla.fennec_fdroid', name: 'Fennec', summary: 'Firefox-based web browser.', tag: 'Browser' },
  { id: 'org.schabi.newpipe', name: 'NewPipe', summary: 'Lightweight YouTube player with downloads.', tag: 'Video' },
  { id: 'org.videolan.vlc', name: 'VLC', summary: 'Plays every audio and video file.', tag: 'Media' },
  { id: 'app.organicmaps', name: 'Organic Maps', summary: 'Offline maps for travel and hiking.', tag: 'Maps' },
  { id: 'me.zhanghai.android.files', name: 'Material Files', summary: 'A clean file manager.', tag: 'Files' },
  { id: 'com.termux', name: 'Termux', summary: 'A Linux terminal on Android.', tag: 'Tools' },
];

// APK sites that open in Droid's browser. Downloads from any page install on the chosen device.
const SITES = [
  { id: 'apkmirror', name: 'APKMirror', url: 'https://www.apkmirror.com/', blurb: 'Every version of Play Store apps, checked against the developer\'s signature. Bundles (APKM) install too.' },
  { id: 'apkpure', name: 'APKPure', url: 'https://apkpure.com/', blurb: 'Large catalog with XAPK bundles and OBB game data.' },
  { id: 'uptodown', name: 'Uptodown', url: 'https://en.uptodown.com/android', blurb: 'Big catalog with older versions of most apps.' },
  { id: 'fdroid', name: 'F-Droid', url: 'https://f-droid.org/en/packages/', blurb: 'Free and open-source apps, built and signed by F-Droid.' },
];

module.exports = { fdroidSearch, fdroidPackage, fdroidAbout, STARTERS, SITES };
