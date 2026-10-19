/* Onward — people on each job (recruiters, hiring managers, referrals) and tailored outreach */
(() => {
  const A = window.App;
  const { $, $$, esc } = A;
  const CH = { email: 'Email', linkedin: 'LinkedIn message', connect: 'Connection note' };
  const GOALS = [
    ['intro', 'Introduce myself'], ['followup', 'Follow up on my application'], ['referral', 'Ask for a referral or a quick chat'], ['thanks', 'Thank them after an interview']
  ];
  const GOAL_TEXT = { intro: 'introduce themselves and express interest in the role', followup: 'follow up on the application they already submitted and reaffirm fit', referral: 'ask for a brief chat or a referral for the role', thanks: 'thank them after the interview and reinforce one key point' };
  const clean = (e) => String(e?.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

  function section(j) {
    const people = j.contacts || [];
    const msg = (c, m) => `<button class="msg-row" data-msg="${c.id}:${m.id}">${icon(m.channel === 'email' ? 'letter' : 'send')}<span class="m-ch">${CH[m.channel] || m.channel}</span><span class="m-prev">${esc((m.subject || m.body || '').slice(0, 70))}</span><span class="m-st ${m.status}">${m.status === 'sent' ? 'Sent ' + A.date(m.sentAt) : 'Draft'}</span></button>`;
    return `<div class="d-sec" id="peopleSec"><h3>${icon('person')}People<span style="flex:1"></span><button class="btn sm ghost" id="pAdd">${icon('plus')}Add person</button></h3>
      ${people.length ? people.map(c => `
        <div class="person-card" data-id="${c.id}">
          <div class="person">
            <div class="avatar">${esc((c.name || c.email || '?')[0].toUpperCase())}</div>
            <div class="p-main"><b>${esc(c.name || c.email || 'Unnamed')}</b><span>${esc([c.title, c.role].filter(Boolean).join(' · ') || c.source || '')}</span>
              <div class="p-links">${c.email ? `<span class="chip">${icon('letter')}${esc(c.email)}</span>` : ''}${c.phone ? `<span class="chip">${esc(c.phone)}</span>` : ''}${c.linkedin ? `<button class="chip linkish" data-li="${esc(c.linkedin)}">${icon('external')}LinkedIn</button>` : ''}</div></div>
            <div class="p-acts"><button class="btn sm primary" data-compose="${c.id}">${icon('send')}Message</button><button class="btn sm icon ghost" data-edit="${c.id}" title="Edit">${icon('note')}</button><button class="btn sm icon ghost danger" data-del="${c.id}" title="Remove">${icon('x')}</button></div>
          </div>
          ${c.messages?.length ? `<div class="msgs">${[...c.messages].reverse().map(m => msg(c, m)).join('')}</div>` : ''}
        </div>`).join('')
      : `<p class="hint">No one saved yet. Add the recruiter or hiring manager — Onward writes them a tailored message you can send by email or LinkedIn.</p>
         <button class="btn sm" id="pFind">${icon('search')}Find ${esc(j.company || 'company')} recruiters on LinkedIn</button>`}
    </div>`;
  }

  function bind(root, j) {
    $('#pAdd', root) && ($('#pAdd', root).onclick = () => edit(j.id));
    $('#pFind', root) && ($('#pFind', root).onclick = () => { A.views.jobs.close(); A.views.browser.open(`https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent((j.company || '') + ' recruiter')}`, { jobId: j.id }); A.toast('Found someone? Use “Add person” on the job to save them.', 5000); });
    $$('[data-compose]', root).forEach(b => b.onclick = () => compose(j.id, b.dataset.compose));
    $$('[data-edit]', root).forEach(b => b.onclick = () => edit(j.id, b.dataset.edit));
    $$('[data-del]', root).forEach(b => b.onclick = async () => { await onward.removeContact(j.id, b.dataset.del); await A.load(); A.render(); });
    $$('[data-li]', root).forEach(b => b.onclick = () => { A.views.jobs.close(); A.views.browser.open(b.dataset.li, { jobId: j.id }); });
    $$('[data-msg]', root).forEach(b => b.onclick = () => { const [cid, mid] = b.dataset.msg.split(':'); compose(j.id, cid, mid); });
  }

  function edit(jobId, contactId) {
    const j = A.state.jobs.find(x => x.id === jobId);
    const c = (j.contacts || []).find(x => x.id === contactId) || {};
    const f = (k, label, ph = '', wide) => `<label class="field ${wide ? 'wide' : ''}"><span>${label}</span><input class="input" name="${k}" value="${esc(c[k] || '')}" placeholder="${esc(ph)}"></label>`;
    A.modal(`<h2>${contactId ? 'Edit person' : 'Add a person'}</h2>
      <form class="form" id="pForm">
        ${f('name', 'Name', 'Jane Doe')}${f('title', 'Their title', 'Talent Acquisition Partner')}
        ${f('email', 'Email', 'jane@company.com')}${f('phone', 'Phone', '')}
        ${f('linkedin', 'LinkedIn profile', 'https://www.linkedin.com/in/…', true)}
        <label class="field"><span>Role in this search</span><select class="input" name="role">${['', 'Recruiter', 'Hiring manager', 'Referral', 'Team member', 'Other'].map(r => `<option ${r === (c.role || '') ? 'selected' : ''} value="${r}">${r || '—'}</option>`).join('')}</select></label>
        ${f('notes', 'Notes', 'Met at…')}
      </form>
      <div class="foot"><button class="btn" data-x>Cancel</button><button class="btn primary" data-ok>${contactId ? 'Save' : 'Add'}</button></div>`, (m, close) => {
      $('[data-x]', m).onclick = close;
      $('[data-ok]', m).onclick = async () => {
        const data = Object.fromEntries(new FormData($('#pForm', m)).entries());
        if (!data.name && !data.email && !data.linkedin) { A.toast('Add a name, email or LinkedIn link'); return; }
        await onward.saveContact(jobId, { ...data, id: contactId, source: c.source || 'Added by you' });
        close(); await A.load(); A.render();
      };
      $('input', m).focus();
    });
  }

  // ---------- composer ----------
  function compose(jobId, contactId, messageId) {
    const j = A.state.jobs.find(x => x.id === jobId);
    const c = (j?.contacts || []).find(x => x.id === contactId);
    if (!c) return;
    const existing = messageId && c.messages.find(m => m.id === messageId);
    const st = { id: existing?.id || null, channel: existing?.channel || (c.email ? 'email' : 'linkedin'), goal: j.submitted?.appliedAt ? 'followup' : 'intro', busy: false };
    A.modal(`<h2>Message ${esc(c.name || c.email)}</h2>
      <div class="cmp-to">${icon('person')}<span>${esc([c.title, j.company].filter(Boolean).join(' · '))}</span></div>
      <div class="cmp-row">
        <div class="seg" id="cCh">${Object.entries(CH).map(([k, v]) => `<button data-ch="${k}">${v}</button>`).join('')}</div>
        <select class="input" id="cGoal" style="width:auto">${GOALS.map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>
      </div>
      <label class="field" id="cSubjWrap"><span>Subject</span><input class="input" id="cSubj" value="${esc(existing?.subject || '')}"></label>
      <label class="field"><span style="display:flex">Message<span style="flex:1"></span><span id="cCount"></span></span><textarea class="input" id="cBody" rows="10" placeholder="Write it yourself, or press “Write with AI”.">${esc(existing?.body || '')}</textarea></label>
      <div class="cmp-ai"><button class="btn" id="cAi">${icon('spark')}Write with AI</button><span class="hint" id="cAiHint">Uses ${esc(A.AI.engineLabel())} with your resume and this job. You review before anything is sent.</span></div>
      <div class="cmp-sent" id="cSent"></div>
      <div class="foot"><button class="btn ghost" data-x>Close</button><button class="btn" id="cSave">Save draft</button><button class="btn primary" id="cSend"></button></div>`, (m, close) => {
      const body = $('#cBody', m), subj = $('#cSubj', m);
      $('#cGoal', m).value = st.goal;
      const refresh = () => {
        $$('#cCh [data-ch]', m).forEach(b => { b.classList.toggle('active', b.dataset.ch === st.channel); b.disabled = b.dataset.ch === 'email' && !c.email; b.title = b.disabled ? 'No email saved for this person' : ''; });
        $('#cSubjWrap', m).style.display = st.channel === 'email' ? '' : 'none';
        const n = body.value.length, lim = st.channel === 'connect' ? 300 : 0;
        $('#cCount', m).innerHTML = lim ? `<span class="${n > lim ? 'over' : ''}">${n}/${lim}</span>` : `${n} chars`;
        const via = A.state.settings.emailVia || 'mailapp';
        $('#cSend', m).innerHTML = st.channel === 'email' ? `${icon('send')}Open in ${{ mailapp: 'Mail app', gmail: 'Gmail', outlook: 'Outlook' }[via]}` : `${icon('external')}Copy & open LinkedIn`;
      };
      refresh();
      body.oninput = refresh;
      $$('#cCh [data-ch]', m).forEach(b => b.onclick = () => { st.channel = b.dataset.ch; refresh(); });
      $('#cGoal', m).onchange = (e) => { st.goal = e.target.value; };
      $('[data-x]', m).onclick = async () => { close(); await A.load(); A.render(); };
      const save = async (extra = {}) => {
        const msg = await onward.saveMessage(jobId, contactId, { id: st.id, channel: st.channel, subject: subj.value, body: body.value, ...extra });
        st.id = msg.id; return msg;
      };
      $('#cSave', m).onclick = async () => { if (!body.value.trim()) return; await save(); A.toast('Draft saved'); };
      $('#cAi', m).onclick = async () => {
        if (st.busy) return;
        st.busy = true; $('#cAi', m).disabled = true; $('#cAiHint', m).textContent = `${A.AI.engineLabel()} is writing…`;
        try {
          if (st.id === null && body.value.trim()) await save();
          const r = await A.AI.run('message', { jobId, contactId, channel: st.channel, goal: GOAL_TEXT[st.goal], messageId: st.id || undefined });
          st.id = r.message.id; body.value = r.message.body || ''; subj.value = r.message.subject || ''; refresh();
          $('#cAiHint', m).textContent = 'Done — edit anything you like, then send.';
        } catch (e) { $('#cAiHint', m).textContent = clean(e); }
        finally { st.busy = false; $('#cAi', m).disabled = false; }
      };
      $('#cSend', m).onclick = async () => {
        const text = body.value.trim();
        if (!text) { A.toast('Write the message first'); return; }
        if (st.channel === 'connect' && text.length > 300) { A.toast('Connection notes must be 300 characters or fewer'); return; }
        await save();
        const markSent = async () => { await save({ status: 'sent' }); await A.load(); A.render(); A.toast('Logged as sent'); };
        const via = A.state.settings.emailVia || 'mailapp';
        if (st.channel === 'email' && via === 'mailapp') {
          sendEmail(c.email, subj.value, text);
          $('#cSent', m).innerHTML = `<div class="banner small">${icon('check')}<div class="msg">Your mail app has the message. Once it's sent, mark it so Onward keeps track.</div><button class="btn sm primary" id="cMark">Mark as sent</button></div>`;
          $('#cMark', m).onclick = async () => { await markSent(); close(); };
          return;
        }
        close();
        if (st.channel === 'email') sendEmail(c.email, subj.value, text, markSent);
        else openLinkedIn(j, c, text, markSent);
      };
    });
  }

  function sendEmail(to, subject, body, markSent) {
    const via = A.state.settings.emailVia || 'mailapp';
    const e = encodeURIComponent;
    const banner = (name) => ({ html: `Your message is ready in ${name} — check it and press <b>Send</b>.`, action: markSent && { label: 'Mark as sent', fn: markSent } });
    if (via === 'gmail') return A.views.browser.open(`https://mail.google.com/mail/?view=cm&fs=1&to=${e(to)}&su=${e(subject)}&body=${e(body)}`, { banner: banner('Gmail') });
    if (via === 'outlook') return A.views.browser.open(`https://outlook.office.com/mail/deeplink/compose?to=${e(to)}&subject=${e(subject)}&body=${e(body)}`, { banner: banner('Outlook') });
    onward.openExternal(`mailto:${encodeURIComponent(to)}?subject=${e(subject)}&body=${e(body)}`);
  }

  function openLinkedIn(j, c, text, markSent) {
    onward.claude.copy(text);
    const url = c.linkedin || `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent([c.name, j.company].filter(Boolean).join(' '))}`;
    A.views.browser.open(url, { jobId: j.id, banner: { html: `Message copied. On ${c.name ? esc(c.name.split(' ')[0]) + '’s' : 'their'} profile press <b>Message</b> (or <b>Connect → Add a note</b>), paste with <b>⌘V</b>, and send.`, action: markSent && { label: 'Mark as sent', fn: markSent }, copy: text } });
  }

  A.People = { section, bind, compose, edit };
})();
