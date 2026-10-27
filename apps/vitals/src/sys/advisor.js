// Turns an inventory into a verdict per component and a ranked list of compatible upgrades. Pure: no system calls.
'use strict';
const GB = 2 ** 30;
const q = encodeURIComponent;
const fmtGB = (b) => `${Math.round(b / GB)} GB`;
const fmtDisk = (b) => (b >= 0.95e12 ? `${+(b / 1e12).toFixed(1)} TB` : `${Math.round(b / 1e9)} GB`);
const shop = {
  crucial: { label: 'Crucial System Scanner', url: 'https://www.crucial.com/store/systemscanner' },
  kingston: { label: 'Kingston configurator', url: 'https://www.kingston.com/en/memory/search' },
  owc: { label: 'OWC upgrades for your Mac', url: 'https://eshop.macsales.com/upgrades/' },
  newegg: (s) => ({ label: 'Newegg', url: `https://www.newegg.com/p/pl?d=${q(s)}` }),
  amazon: (s) => ({ label: 'Amazon', url: `https://www.amazon.com/s?k=${q(s)}` }),
  ifixit: (model, part) => ({ label: 'iFixit guides', url: `https://www.ifixit.com/Search?query=${q(`${model} ${part}`)}` }),
  web: (s, label) => ({ label, url: `https://www.google.com/search?q=${q(s)}` })
};

/** Pick a RAM plan that fits the slots and the board's maximum. */
function ramPlan(mem, target) {
  const per = mem.modules.length ? Math.max(...mem.modules.map((m) => m.size)) : 0;
  const same = mem.modules.length > 0 && mem.modules.every((m) => m.size === per);
  const free = Math.max(0, (mem.slots || 0) - (mem.used || 0));
  const max = mem.max || Infinity;
  target = Math.min(target, max);
  if (target <= mem.total) return null;
  const add = target - mem.total;
  // 1) fill empty slots with matching sticks (keeps dual-channel pairs)
  if (same && per && free > 0) {
    const n = Math.round(add / per);
    if (n >= 1 && n <= free && n * per === add) return { action: 'add', count: n, each: per, total: target, keep: true };
  }
  // 2) replace everything with a matched kit across 2 sticks (or the slot count if only 1)
  const sticks = Math.min(2, Math.max(1, mem.slots || 2));
  const each = target / sticks;
  if (each >= 4 * GB && Number.isInteger(each / GB)) return { action: 'replace', count: sticks, each, total: target, keep: false };
  return null;
}
function ramSpec(mem, plan) {
  const ff = mem.formFactor === 'SODIMM' ? 'SODIMM' : mem.formFactor === 'DIMM' ? 'DIMM' : (mem.laptop ? 'SODIMM' : 'DIMM');
  const speed = mem.speed ? `-${mem.speed}` : '';
  const kit = plan.count > 1 ? `${fmtGB(plan.each * plan.count)} (${plan.count}x${fmtGB(plan.each).replace(' ', '')})` : fmtGB(plan.each);
  return { query: `${kit} ${mem.type || 'DDR4'}${speed} ${ff}`.replace(/\s+/g, ' '), ff };
}

function advise(inv, ctx = {}) {
  const verdicts = []; const ideas = [];
  const mac = inv.platform === 'darwin'; const win = inv.platform === 'win32';
  const laptop = inv.chassis === 'laptop'; const desktop = inv.chassis === 'desktop' || (inv.chassis === 'unknown' && win);
  const mem = { ...inv.memory, laptop };
  const model = inv.model || 'computer';
  const apps = (ctx.apps || []).map((a) => String(a.name || '').toLowerCase());
  const has = (re) => apps.some((n) => re.test(n));
  const creative = has(/photoshop|premiere|after effects|davinci|final cut|blender|lightroom|illustrator|ro3|kiln|stable diffusion|comfy/);
  const ai = has(/kiln|comfy|stable diffusion|automatic1111|ollama|lm studio/);
  const memAvg = (() => { const h = ((ctx.history || {}).mem || []).filter((x) => x != null); return h.length ? h.reduce((a, b) => a + b, 0) / h.length : null; })();
  const sample = ctx.sample || {};
  const tight = (sample.mem && (sample.mem.pressure === 'warning' || sample.mem.pressure === 'critical')) || (memAvg != null && memAvg > 85) || (sample.mem && sample.mem.swap && sample.mem.swap.used > 4 * GB);

  // ------------------------------------------------ memory
  if (mem.soldered || mem.upgradeable === false) {
    verdicts.push({ area: 'memory', status: 'fixed', title: 'Memory', text: `${fmtGB(mem.total)} ${mem.type || ''} built onto the ${mac && inv.appleSilicon ? 'chip' : 'board'}. It can’t be changed.`.replace(/\s+/g, ' ') });
    if (tight) ideas.push({ id: 'mem-fixed', area: 'memory', impact: 'medium', difficulty: 'none', title: 'Memory is your bottleneck, but it can’t be upgraded', why: `Memory has been running tight (${memAvg != null ? `${Math.round(memAvg)}% on average` : 'pressure is high'}). On this ${mac ? 'Mac' : 'computer'} the only fixes are using less at once or, eventually, a model with more memory.`,
      steps: ['Quit apps you aren’t using (Activity shows the biggest).', 'Close browser tabs you don’t need — each can use hundreds of MB.', `When you next buy, choose at least ${fmtGB(Math.max(16 * GB, mem.total * 2))}.`], go: 'activity:mem' });
  } else if (mem.upgradeable === true || (mem.slots && mem.type && mem.upgradeable !== false && inv.platform !== 'linux')) {
    const free = Math.max(0, mem.slots - mem.used);
    verdicts.push({ area: 'memory', status: 'open', title: 'Memory', text: `${fmtGB(mem.total)} ${mem.type} ${mem.formFactor || ''}${mem.speed ? ` at ${mem.speed} MT/s` : ''} · ${mem.used} of ${mem.slots} slots used${free ? ` (${free} free)` : ''}${mem.max ? ` · up to ${fmtGB(mem.max)}` : ''}`.replace(/\s+/g, ' ') });
    let target = 0, why = '';
    if (mem.total < 8 * GB * 0.98) { target = 16 * GB; why = `${fmtGB(mem.total)} is very little for today’s apps and browsers.`; }
    else if (mem.total < 16 * GB * 0.98) { target = (creative || tight) ? 32 * GB : 16 * GB; why = tight ? 'Memory has been running tight, so apps are being swapped to disk.' : `16 GB is the comfortable minimum now${creative ? ', and your creative apps want more' : ''}.`; }
    else if (mem.total < 32 * GB * 0.98 && (tight || ai || creative)) { target = 32 * GB; why = ai ? 'AI image tools like Kiln and big creative projects use a lot of memory alongside the graphics card.' : tight ? 'Memory has been running tight.' : 'Creative apps run smoother with 32 GB.'; }
    else if (mem.total < 64 * GB * 0.98 && tight) { target = 64 * GB; why = 'Memory has been running tight even with 32 GB.'; }
    const plan = target ? ramPlan(mem, target) : null;
    if (plan) {
      const spec = ramSpec(mem, plan);
      const mixed = new Set(mem.modules.map((m) => m.part)).size > 1;
      ideas.push({ id: 'ram', area: 'memory', impact: mem.total < 16 * GB ? 'high' : 'medium', difficulty: laptop ? 'moderate' : 'easy', guide: laptop ? 'ram-laptop' : (mac ? 'ram-imac' : 'ram-desktop'),
        title: plan.action === 'add' ? `Add ${plan.count} × ${fmtGB(plan.each)} to reach ${fmtGB(plan.total)}` : `Upgrade to ${fmtGB(plan.total)} of memory`,
        why, buy: spec.query,
        details: [
          `Type: ${mem.type} ${spec.ff}${mem.speed ? `, ${mem.speed} MT/s (faster sticks also work; they run at the slowest stick’s speed)` : ''}`,
          plan.action === 'add' ? `Keep your ${mem.used} × ${fmtGB(mem.modules[0].size)} and fill ${plan.count} empty slot${plan.count > 1 ? 's' : ''}. Matching the brand and part number${mem.modules[0].part ? ` (${mem.modules[0].part})` : ''} avoids trouble.` : plan.count > 1 ? `Replace the current stick${mem.used > 1 ? 's' : ''} with a matched ${plan.count}-stick kit so both memory channels are used.` : `Replace the current stick with one ${fmtGB(plan.each)} stick.`,
          mem.max ? `This board takes up to ${fmtGB(mem.max)}.` : 'Check the maximum on your model’s spec page or the Crucial scanner before buying more than 32 GB.',
          mixed ? 'Your current sticks don’t all match; a matched kit is the safer buy.' : ''
        ].filter(Boolean),
        shop: [mac ? shop.owc : shop.crucial, shop.kingston, shop.newegg(spec.query), shop.amazon(spec.query)], help: [shop.ifixit(model, 'RAM replacement')], check: { kind: 'memory', expect: plan.total } });
    }
  } else verdicts.push({ area: 'memory', status: 'unknown', title: 'Memory', text: `${fmtGB(mem.total)} installed. Vitals couldn’t read the slot layout.` });

  // ------------------------------------------------ storage
  const sys = inv.storage.find((d) => d.system) || inv.storage.find((d) => d.internal) || null;
  const vol = (sample.volumes || []).find((v) => v.name === 'Macintosh HD' || /^C:/i.test(v.mount) || v.mount === '/') || (sample.volumes || [])[0];
  const freePct = vol && vol.size ? vol.free / vol.size * 100 : null;
  const internal = inv.storage.filter((d) => d.internal);
  if (mac && inv.appleSilicon) {
    verdicts.push({ area: 'storage', status: 'fixed', title: 'Storage', text: `${sys ? fmtDisk(sys.size) : ''} built-in SSD. It can’t be swapped, but fast external drives work well.`.trim() });
    if ((freePct != null && freePct < 20) || (sys && sys.size < 300e9)) {
      ideas.push({ id: 'ext-ssd', area: 'storage', impact: freePct != null && freePct < 10 ? 'high' : 'medium', difficulty: 'easy', guide: 'ext-ssd-mac',
        title: 'Add a fast external SSD', why: freePct != null ? `Only ${Math.round(freePct)}% of your built-in drive is free. Photos, video projects and old downloads can live on an external SSD instead.` : 'The built-in drive is small; an external SSD gives room for projects and backups.',
        buy: '2TB USB4 NVMe SSD', details: ['Best: a USB4/Thunderbolt NVMe drive or enclosure (up to ~3,000 MB/s on this Mac’s USB-C ports).', 'Good value: a 10 Gb/s USB-C SSD (~1,000 MB/s), plenty for photos and video.', 'Format it as APFS in Disk Utility. Then use the Drives tab here to check its speed.'],
        shop: [shop.newegg('USB4 NVMe SSD 2TB'), { ...shop.amazon('USB4 NVMe external SSD 2TB'), label: 'Amazon: USB4 drives' }, { ...shop.amazon('USB-C 10Gbps portable SSD 2TB'), label: 'Amazon: 10 Gb/s drives' }] });
    }
  } else if (sys) {
    const hdd = sys.media === 'HDD';
    verdicts.push({ area: 'storage', status: 'open', title: 'Storage', text: `${inv.storage.filter((d) => d.internal).map((d) => `${fmtDisk(d.size)} ${d.media || ''} (${d.bus || 'drive'})`.replace(/\s+/g, ' ').trim()).join(' · ')}` });
    if (hdd) ideas.push({ id: 'hdd-ssd', area: 'storage', impact: 'high', difficulty: laptop ? 'moderate' : 'easy', guide: 'ssd-clone', title: 'Move Windows to an SSD', why: 'Your system drive is a spinning hard drive. An SSD makes start-up, apps and updates several times faster — the single biggest upgrade for this computer.',
      buy: `${Math.max(1, Math.ceil(sys.size / 1e12))}TB ${laptop ? '2.5 inch SATA' : 'NVMe M.2 2280'} SSD`, details: [laptop ? 'Most laptops with a hard drive take a 2.5-inch SATA SSD (7 mm). Some also have an M.2 slot — check iFixit or the service manual.' : 'Most desktops from the last 8 years have an M.2 slot on the motherboard; otherwise use a 2.5-inch SATA SSD.', 'Copy your system over with a cloning tool (Macrium Reflect, or the free tool from the SSD’s maker), or do a fresh install of Windows.'],
      shop: [shop.newegg(`${laptop ? '2.5 SATA SSD' : 'NVMe M.2 SSD'} 1TB`), shop.amazon(`${laptop ? '2.5 inch SATA SSD' : 'NVMe M.2 2280 SSD'} 1TB`)], help: [shop.ifixit(model, 'SSD replacement')], check: { kind: 'storage' } });
    if (freePct != null && freePct < 15) {
      const add = desktop && internal.length < 4;
      ideas.push({ id: 'more-storage', area: 'storage', impact: freePct < 8 ? 'high' : 'medium', difficulty: add ? 'easy' : 'moderate', guide: add ? 'ssd-add' : 'ssd-clone',
        title: add ? 'Add a second SSD' : 'Swap in a bigger SSD', why: `Only ${Math.round(freePct)}% of your system drive is free. Windows slows down and updates fail when it gets this full.`,
        buy: `2TB NVMe M.2 2280 SSD${sys.bus === 'SATA' ? ' (or SATA, to match)' : ''}`,
        details: [add ? 'Desktops usually have a spare M.2 slot or a SATA port. Put games, videos and downloads on the new drive.' : 'Laptops usually have one M.2 slot: copy your system to the new drive, then swap it in. Check the drive length (2280 is most common; some thin laptops use 2230 or 2242).', sys.bus === 'NVMe' ? 'Your current drive is NVMe, so the board supports NVMe.' : ''].filter(Boolean),
        shop: [shop.newegg('NVMe M.2 2280 SSD 2TB'), shop.amazon('NVMe M.2 2280 SSD 2TB')], help: [shop.ifixit(model, 'SSD')], check: { kind: 'storage' } });
    }
    for (const d of inv.storage) {
      if (/warning|unhealthy/i.test(d.health || '') || (d.wear != null && d.wear >= 80)) ideas.push({ id: 'disk-health-' + d.name, area: 'storage', impact: 'high', difficulty: 'moderate', guide: 'ssd-clone', title: `Replace ${d.name} soon`, why: d.wear != null && d.wear >= 80 ? `It has used ${d.wear}% of its rated write life.` : `Windows reports its health as “${d.health}”.`, details: ['Back up what’s on it today.'], shop: [shop.newegg('NVMe SSD 1TB')] });
    }
  } else verdicts.push({ area: 'storage', status: 'unknown', title: 'Storage', text: 'Vitals couldn’t read the internal drives.' });

  // ------------------------------------------------ graphics
  const dgpu = inv.gpus.find((g) => g.discrete);
  if (mac) verdicts.push({ area: 'graphics', status: 'fixed', title: 'Graphics', text: `${inv.gpus.map((g) => g.model + (g.cores ? ` (${g.cores} cores)` : '')).join(', ')}${inv.appleSilicon ? ', part of the chip' : ''}.` });
  else if (laptop) verdicts.push({ area: 'graphics', status: 'fixed', title: 'Graphics', text: `${inv.gpus.map((g) => g.model).join(' + ') || 'Unknown'}. Laptop graphics can’t be swapped.` });
  else if (!inv.gpus.length || !desktop) verdicts.push({ area: 'graphics', status: 'unknown', title: 'Graphics', text: inv.gpus.length ? inv.gpus.map((g) => g.model).join(' + ') : 'Vitals couldn’t identify the graphics.' });
  else {
    const vram = dgpu && dgpu.vram ? dgpu.vram : null;
    verdicts.push({ area: 'graphics', status: 'open', title: 'Graphics', text: `${inv.gpus.map((g) => g.model + (g.vram && g.discrete ? ` (${fmtGB(g.vram)})` : '')).join(' + ') || 'Unknown'}${desktop ? ' · PCIe card slot' : ''}` });
    if (desktop && (!dgpu || (vram && vram < 8 * GB) || (ai && vram && vram < 12 * GB))) {
      ideas.push({ id: 'gpu', area: 'graphics', impact: ai ? 'high' : 'medium', difficulty: 'moderate', guide: 'gpu',
        title: dgpu ? `Upgrade the graphics card${vram ? ` (now ${fmtGB(vram)})` : ''}` : 'Add a graphics card',
        why: ai ? 'AI image tools like Kiln run on the graphics card: 12–16 GB of video memory makes larger models and higher resolutions possible.' : dgpu ? 'Under 8 GB of video memory limits newer games and video editing.' : 'This desktop runs on integrated graphics. A card speeds up games, video editing and AI tools.',
        buy: ai ? 'NVIDIA RTX 16GB graphics card' : 'graphics card 12GB', details: ['Check three things first: the case has room for the card’s length, the power supply has enough watts and the right PCIe power cables, and there’s a free full-length PCIe x16 slot.', ai ? 'NVIDIA cards are the best supported by Stable Diffusion tools.' : 'Look up your power supply’s label (inside the case) for its wattage.', 'After installing, get the driver from the card maker — the Drivers tab links it.'],
        shop: [shop.newegg(ai ? 'RTX 16GB' : 'graphics card 12GB'), shop.amazon(ai ? 'NVIDIA RTX 16GB graphics card' : 'graphics card 12GB')], check: { kind: 'gpu' } });
    }
  }

  // ------------------------------------------------ processor
  if (mac || laptop) verdicts.push({ area: 'cpu', status: 'fixed', title: 'Processor', text: `${inv.cpu.name}. ${mac ? 'Part of the chip' : 'Soldered to the board'}; it can’t be changed.` });
  else verdicts.push({ area: 'cpu', status: inv.cpu.socket ? 'limited' : 'unknown', title: 'Processor', text: `${inv.cpu.name}${inv.cpu.socket ? ` in socket ${inv.cpu.socket}` : ''}. Only processors your motherboard lists will work.`, link: inv.board ? shop.web(`${inv.board} CPU support list`, 'Your board’s CPU support list') : null });

  // ------------------------------------------------ battery
  const bat = inv.battery || (sample.battery && sample.battery.present ? { health: sample.battery.health, cycles: sample.battery.cycles } : null);
  if (bat && (laptop || mac)) {
    const worn = (bat.health != null && bat.health < 80) || /service|replace/i.test(bat.condition || '');
    verdicts.push({ area: 'battery', status: worn ? 'warn' : 'ok', title: 'Battery', text: `${bat.health != null ? `${bat.health}% of original capacity` : bat.condition || 'Unknown'}${bat.cycles ? ` · ${bat.cycles} cycles` : ''}` });
    if (worn) ideas.push({ id: 'battery', area: 'battery', impact: 'medium', difficulty: mac ? 'pro' : 'moderate', guide: mac ? 'battery-mac' : 'battery-laptop', title: 'Replace the battery', why: `It holds ${bat.health != null ? bat.health + '%' : 'much less'} of what it did new, so you get noticeably shorter battery life.`,
      details: [mac ? 'Apple replaces it for a fixed price, or you can use Apple’s Self Service Repair.' : 'Use the laptop maker’s part number (printed on the battery or in the service manual).'], shop: mac ? [{ label: 'Apple battery service', url: 'https://support.apple.com/mac/repair' }, { label: 'Self Service Repair', url: 'https://support.apple.com/self-service-repair' }] : [shop.web(`${model} replacement battery`, 'Find the right battery')], help: [shop.ifixit(model, 'battery replacement')] });
  }

  // ------------------------------------------------ displays (Apple Silicon)
  if (mac && inv.displays) verdicts.push({ area: 'displays', status: 'info', title: 'External displays', text: `Supports ${inv.displays.count} external display${inv.displays.count > 1 ? 's' : ''}${inv.displays.note ? ` (${inv.displays.note.toLowerCase()})` : ''}. DisplayLink docks can add more.` });

  // ------------------------------------------------ operating system
  if (win && /Windows 10/i.test(inv.os.name)) ideas.unshift({ id: 'win11', area: 'os', impact: 'high', difficulty: 'easy', guide: 'win11', title: 'Move to Windows 11', why: 'Windows 10 stopped getting free security updates in October 2025.',
    details: ['Run PC Health Check to see if this PC qualifies (it needs TPM 2.0 and a supported processor).', 'If it qualifies, Windows Update offers the upgrade for free and keeps your files and apps.'], shop: [{ label: 'PC Health Check', url: 'https://www.microsoft.com/en-us/windows/windows-11#pchealthcheck' }], settings: 'ms-settings:windowsupdate' });

  const rank = { high: 0, medium: 1, low: 2 };
  ideas.sort((a, b) => rank[a.impact] - rank[b.impact]);
  const open = verdicts.filter((v) => v.status === 'open').length;
  const summary = mac && inv.appleSilicon ? 'Apple Silicon Macs have memory, storage and graphics built into the chip, so upgrades happen outside the case: external drives, displays and the battery.'
    : laptop ? `In this laptop, ${open ? verdicts.filter((v) => v.status === 'open').map((v) => v.title.toLowerCase()).join(' and ') + (open > 1 ? ' can be upgraded' : ' can be upgraded') : 'not much can be upgraded'}; the processor and graphics are soldered.`
    : `This ${inv.chassis === 'unknown' ? 'computer' : inv.chassis} has room to grow: ${verdicts.filter((v) => v.status === 'open').map((v) => v.title.toLowerCase()).join(', ') || 'little to change'}.`;
  return { verdicts, ideas, summary };
}

/** Compare two inventories (before/after an upgrade). */
function diffInventory(a, b) {
  if (!a || !b) return [];
  const out = [];
  if (Math.abs((b.memory.total || 0) - (a.memory.total || 0)) > GB / 2) out.push({ area: 'memory', text: `Memory ${fmtGB(a.memory.total)} → ${fmtGB(b.memory.total)}` });
  const sz = (x) => x.storage.filter((d) => d.internal).reduce((s, d) => s + (d.size || 0), 0);
  if (Math.abs(sz(b) - sz(a)) > 20e9) out.push({ area: 'storage', text: `Internal storage ${Math.round(sz(a) / 1e9)} GB → ${Math.round(sz(b) / 1e9)} GB` });
  const g = (x) => x.gpus.map((y) => y.model).sort().join(', ');
  if (g(a) !== g(b)) out.push({ area: 'graphics', text: `Graphics: ${g(a) || 'none'} → ${g(b) || 'none'}` });
  return out;
}

module.exports = { advise, ramPlan, diffInventory };
