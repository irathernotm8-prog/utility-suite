// Trace — starting points for new charts, plus the Welcome project.
(function () {
  const T = window.T;
  const now = () => new Date().toISOString();

  T.NODE_TYPES = {
    step: { label: 'Step', icon: 'step', color: 'violet' },
    start: { label: 'Start', icon: 'start', color: 'green' },
    end: { label: 'End', icon: 'end', color: 'rose' },
    decision: { label: 'If / question', icon: 'decision', color: 'amber' },
    and: { label: 'And', icon: 'and', color: 'cyan' },
    or: { label: 'Or', icon: 'or', color: 'cyan' },
    person: { label: 'Person', icon: 'person', color: 'blue' },
    folder: { label: 'Folder', icon: 'folder', color: 'amber' },
    file: { label: 'File', icon: 'file', color: 'slate' },
    note: { label: 'Sticky note', icon: 'sticky', color: 'lime' },
    image: { label: 'Screenshot', icon: 'image', color: 'slate' }
  };

  T.newNode = (type = 'step', title = '', extra = {}) => Object.assign({
    id: T.uid(10), type, title: title || (type === 'and' ? 'AND' : type === 'or' ? 'OR' : ''), sub: '', color: '', note: '', images: [], rules: [], link: ''
  }, extra);
  T.newEdge = (from, to, label = '', extra = {}) => Object.assign({ id: T.uid(10), from, to, label }, extra);
  T.newChart = (title, extra = {}) => Object.assign({
    id: T.uid(10), type: 'chart', title: title || 'Untitled chart', orientation: 'vertical', layout: 'auto', edgeStyle: 'elbow', spacing: 1,
    nodes: [], edges: [], scenarios: [], created: now(), updated: now()
  }, extra);
  T.newNote = (title, html = '') => ({ id: T.uid(10), type: 'note', title: title || 'Untitled note', html, created: now(), updated: now() });
  T.newGuide = (title) => ({ id: T.uid(10), type: 'guide', title: title || 'Untitled guide', intro: '', steps: [], created: now(), updated: now() });
  T.newStep = (media, title = '', html = '') => ({ id: T.uid(10), media: media || null, title, html });

  // Builds a chart from a compact spec: nodes as [key, type, title, extra], edges as [fromKey, toKey, label]
  function build(title, spec, extra) {
    const c = T.newChart(title, extra);
    const map = {};
    for (const [k, type, t, ex] of spec.nodes) { const n = T.newNode(type, t, ex || {}); map[k] = n.id; c.nodes.push(n); }
    for (const [a, b, label, ex] of spec.edges) c.edges.push(T.newEdge(map[a], map[b], label || '', ex || {}));
    c._keys = map;
    return c;
  }

  const TEMPLATES = {
    blank: {
      label: 'Blank chart', icon: 'plus', blurb: 'One starting point. Press Tab to add steps.',
      make: (o) => build('Untitled chart', { nodes: [['a', 'start', 'Start']], edges: [] }, o)
    },
    decision: {
      label: 'Decision tree', icon: 'decision', blurb: 'If / and / or logic with yes-no branches.',
      make: (o) => build('Should the weekly report go out?', {
        nodes: [
          ['req', 'start', 'Report is due', { note: '<p>Every Monday by 10am. Trace this chart to see every way it can go.</p>' }],
          ['full', 'decision', 'Is the full week of data in?', { note: '<p>Check the date range ends on Sunday and the last sync finished.</p>' }],
          ['wait', 'step', 'Wait for the morning refresh', { sub: 'Usually done by 8:30' }],
          ['match', 'decision', 'Do totals match the dashboard?'],
          ['and', 'and', 'AND', { note: '<p>Both of these have to be true before it goes out.</p>' }],
          ['ok', 'step', 'Manager has signed off'],
          ['fresh', 'step', 'Charts are refreshed'],
          ['gap', 'step', 'Find the gap', { sub: 'Filters, date range, sources', note: '<ul><li>Same date range on both?</li><li>Any filter left on from last week?</li><li>Did a source fail to sync?</li></ul>' }],
          ['or', 'or', 'OR'],
          ['fixed', 'step', 'Fixed it: pull again'],
          ['flag', 'step', 'Can’t fix: flag it in the email'],
          ['send', 'end', 'Send the report']
        ],
        edges: [['req', 'full'], ['full', 'wait', 'No'], ['wait', 'full', 'Check again'], ['full', 'match', 'Yes'], ['match', 'and', 'Yes'], ['and', 'ok'], ['and', 'fresh'],
          ['ok', 'send'], ['fresh', 'send'], ['match', 'gap', 'No'], ['gap', 'or'], ['or', 'fixed'], ['or', 'flag'], ['fixed', 'match', 'Re-check'], ['flag', 'send']]
      }, o)
    },
    org: {
      label: 'Org chart', icon: 'people', blurb: 'People, roles and who reports to whom.',
      make: (o) => build('Marketing team', {
        nodes: [
          ['head', 'person', 'Jordan Ellis', { sub: 'Head of Marketing', color: 'violet' }],
          ['dig', 'person', 'Sam Rivera', { sub: 'Digital & Social Supervisor', color: 'blue' }],
          ['brand', 'person', 'Priya Nair', { sub: 'Brand Manager', color: 'pink' }],
          ['ops', 'person', 'Chris Okafor', { sub: 'Marketing Ops', color: 'green' }],
          ['d1', 'person', 'Lee Park', { sub: 'Paid Social Specialist' }],
          ['d2', 'person', 'Morgan Diaz', { sub: 'Content Producer' }],
          ['d3', 'person', 'Taylor Brooks', { sub: 'Community Manager' }],
          ['d4', 'person', 'Avery Chen', { sub: 'Video Editor' }],
          ['b1', 'person', 'Jamie Fox', { sub: 'Designer' }],
          ['b2', 'person', 'Riley Shaw', { sub: 'Copywriter' }],
          ['o1', 'person', 'Casey Lin', { sub: 'CRM & Reporting Analyst' }]
        ],
        edges: [['head', 'dig'], ['head', 'brand'], ['head', 'ops'], ['dig', 'd1'], ['dig', 'd2'], ['dig', 'd3'], ['dig', 'd4'], ['brand', 'b1'], ['brand', 'b2'], ['ops', 'o1']]
      }, o)
    },
    folders: {
      label: 'Folder plan', icon: 'folder', blurb: 'Where every kind of file belongs. Ask it “where does this go?”',
      make: (o) => build('Where files go', {
        nodes: [
          ['home', 'folder', 'Home', { sub: '~', note: '<p>One rule: nothing lives loose on the Desktop or in Downloads for more than a week.</p>' }],
          ['docs', 'folder', 'Documents', { sub: '~/Documents', rules: ['.pdf', '.docx', '.txt', '.pages'] }],
          ['work', 'folder', 'Work', { sub: '~/Documents/Work', rules: ['report*', 'deck*', 'brief*', '.pptx', '.key', '.xlsx', '.csv'] }],
          ['fin', 'folder', 'Finance', { sub: '~/Documents/Finance', rules: ['invoice*', 'receipt*', 'statement*', 'tax*', 'w2*', 'paystub*'] }],
          ['pers', 'folder', 'Personal', { sub: '~/Documents/Personal', rules: ['resume*', 'lease*', 'passport*', 'insurance*'] }],
          ['design', 'folder', 'Design', { sub: '~/Design' }],
          ['src', 'folder', 'Source files', { sub: '~/Design/Source', rules: ['.psd', '.ai', '.fig', '.indd', '.afdesign', '.sketch', '.xd'] }],
          ['exp', 'folder', 'Exports', { sub: '~/Design/Exports', rules: ['.png', '.svg', '.webp', '.gif'] }],
          ['fonts', 'folder', 'Fonts', { sub: '~/Design/Fonts', rules: ['.otf', '.ttf', '.woff', '.woff2'] }],
          ['media', 'folder', 'Media', { sub: '~/Media' }],
          ['photos', 'folder', 'Photos', { sub: '~/Pictures', rules: ['.jpg', '.jpeg', '.heic', '.raw', '.cr3', '.dng', 'img_*'] }],
          ['video', 'folder', 'Video', { sub: '~/Movies', rules: ['.mp4', '.mov', '.mkv', '.prproj', '.capcut'] }],
          ['audio', 'folder', 'Audio', { sub: '~/Music', rules: ['.mp3', '.wav', '.m4a', '.aac', '.flac'] }],
          ['code', 'folder', 'Code', { sub: '~/Code', rules: ['.js', '.py', '.json', '.html', '.css', '.ts', '.sh'] }],
          ['arch', 'folder', 'Archive', { sub: '~/Archive', rules: ['.zip', '.dmg', '.pkg', '.exe', '.msi', '.rar', '.7z'] }]
        ],
        edges: [['home', 'docs'], ['docs', 'work'], ['docs', 'fin'], ['docs', 'pers'], ['home', 'design'], ['design', 'src'], ['design', 'exp'], ['design', 'fonts'],
          ['home', 'media'], ['media', 'photos'], ['media', 'video'], ['media', 'audio'], ['home', 'code'], ['home', 'arch']]
      }, o)
    },
    workflow: {
      label: 'Workflow', icon: 'route', blurb: 'A left-to-right process with owners and notes.',
      make: (o) => build('Monthly report workflow', {
        nodes: [
          ['s', 'start', 'Month closes'], ['pull', 'step', 'Pull the numbers', { sub: 'Ads, GA4, CRM' }], ['clean', 'step', 'Clean and check', { sub: 'Remove test leads' }],
          ['build', 'step', 'Build the slides'], ['rev', 'decision', 'Reviewed by manager?'], ['fix', 'step', 'Make the edits'], ['send', 'end', 'Present to leadership']
        ],
        edges: [['s', 'pull'], ['pull', 'clean'], ['clean', 'build'], ['build', 'rev'], ['rev', 'send', 'Approved'], ['rev', 'fix', 'Changes'], ['fix', 'rev', 'Resubmit']]
      }, Object.assign({ orientation: 'horizontal' }, o))
    }
  };
  T.TEMPLATES = TEMPLATES;
  T.fromTemplate = (key, extra) => { const c = TEMPLATES[key].make(extra); delete c._keys; return c; };

  // Welcome project content. Images for the guide are added after the project exists (see app.js seedWelcome).
  T.welcomeItems = () => {
    const note = T.newNote('Start here', `
<h1>Welcome to Trace</h1>
<p>Trace maps how things connect (decisions, people, folders, processes), then walks you down any path with a smooth zoom so you can explain it.</p>
<h2>The basics</h2>
<ul class="checklist">
<li data-checked="false">Open <b>Should the weekly report go out?</b> and press <b>T</b> to trace it from the top. Pick a branch with the number keys.</li>
<li data-checked="false">Select any step and press <b>Tab</b> to add the next one, <b>Enter</b> to add a sibling.</li>
<li data-checked="false">Flip a chart between <b>vertical</b> and <b>horizontal</b> from the toolbar.</li>
<li data-checked="false">Every step has its own <b>note</b> and <b>images</b> in the panel on the right.</li>
<li data-checked="false">Open <b>Where files go</b> and type a file name like <code>invoice-march.pdf</code> into “Where does it go?”.</li>
<li data-checked="false">Open the <b>Capture bar</b> and take screenshots while you click through another app. They land in Captures, ready to turn into a guide.</li>
</ul>
<h2>Presenting and sharing</h2>
<p>Press <b>${T.kbd('Mod+Enter')}</b> on any chart, note or guide to present it full screen, and <b>${T.kbd('Mod+E')}</b> to export it to PDF.</p>
<blockquote>Tip: <b>${T.kbd('Mod+K')}</b> finds anything (charts, notes, even a single step inside a chart).</blockquote>`);
    const decision = T.fromTemplate('decision');
    // a saved scenario: the happy path
    const ids = decision.nodes.map((n) => n.id);
    const byTitle = (t) => decision.nodes.find((n) => n.title.startsWith(t)).id;
    const happy = [byTitle('Report is due'), byTitle('Is the full week'), byTitle('Do totals'), byTitle('AND'), byTitle('Manager'), byTitle('Send')];
    const late = [byTitle('Report is due'), byTitle('Is the full week'), byTitle('Do totals'), byTitle('Find the gap'), byTitle('OR'), byTitle('Can’t fix'), byTitle('Send')];
    decision.scenarios = [
      { id: T.uid(8), name: 'Everything checks out', color: 'green', path: happy },
      { id: T.uid(8), name: 'Numbers don’t match', color: 'rose', path: late }
    ];
    void ids;
    const org = T.fromTemplate('org');
    const folders = T.fromTemplate('folders');
    const workflow = T.fromTemplate('workflow');
    const guide = T.newGuide('How to pull the weekly sign-up report');
    guide.intro = '<p>A walkthrough built from screenshots. Each step has the picture, what to click, and why.</p>';
    return [note, decision, org, folders, workflow, guide];
  };
})();
