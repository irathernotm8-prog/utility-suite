// Stand-in for `claude -p` in the end-to-end run: answers the weekly-summary prompt and the template-mapping prompt.
'use strict';
let s = '';
process.stdin.on('data', (d) => (s += d)).on('end', () => {
  if (process.argv.includes('--version')) return console.log('2.1.0 (Claude Code)');
  if (/You map a PowerPoint template/.test(s)) {
    const json = s.split('TEMPLATE (slides, with each element’s id, name, kind and current content):')[1].trim().split('\n\n')[0];
    const slides = JSON.parse(json); const fills = [];
    const by = (name) => { for (const sl of slides) for (const sh of sl.shapes) if (sh.name === name) return { slide: sl.slide, shape: { id: sh.id, name: sh.name } }; return null; };
    const add = (name, f) => { const at = by(name); if (at) fills.push({ ...at, ...f }); };
    add('Date range', { kind: 'text', value: '{{lastWeek.range}}' });
    add('Spend value', { kind: 'text', value: '{{steps.lumen.values.kpis.Spend}}' });
    add('Conversions value', { kind: 'text', value: '{{steps.lumen.values.kpis.Conversions}}' });
    add('Cost per conversion value', { kind: 'text', value: '{{steps.lumen.values.kpis["Cost per conversion"]}}' });
    add('Spend change', { kind: 'text', value: '{{steps.lumen.tables.kpis.rows[0].Change}}' });
    add('Conversions change', { kind: 'text', value: '{{steps.lumen.tables.kpis.rows[1].Change}}' });
    add('Cost per conversion change', { kind: 'text', value: '{{steps.lumen.tables.kpis.rows[2].Change}}' });
    add('Campaign table', { kind: 'table', table: '{{steps.lumen.tables.campaigns}}', columns: ['Campaign', 'Spend', 'Conv.', 'Cost / conv.'] });
    add('Spend chart', { kind: 'chart', table: '{{steps.lumen.tables.campaigns}}', x: 'Campaign', y: ['Spend'] });
    add('Trend picture', { kind: 'picture', value: '{{steps.lumen.file}}' });
    return console.log(JSON.stringify({ fills, repeat: [], notes: 'Matched the three KPI cards, their changes, the campaign table and chart, and the trend picture. The notes line is left as written.' }));
  }
  console.log(JSON.stringify({ headline: 'Sign-ups up 6% week over week, led by TikTok', bullets: ['TikTok sign-ups jumped 51% on 12% more spend — best cost per sign-up gain this week.', 'Email grew 18% with no spend; the Thursday newsletter drove most of it.', 'Google Search slipped 7% while spend held flat — worth a bid review.'] }));
});
