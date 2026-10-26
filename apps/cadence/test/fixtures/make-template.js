// Builds test/fixtures/template.pptx: the kind of deck someone would hand Cadence as a template.
'use strict';
const path = require('path');
const PptxGen = require('pptxgenjs');
module.exports = async function makeTemplate(out = path.join(__dirname, 'template.pptx')) {
  const p = new PptxGen(); p.layout = 'LAYOUT_WIDE';
  p.theme = { headFontFace: 'Georgia', bodyFontFace: 'Verdana' };
  const ink = '1F2A44', brand = 'E4572E';
  let s = p.addSlide(); s.background = { color: 'FFF8F0' };
  s.addText('Weekly Marketing Update', { x: 0.8, y: 2.2, w: 11, h: 1.2, fontFace: 'Georgia', fontSize: 40, bold: true, color: ink, objectName: 'Title' });
  s.addText('Week of {{lastWeek.start | date:"MMMM D"}}', { x: 0.8, y: 3.4, w: 11, h: 0.6, fontFace: 'Verdana', fontSize: 18, color: brand, objectName: 'Subtitle' });
  s = p.addSlide();
  s.addText('Sign-ups at a glance', { x: 0.6, y: 0.4, w: 12, h: 0.8, fontFace: 'Georgia', fontSize: 28, bold: true, color: ink, objectName: 'Heading' });
  s.addShape(p.ShapeType.roundRect, { x: 0.6, y: 1.5, w: 3.8, h: 2.2, fill: { color: 'FDEBE4' }, line: { color: brand }, objectName: 'Card' });
  s.addText('Total sign-ups', { x: 0.9, y: 1.7, w: 3.2, h: 0.4, fontSize: 14, color: '6B7280', objectName: 'KPI label' });
  s.addText('4,450', { x: 0.9, y: 2.1, w: 3.2, h: 0.9, fontSize: 44, bold: true, color: brand, objectName: 'KPI value' });
  s.addText([{ text: 'Up ', options: { color: '6B7280' } }, { text: '6.7%', options: { bold: true, color: '1A7F37' } }, { text: ' on the prior week', options: { color: '6B7280' } }], { x: 0.9, y: 3.0, w: 3.4, h: 0.4, fontSize: 12, objectName: 'KPI delta' });
  s.addTable([[{ text: 'Channel', options: { bold: true, color: 'FFFFFF', fill: { color: ink } } }, { text: 'Sign-ups', options: { bold: true, color: 'FFFFFF', fill: { color: ink }, align: 'right' } }, { text: 'Spend', options: { bold: true, color: 'FFFFFF', fill: { color: ink }, align: 'right' } }],
    ['Meta', { text: '1,840', options: { align: 'right' } }, { text: '$6,120', options: { align: 'right' } }],
    [{ text: 'Google', options: { fill: { color: 'F3F4F6' } } }, { text: '1,312', options: { align: 'right', fill: { color: 'F3F4F6' } } }, { text: '$5,280', options: { align: 'right', fill: { color: 'F3F4F6' } } }],
    [{ text: 'Total', options: { bold: true } }, { text: '3,152', options: { bold: true, align: 'right' } }, { text: '$11,400', options: { bold: true, align: 'right' } }]],
    { x: 5, y: 1.5, w: 7.6, fontSize: 13, fontFace: 'Verdana', border: { type: 'solid', pt: 0.5, color: 'D1D5DB' }, rowH: 0.4, objectName: 'Channel table' });
  s = p.addSlide();
  s.addText('Sign-ups by channel', { x: 0.6, y: 0.4, w: 12, h: 0.8, fontFace: 'Georgia', fontSize: 28, bold: true, color: ink });
  s.addChart(p.ChartType.bar, [{ name: 'This week', labels: ['Meta', 'Google', 'Email'], values: [1840, 1312, 604] }, { name: 'Last week', labels: ['Meta', 'Google', 'Email'], values: [1700, 1407, 512] }], { x: 0.6, y: 1.4, w: 12, h: 5.4, barDir: 'col', chartColors: [brand, '9CA3AF'], showLegend: true, legendPos: 'b', showTitle: true, title: 'Sign-ups', objectName: 'Signups chart' });
  s = p.addSlide();
  s.addText('{{row.Channel}}', { x: 0.6, y: 0.4, w: 12, h: 0.8, fontFace: 'Georgia', fontSize: 28, bold: true, color: ink });
  s.addText('{{row.Signups | number}} sign-ups · {{row["Signups change %"] | change}} vs last week', { x: 0.6, y: 1.5, w: 12, h: 0.6, fontSize: 20, color: brand });
  s.addNotes('Speaker note for {{row.Channel}}');
  await p.writeFile({ fileName: out });
  return out;
};
if (require.main === module) module.exports().then((f) => console.log(f));
