// Concourse — Settings: accounts (with the one-time Microsoft app setup), the board, meetings, notifications, tasks.
(() => {
  let root, els = {}, section = 'accounts';
  const SECTIONS = [['accounts', 'Accounts'], ['board', 'Board'], ['meetings', 'Meetings'], ['notify', 'Notifications'], ['tasks', 'Tasks'], ['general', 'General']];
  const PERMS = ['User.Read', 'User.ReadBasic.All', 'People.Read', 'Chat.ReadWrite', 'ChatMessage.Send', 'Calendars.ReadWrite', 'Presence.Read.All', 'Presence.ReadWrite', 'Tasks.ReadWrite', 'Team.ReadBasic.All', 'Channel.ReadBasic.All', 'ChannelMessage.Send', 'ChannelMessage.Read.All (optional, admin)', 'offline_access'];

  function mount(main, arg) {
    root = main; els = {};
    if (arg && arg.section) section = arg.section;
    els.nav = h('nav.snav', h('div.title.led', 'Settings'), ...SECTIONS.map(([k, l]) => h('button' + (k === section ? '.on' : ''), { onclick: () => { section = k; draw(); } }, l)));
    els.pane = h('div.spane');
    main.append(els.nav, els.pane);
    draw();
  }
  const set = (patch) => run(C.call('setSettings', patch));
  const st = () => S.state.settings;
  const toggle = (label, key, sub, get = (s) => s[key], put = (v) => ({ [key]: v })) => {
    const i = h('input', { type: 'checkbox', checked: !!get(st()) }); i.onchange = () => set(put(i.checked));
    return h('label.check.srow', i, h('span.sw'), h('span.sl', h('b', label), sub ? h('em', sub) : null));
  };
  const segRow = (label, key, opts, sub) => {
    const seg = h('div.seg', ...opts.map(([v, l]) => h('button' + (String(st()[key]) === String(v) ? '.on' : ''), { onclick: (e) => { $$('button', seg).forEach(b => b.classList.toggle('on', b === e.currentTarget)); set({ [key]: v }); } }, l)));
    return h('div.srow', h('span.sl', h('b', label), sub ? h('em', sub) : null), seg);
  };
  const card = (title, ...kids) => h('section.scard', h('div.sct.eyebrow', title), ...kids);

  function draw() {
    $$('button', els.nav).forEach((b, i) => b.classList.toggle('on', SECTIONS[i] && SECTIONS[i][0] === section));
    const p = els.pane; p.textContent = '';
    ({ accounts, board, meetings, notify, tasks, general })[section](p);
  }

  // ───── accounts
  function accounts(p) {
    const s = st();
    if (S.state.demo) p.append(card('Sample data', h('p', 'You’re looking at a pretend company. Nothing here is real and nothing is sent anywhere.'), h('button.btn.lamp', { onclick: () => C.call('demo', { on: false }) }, 'Leave sample data')));
    const list = h('div.alist');
    for (const a of S.state.accounts) {
      const me = D.me(a.id);
      list.append(h('div.acct',
        avatar({ name: a.name, id: me && me.id }, { size: 'lg', accountId: a.id, presence: me && me.presence && me.presence.availability }),
        h('div.ai', h('b', a.name), h('span', a.username), h('div.row', a.needsSignIn ? h('span.tag.red', 'Signed out') : h('span.tag.green', 'Connected'), h('span.tag' + (a.channels ? '.green' : ''), a.channels ? 'Channel posts on' : 'Channel posts off'), S.state.errors[a.id] ? h('span.tag.red', Object.keys(S.state.errors[a.id]).join(', ') + ' blocked') : null)),
        h('div.aa',
          a.needsSignIn ? h('button.btn.lamp.sm', { onclick: () => signIn(a.username) }, 'Sign in again') : null,
          !a.channels && !a.demo ? h('button.btn.sm', { onclick: () => run(C.call('enableChannels', { accountId: a.id }), 'Channel reading turned on') }, 'Turn on channel posts') : null,
          !a.demo ? h('button.btn.sm', { onclick: async () => { const u = await C.call('adminConsentUrl', { accountId: a.id }); C.call('copy', { text: u }); toast('Admin consent link copied'); } }, icon('copy'), 'Admin consent link') : null,
          !a.demo ? h('button.btn.sm.danger', { onclick: () => { if (confirm(`Sign out of ${a.username}?`)) run(C.call('signOut', { accountId: a.id })); } }, 'Sign out') : null)));
      if (S.state.errors[a.id]) for (const [k, e] of Object.entries(S.state.errors[a.id])) list.append(h('div.terr.on', `${k}: ${e}`));
    }
    if (!S.state.demo) p.append(card('Microsoft accounts', S.state.accounts.length ? list : h('p.dim', 'No accounts yet.'),
      h('div.row', h('button.btn.lamp', { disabled: !s.clientId, onclick: () => signIn() }, icon('plus'), S.state.accounts.length ? 'Add another account' : 'Sign in with Microsoft'), !s.clientId ? h('span.dim', 'Add the app ID below first.') : h('span.dim', 'Opens Microsoft’s sign-in page in your browser.'))));

    const cid = h('input.input.mono', { placeholder: '00000000-0000-0000-0000-000000000000', value: s.clientIdFromConfig ? '' : (s.clientId || '') });
    const ten = h('input.input.mono', { placeholder: 'organizations', value: s.tenant && s.tenant !== 'organizations' ? s.tenant : '' });
    const steps = h('ol.steps.small',
      h('li', 'Open ', h('a', { href: '#', onclick: (e) => { e.preventDefault(); C.call('openExternal', { url: 'https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade' }); } }, 'Microsoft Entra › App registrations'), ' and choose ', h('b', 'New registration'), '.'),
      h('li', 'Name it ', h('b', 'Concourse'), '. Supported account types: ', h('b', 'Accounts in any organizational directory (multitenant)'), '.'),
      h('li', 'Redirect URI: platform ', h('b', 'Public client/native (mobile & desktop)'), ', value ', h('code', 'http://localhost'), '. Register.'),
      h('li', 'Authentication › Advanced settings › ', h('b', 'Allow public client flows: Yes'), '. Save.'),
      h('li', 'API permissions › Add › Microsoft Graph › ', h('b', 'Delegated'), ': ', h('span.perms', ...PERMS.map(x => h('code', x)))),
      h('li', 'Copy the ', h('b', 'Application (client) ID'), ' from Overview and paste it here.'));
    p.append(card('Microsoft app ID', h('p', 'Concourse reads Teams through Microsoft Graph, which needs an app registration. It’s free, takes about five minutes and only has to be done once — the same ID works for every computer and every friend you share Concourse with. There’s no secret: Concourse is a desktop (public) app, and your sign-in stays on this computer.'),
      s.clientIdFromConfig ? h('div.tag.green', 'Using the app ID built into this copy of Concourse') : null,
      h('div.frow', h('div.field.grow2', h('label', 'Application (client) ID'), cid), h('div.field', h('label', 'Directory (optional)'), ten)),
      h('div.row', h('button.btn.lamp', { onclick: () => run(C.call('setClientId', { clientId: cid.value, tenant: ten.value }), 'Saved') }, 'Save'),
        s.clientId ? h('button.btn', { title: 'For your IT admin: approves Concourse for everyone in your organisation', onclick: async () => { const u = await C.call('adminConsentUrl', {}); C.call('copy', { text: u }); toast('Admin consent link copied — send it to your IT admin'); } }, icon('copy'), 'Admin consent link') : null,
        h('span.dim', 'Leave Directory empty unless your IT asks for a specific tenant.')),
      h('details', h('summary', 'How to set it up'), steps,
        h('p.dim.small', 'If your organisation blocks apps that people approve themselves, sign-in will say an admin must approve Concourse. Send them the admin consent link (the button next to Save). Channel posts use “Read all channel messages”, which almost always needs that approval; everything else usually doesn’t.'))));
    if (!S.state.demo && !S.state.accounts.length) p.append(card('Just looking?', h('p', 'Open Concourse with a pretend company’s chats, meetings and tasks to see how it works.'), h('button.btn', { onclick: () => C.call('demo', { on: true }) }, 'Look around with sample data')));
  }
  async function signIn(hint) {
    toast('Finish signing in in your browser…', { ms: 8000 });
    try { const a = await C.call('signIn', { loginHint: hint }); toast(`Signed in as ${a.username}`, { tone: 'green' }); }
    catch (e) { toast(e.message.replace(/^Error invoking remote method 'call': (Error: )?/, ''), { tone: 'red', ms: 12000 }); }
  }

  // ───── board look
  function board(p) {
    const lamps = h('div.lamps', ...[['amber', 'Amber', '#ffb547'], ['cyan', 'Cyan', '#5ee0ff'], ['green', 'Signal', '#7dff9b'], ['white', 'Platinum', '#f2efe6']].map(([k, l, c]) => h('button.lampb' + (st().lamp === k ? '.on' : ''), { style: { '--c': c }, onclick: () => set({ lamp: k }).then(draw) }, h('span.sw2'), h('span', l))));
    const sample = h('span'); flap(sample, 'ON TIME', { tone: 'green' });
    p.append(card('Lamp colour', lamps), card('Board',
      toggle('Split-flap animation', 'flaps', 'Letters roll into place when the board changes'),
      segRow('Boarding window', 'boardMin', [[5, '5 min'], [10, '10 min'], [15, '15 min']], '“NOW BOARDING” shows this long before a meeting'),
      segRow('Working hours start', 'workHours', [[[7, 17], '7–17'], [[8, 18], '8–18'], [[9, 17], '9–17'], [[9, 18], '9–18'], [[6, 22], '6–22']], 'Used for the timetable and open platforms'),
      h('div.srow', h('span.sl', h('b', 'Preview')), sample)));
    // workHours seg: compare arrays
    $$('.srow', p).forEach(r => { const segs = $$('.seg button', r); if (segs.length === 5 && /7–17/.test(segs[0].textContent)) segs.forEach(b => b.classList.toggle('on', b.textContent.replace('–', ',') === st().workHours.join(','))); });
  }

  // ───── meetings
  async function meetings(p) {
    const docket = await C.call('docketAvailable').catch(() => false);
    const rem = h('div.seg', ...[[[10, 5, 1], '10, 5, 1'], [[5, 1], '5, 1'], [[1], '1'], [[], 'Off']].map(([v, l]) => h('button' + (JSON.stringify(st().remind) === JSON.stringify(v) ? '.on' : ''), { onclick: (e) => { $$('button', rem).forEach(b => b.classList.toggle('on', b === e.currentTarget)); set({ remind: v }); } }, l)));
    p.append(card('Joining',
      segRow('Join meetings', 'joinMode', [['browser', 'Browser'], ['window', 'Concourse window'], ['app', 'Teams app'], ['vantage', 'Vantage']], 'Browser is the most reliable. A Concourse window keeps the call separate from your tabs.'),
      toggle('Record with Docket', 'recordWithDocket', docket ? 'Docket starts taking notes when you join' : 'Docket isn’t running right now — it will be asked when you join'),
      h('div.srow', h('span.sl', h('b', 'Join next meeting from anywhere'), h('em', 'Global shortcut')), (() => { const i = h('input.input.mono', { value: st().shortcut || '', placeholder: 'CommandOrControl+Shift+J' }); i.onchange = () => set({ shortcut: i.value.trim() }); return i; })())),
      card('Reminders', h('div.srow', h('span.sl', h('b', 'Remind me'), h('em', 'Minutes before each meeting, with a Join button')), rem)));
  }

  // ───── notifications
  function notify(p) {
    const n = (k) => [(s) => s.notify[k], (v) => ({ notify: { [k]: v } })];
    const qf = h('input.input.mono', { type: 'time', value: st().quiet.from }), qt = h('input.input.mono', { type: 'time', value: st().quiet.to });
    qf.onchange = qt.onchange = () => set({ quiet: { from: qf.value, to: qt.value } });
    p.append(card('Notifications',
      toggle('New messages', 'n', 'A notification for each new chat message', ...n('messages')),
      toggle('Only mentions and 1:1 chats', 'n', 'Group chats stay quiet unless you’re mentioned or it’s urgent', ...n('mentionsOnly')),
      toggle('Meeting reminders', 'n', null, ...n('meetings')),
      toggle('Sound', 'n', null, ...n('sound')),
      h('p.dim.small', 'When your Teams status is Do not disturb, only urgent messages notify.')),
      card('Quiet hours', toggle('Quiet hours', 'q', 'No notifications in this window', (s) => s.quiet.on, (v) => ({ quiet: { on: v } })), h('div.frow', h('div.field', h('label', 'From'), qf), h('div.field', h('label', 'To'), qt))));
  }

  // ───── tasks
  function tasks(p) {
    const sel = h('select.input', h('option', { value: 'local' }, 'This computer'));
    for (const a of S.state.accounts) for (const l of (S.state.todoLists || {})[a.id] || []) sel.append(h('option', { value: `todo:${a.id}:${l.id}` }, `Microsoft To Do · ${l.name}`));
    sel.value = st().taskTarget || 'local'; sel.onchange = () => set({ taskTarget: sel.value });
    p.append(card('Tasks', h('div.srow', h('span.sl', h('b', 'New tasks go to'), h('em', 'To Do syncs with Teams, Outlook and your phone')), sel), toggle('Show Microsoft To Do tasks', 'showTodo', 'On the Board and in the Manifest')));
  }

  // ───── general
  async function general(p) {
    const v = await C.call('version').catch(() => '');
    p.append(card('General',
      st().platform === 'darwin' ? toggle('Countdown in the menu bar', 'menubar', 'Minutes to your next meeting next to the Concourse icon') : null,
      toggle('Keep running when the window closes', 'closeToTray', 'Reminders and notifications keep working'),
      toggle('Open at login', 'launchAtLogin', 'Starts quietly in the background')),
      card('About', h('p', `Concourse ${v} — part of the Utility Suite.`), h('p.dim.small', 'Talks to Microsoft 365 through Microsoft Graph with your own sign-in. Tokens are stored encrypted with the system keychain. Nothing is sent anywhere else.'),
        h('div.row', h('button.btn', { onclick: () => run(C.call('refresh', {}), 'Refreshed') }, icon('refresh'), 'Refresh everything'))));
  }

  S.views.settings = { mount, update: (parts) => { if (parts.some(x => ['accounts', 'all', 'errors', 'me', 'todo'].includes(x)) && section !== 'board') draw(); }, arg: (a) => { if (a.section) { section = a.section; draw(); } } };
})();
