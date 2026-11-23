// Concourse — Teams: your teams and channels, channel posts with their replies, new posts and replies.
(() => {
  let root, els = {}, cur = null, posts = [], pollT = null;

  function mount(main, arg) {
    root = main; els = {};
    els.tree = h('div.ttree');
    els.side = h('aside.cside', h('div.chead', h('span.title.led', 'Teams'), h('span.grow'), h('button.btn.sm.icon', { title: 'Reload teams', html: ic('refresh'), onclick: () => loadTeams(true) })), els.tree);
    els.feed = h('section.thread');
    main.append(els.side, els.feed);
    loadTeams(false);
    if (cur) openChannel(cur.accountId, cur.team, cur.channel); else empty();
  }
  function unmount() { clearTimeout(pollT); }

  async function loadTeams(force) {
    els.tree.textContent = ''; els.tree.append(h('div.loading.led.dim', 'Loading teams…'));
    const out = [];
    for (const a of S.state.accounts) {
      try { out.push({ acc: a, teams: await C.call('teams', { accountId: a.id, force }) }); }
      catch (e) { out.push({ acc: a, error: e.message.replace(/^Error invoking remote method 'call': (Error: )?/, '') }); }
    }
    els.tree.textContent = '';
    for (const { acc, teams, error } of out) {
      if (S.state.accounts.length > 1) els.tree.append(h('div.lh.eyebrow', acc.username));
      if (error) { els.tree.append(h('div.terr.on', error)); continue; }
      if (!teams.length) els.tree.append(h('div.empty', 'You’re not in any teams'));
      for (const t of teams) {
        const open = !cur || cur.team.id === t.id || teams.length <= 4;
        const list = h('div.chans' + (open ? '.on' : ''));
        for (const c of t.channels) list.append(h('button.chan' + (cur && cur.channel.id === c.id ? '.on' : ''), { onclick: () => openChannel(acc.id, t, c) }, icon('hash'), h('span', c.name), c.type !== 'standard' ? h('span.tag', c.type === 'private' ? 'Private' : 'Shared') : null));
        els.tree.append(h('div.team', h('button.tname', { onclick: () => list.classList.toggle('on') }, h('span.avatar.sm.group', initials(t.name)), h('span', t.name)), list));
      }
    }
  }

  function empty() {
    els.feed.textContent = '';
    const t = h('span'); flap(t, 'SELECT A CHANNEL', { tone: 'dim' });
    els.feed.append(h('div.tempty', t, h('p', 'Channels from every team you’re in are on the left.')));
  }

  async function openChannel(accountId, team, channel) {
    cur = { accountId, team, channel }; clearTimeout(pollT);
    $$('.chan', els.tree).forEach(b => b.classList.toggle('on', b.textContent.trim().startsWith(channel.name) && b.closest('.team').querySelector('.tname').textContent.includes(team.name)));
    const f = els.feed; f.textContent = '';
    f.append(h('header.thead', h('div.tt', h('div.tn', h('span.led.dim', team.name.toUpperCase() + ' ▸ '), channel.name), h('div.tsub', team.description || '')), h('div.tacts', h('button.btn.sm.lamp', { onclick: () => newPost() }, icon('plus'), 'New post'))));
    els.posts = h('div.msgs.posts'); f.append(els.posts);
    els.posts.append(h('div.loading.led.dim', 'Loading posts…'));
    await load(true);
  }

  async function load(scroll) {
    if (!cur) return; const c = cur;
    const acc = D.acc(c.accountId);
    try { posts = await C.call('channelMessages', { accountId: c.accountId, teamId: c.team.id, channelId: c.channel.id }); if (cur !== c) return; draw(scroll); }
    catch (e) {
      if (cur !== c) return; els.posts.textContent = '';
      const msg = e.message.replace(/^Error invoking remote method 'call': (Error: )?/, '');
      const needs = /403|Forbidden|denied|permission|consent|scope|Missing/i.test(msg) || (acc && !acc.channels);
      els.posts.append(h('div.gate-card',
        h('div.led', needs ? 'CHANNEL POSTS NEED ONE MORE PERMISSION' : 'COULDN’T LOAD POSTS'),
        h('p', needs ? 'Reading channel posts uses Microsoft’s “Read all channel messages” permission. In most organisations an admin has to approve it once. You can still post here and use chats, meetings and tasks.' : msg),
        needs ? h('div.row', h('button.btn.lamp', { onclick: () => run(C.call('enableChannels', { accountId: c.accountId }), 'Channel reading turned on').then(() => load(true)) }, 'Turn on channel reading'),
          h('button.btn', { onclick: async () => { const u = await C.call('adminConsentUrl', { accountId: c.accountId }); C.call('copy', { text: u }); toast('Admin consent link copied — send it to your IT admin'); } }, icon('copy'), 'Copy admin link')) : null));
    }
    clearTimeout(pollT); pollT = setTimeout(() => load(false), 20000);
  }

  function draw(scroll) {
    const box = els.posts; const keep = box.scrollTop; box.textContent = '';
    if (!posts.length) { box.append(h('div.empty', 'No posts yet. Start the conversation.')); return; }
    for (const p of posts) {
      if (p.messageType && p.messageType !== 'message') continue;
      const who = (p.from && p.from.user) || {};
      const card = h('article.post');
      card.append(h('div.phead', avatar({ name: who.displayName, id: who.id }, { accountId: cur.accountId }), h('div', h('b', who.displayName || 'Someone'), h('span.mono', `${relDay(Date.parse(p.createdDateTime))} ${timeLabel(Date.parse(p.createdDateTime))}`))));
      if (p.subject) card.append(h('div.psubj', p.subject));
      const body = h('div.btext'); body.innerHTML = safeHtml(p.body && p.body.content); card.append(body);
      const reps = (p.replies || []).slice().sort((a, b) => Date.parse(a.createdDateTime) - Date.parse(b.createdDateTime));
      if (reps.length) {
        const rl = h('div.replies');
        for (const r of reps) { const rw = (r.from && r.from.user) || {}; const rb = h('div.btext'); rb.innerHTML = safeHtml(r.body && r.body.content); rl.append(h('div.reply', avatar({ name: rw.displayName, id: rw.id }, { size: 'sm', accountId: cur.accountId }), h('div', h('div.rname', rw.displayName || '', h('span.mono', timeLabel(Date.parse(r.createdDateTime)))), rb))); }
        card.append(rl);
      }
      const ri = h('input.input.bare', { placeholder: 'Reply…' });
      ri.addEventListener('keydown', async (e) => {
        if (e.key !== 'Enter' || !ri.value.trim()) return;
        const html = compose(ri.value); ri.value = '';
        await run(C.call('replyChannel', { accountId: cur.accountId, teamId: cur.team.id, channelId: cur.channel.id, messageId: p.id, html }));
        load(false);
      });
      card.append(h('div.preply', icon('reply'), ri));
      box.append(card);
    }
    hydrateImages(box, cur.accountId);
    box.scrollTop = scroll ? box.scrollHeight : keep;
  }

  function newPost() {
    const m = modal({ title: `Post in ${cur.channel.name}` });
    const subj = h('input.input', { placeholder: 'Subject (optional)' });
    const body = h('textarea.input', { rows: 6, placeholder: 'What’s happening?' });
    m.body.append(h('div.field', h('label', 'Subject'), subj), h('div.field', h('label', 'Post'), body));
    m.foot.append(h('div.grow'), h('button.btn.ghost', { onclick: () => m.close() }, 'Cancel'), h('button.btn.lamp', { onclick: async () => {
      if (!body.value.trim()) return;
      await run(C.call('postChannel', { accountId: cur.accountId, teamId: cur.team.id, channelId: cur.channel.id, html: compose(body.value), subject: subj.value.trim() }), 'Posted');
      m.close(); load(true);
    } }, 'Post'));
    body.focus();
  }

  S.views.teams = { mount, unmount, update: () => {} };
})();
