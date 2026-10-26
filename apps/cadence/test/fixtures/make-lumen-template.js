// Builds a "team template" deck like one someone would keep for a weekly ads update (used by the end-to-end run).
'use strict';
const path = require('path');
const fs = require('fs');
const PptxGen = require('pptxgenjs');
module.exports = async function makeLumenTemplate(out) {
  const p = new PptxGen(); p.layout = 'LAYOUT_WIDE';
  p.theme = { headFontFace: 'Trebuchet MS', bodyFontFace: 'Calibri' };
  const navy = '0B2545', teal = '13A89E', grey = '5B6474';
  const head = (s, t) => { s.addShape(p.ShapeType.rect, { x: 0, y: 0, w: 13.333, h: 0.18, fill: { color: teal }, line: { color: teal } }); s.addText(t, { x: 0.6, y: 0.45, w: 12, h: 0.8, fontFace: 'Trebuchet MS', fontSize: 28, bold: true, color: navy, objectName: 'Heading' }); };
  let s = p.addSlide(); s.background = { color: navy };
  s.addText('Weekly Ads Update', { x: 0.8, y: 2.4, w: 11, h: 1.1, fontFace: 'Trebuchet MS', fontSize: 44, bold: true, color: 'FFFFFF', objectName: 'Title' });
  s.addText('Oct 12 – 18, 2026', { x: 0.8, y: 3.5, w: 11, h: 0.6, fontSize: 20, color: '9FE2DA', objectName: 'Date range' });
  s = p.addSlide(); head(s, 'The week in numbers');
  [['Spend', '$1,520', '▲ 2.0% vs previous 7 days'], ['Conversions', '102', '▲ 1.0% vs previous 7 days'], ['Cost per conversion', '$14.90', 'flat vs previous']].forEach(([l, v, d], i) => {
    const x = 0.6 + i * 4.15;
    s.addShape(p.ShapeType.roundRect, { x, y: 1.6, w: 3.9, h: 2.4, fill: { color: 'EEF7F6' }, line: { color: 'D3ECE9' }, rectRadius: 0.1 });
    s.addText(l, { x: x + 0.3, y: 1.8, w: 3.3, h: 0.4, fontSize: 14, color: grey, objectName: `${l} label` });
    s.addText(v, { x: x + 0.3, y: 2.25, w: 3.3, h: 0.9, fontSize: 40, bold: true, color: navy, objectName: `${l} value` });
    s.addText(d, { x: x + 0.3, y: 3.2, w: 3.3, h: 0.4, fontSize: 12, color: teal, objectName: `${l} change` });
  });
  s.addText('Notes: the Fall Install Promo is still our best cost per conversion.', { x: 0.6, y: 4.5, w: 12, h: 0.5, fontSize: 14, color: grey, objectName: 'Notes' });
  s = p.addSlide(); head(s, 'Campaigns');
  const hd = (t, align) => ({ text: t, options: { bold: true, color: 'FFFFFF', fill: { color: navy }, align } });
  s.addTable([[hd('Campaign'), hd('Spend', 'right'), hd('Conversions', 'right'), hd('Cost / conv.', 'right')],
    ['Fall Install Promo', { text: '$303.56', options: { align: 'right' } }, { text: '16', options: { align: 'right' } }, { text: '$18.97', options: { align: 'right' } }],
    [{ text: 'Brand Awareness', options: { fill: { color: 'F2F4F7' } } }, { text: '$530.65', options: { align: 'right', fill: { color: 'F2F4F7' } } }, { text: '1', options: { align: 'right', fill: { color: 'F2F4F7' } } }, { text: '$530.65', options: { align: 'right', fill: { color: 'F2F4F7' } } }]],
  { x: 0.6, y: 1.5, w: 12.1, fontSize: 13, fontFace: 'Calibri', border: { type: 'solid', pt: 0.5, color: 'D0D5DD' }, rowH: 0.42, objectName: 'Campaign table' });
  s = p.addSlide(); head(s, 'Spend by campaign');
  s.addChart(p.ChartType.bar, [{ name: 'Spend', labels: ['Fall Install Promo', 'Brand Awareness'], values: [303.56, 530.65] }], { x: 0.6, y: 1.4, w: 7.6, h: 5.4, barDir: 'bar', chartColors: [teal], showValue: true, dataLabelFormatCode: '$#,##0', valAxisLabelFormatCode: '$#,##0', objectName: 'Spend chart' });
  s.addText('Daily trend', { x: 8.6, y: 1.4, w: 4.1, h: 0.4, fontSize: 14, bold: true, color: navy });
  const ph = path.join(path.dirname(out), 'placeholder.png');
  fs.writeFileSync(ph, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAAEUlEQVR4nGP4z8DwnwEIGAAZBAP/5yS5xAAAAABJRU5ErkJggg==', 'base64'));
  s.addImage({ path: ph, x: 8.6, y: 1.9, w: 4.1, h: 2.0, objectName: 'Trend picture' });
  await p.writeFile({ fileName: out });
  return out;
};
if (require.main === module) module.exports(path.join(__dirname, 'lumen-template.pptx')).then((f) => console.log(f));
