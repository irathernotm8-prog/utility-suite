// Code and hex viewer for the results browser. Only the lines on screen are drawn, so a 200,000-line
// Ghidra file or a 64 KB hex dump scrolls as smoothly as a short one.
'use strict';

const LINE_H = 20;
const escHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// ───────── languages
const KW = {
  java: 'abstract assert boolean break byte case catch char class const continue default do double else enum extends final finally float for goto if implements import instanceof int interface long native new package private protected public return short static strictfp super switch synchronized this throw throws transient try void volatile while var record sealed permits yield true false null',
  kotlin: 'as break class continue do else false for fun if in interface is null object package return super this throw true try typealias val var when while by catch constructor init companion data enum override private protected public internal open sealed suspend lateinit import',
  cs: 'abstract as base bool break byte case catch char checked class const continue decimal default delegate do double else enum event explicit extern false finally fixed float for foreach goto if implicit in int interface internal is lock long namespace new null object operator out override params private protected public readonly ref return sbyte sealed short sizeof stackalloc static string struct switch this throw true try typeof uint ulong unchecked unsafe ushort using virtual void volatile while var async await get set init record yield dynamic nint nuint',
  c: 'auto break case char const continue default do double else enum extern float for goto if inline int long register restrict return short signed sizeof static struct switch typedef union unsigned void volatile while bool true false NULL undefined undefined1 undefined2 undefined4 undefined8 byte uint ulong ushort uchar code longlong ulonglong class namespace template typename public private protected virtual new delete this nullptr',
  js: 'async await break case catch class const continue debugger default delete do else export extends false finally for from function get if import in instanceof let new null of return set static super switch this throw true try typeof undefined var void while with yield',
  py: 'and as assert async await break class continue def del elif else except False finally for from global if import in is lambda None nonlocal not or pass raise return True try while with yield self match case',
  swift: 'associatedtype class deinit enum extension fileprivate func import init inout internal let open operator private protocol public static struct subscript typealias var break case continue default defer do else fallthrough for guard if in repeat return switch where while as catch false is nil rethrows super self Self throw throws true try',
  go: 'break case chan const continue default defer else fallthrough for func go goto if import interface map package range return select struct switch type var true false nil',
  rust: 'as break const continue crate else enum extern false fn for if impl in let loop match mod move mut pub ref return self Self static struct super trait true type unsafe use where while async await dyn',
  lua: 'and break do else elseif end false for function goto if in local nil not or repeat return then true until while',
  gd: 'if elif else for while match break continue pass return class class_name extends is as self tool signal func static const enum var onready export setget breakpoint preload await yield true false null',
  smali: '',
  wat: 'module func param result local global memory table type import export start elem data i32 i64 f32 f64 call call_indirect block loop if then else end br br_if return drop select get set tee mut',
  sh: 'if then else elif fi for in do done while until case esac function return local export echo exit',
};
const LANG_BY_EXT = {
  java: 'java', kt: 'kotlin', kts: 'kotlin', cs: 'cs', vb: 'cs', fs: 'cs', il: 'cs', c: 'c', h: 'c', cc: 'c', cpp: 'c', hpp: 'c', m: 'c', mm: 'c', js: 'js', mjs: 'js', cjs: 'js', ts: 'js', tsx: 'js', jsx: 'js', vue: 'js', svelte: 'js', dart: 'js',
  py: 'py', pyi: 'py', swift: 'swift', go: 'go', rs: 'rust', lua: 'lua', gd: 'gd', smali: 'smali', wat: 'wat', wast: 'wat', sh: 'sh', bash: 'sh', zsh: 'sh', ps1: 'sh', bat: 'sh', cmd: 'sh',
  xml: 'xml', html: 'xml', htm: 'xml', plist: 'xml', csproj: 'xml', svg: 'xml', config: 'xml', manifest: 'xml', xaml: 'xml', tscn: 'ini', tres: 'ini', json: 'json', ini: 'ini', cfg: 'ini', toml: 'ini', properties: 'ini', yml: 'ini', yaml: 'ini', inf: 'ini', reg: 'ini', gradle: 'kotlin', dis: 'dis', md: 'md',
};
const langFor = (name) => LANG_BY_EXT[(name.split('.').pop() || '').toLowerCase()] || (name.endsWith('.dis.txt') ? 'dis' : 'plain');
const KWSET = Object.fromEntries(Object.entries(KW).map(([k, v]) => [k, new Set(v.split(' ').filter(Boolean))]));

function lineComment(lang) { return { py: '#', sh: '#', smali: '#', ini: /^[;#]/, lua: '--', wat: ';;', gd: '#', dis: '#' }[lang] || '//'; }
const hasBlock = (lang) => !['py', 'sh', 'smali', 'ini', 'wat', 'gd', 'dis', 'md', 'plain', 'json', 'xml'].includes(lang);

// Works out, for every line, whether it starts inside a block comment (or Python triple string).
function lineStates(lines, lang) {
  const st = new Uint8Array(lines.length);
  if (lang === 'xml') { let inC = false; for (let i = 0; i < lines.length; i++) { st[i] = inC ? 1 : 0; const l = lines[i]; let p = 0; for (;;) { if (inC) { const e = l.indexOf('-->', p); if (e < 0) break; inC = false; p = e + 3; } else { const s = l.indexOf('<!--', p); if (s < 0) break; inC = true; p = s + 4; } } } return st; }
  if (lang === 'py') { let q = 0; for (let i = 0; i < lines.length; i++) { st[i] = q; const m = lines[i].match(/"""|'''/g); if (m && m.length % 2) q = q ? 0 : 2; } return st; }
  if (!hasBlock(lang)) return st;
  let inC = false;
  for (let i = 0; i < lines.length; i++) {
    st[i] = inC ? 1 : 0;
    const l = lines[i]; if (l.indexOf('/*') < 0 && l.indexOf('*/') < 0) continue;
    let p = 0;
    for (;;) {
      if (inC) { const e = l.indexOf('*/', p); if (e < 0) break; inC = false; p = e + 2; }
      else { const lc = l.indexOf('//', p); const s = l.indexOf('/*', p); if (s < 0 || (lc >= 0 && lc < s)) break; inC = true; p = s + 2; }
    }
  }
  return st;
}

const NUM = /^(0x[\da-fA-F_]+[uUlL]*|\d[\d_]*\.?\d*(?:[eE][+-]?\d+)?[fFdDlLuU]*)/;
function highlight(line, lang, state) {
  if (line.length > 3000) return escHtml(line.slice(0, 3000)) + '<span class="c"> …</span>';
  if (lang === 'plain' || lang === 'md') return escHtml(line);
  if (lang === 'xml') return hlXml(line, state);
  if (lang === 'json') return escHtml(line).replace(/(&quot;|")((?:[^"\\]|\\.)*)"(\s*:)?/g, (m, q, body, colon) => colon ? `<span class="ty">"${body}"</span>${colon}` : `<span class="s">"${body}"</span>`).replace(/\b(true|false|null)\b/g, '<span class="k">$1</span>').replace(/(?<![\w#])(-?\d[\d.eE+-]*)\b/g, '<span class="n">$1</span>');
  const kw = KWSET[lang] || KWSET.c; const lc = lineComment(lang);
  let out = '', i = 0;
  if (state === 1) { const e = line.indexOf('*/'); if (e < 0) return `<span class="c">${escHtml(line)}</span>`; out += `<span class="c">${escHtml(line.slice(0, e + 2))}</span>`; i = e + 2; }
  if (state === 2) { const e = line.search(/"""|'''/); if (e < 0) return `<span class="s">${escHtml(line)}</span>`; out += `<span class="s">${escHtml(line.slice(0, e + 3))}</span>`; i = e + 3; }
  while (i < line.length) {
    const rest = line.slice(i); const ch = line[i];
    if (lc instanceof RegExp ? i === 0 && lc.test(rest.trimStart()) : rest.startsWith(lc)) { out += `<span class="c">${escHtml(rest)}</span>`; break; }
    if (hasBlock(lang) && rest.startsWith('/*')) { const e = line.indexOf('*/', i + 2); const end = e < 0 ? line.length : e + 2; out += `<span class="c">${escHtml(line.slice(i, end))}</span>`; i = end; continue; }
    if (lang === 'py' && (rest.startsWith('"""') || rest.startsWith("'''"))) { const q = rest.slice(0, 3); const e = line.indexOf(q, i + 3); const end = e < 0 ? line.length : e + 3; out += `<span class="s">${escHtml(line.slice(i, end))}</span>`; i = end; continue; }
    if (ch === '"' || ch === "'" || (ch === '`' && lang === 'js')) {
      let j = i + 1; while (j < line.length && line[j] !== ch) { if (line[j] === '\\') j++; j++; }
      out += `<span class="s">${escHtml(line.slice(i, j + 1))}</span>`; i = j + 1; continue;
    }
    if (ch === '@' && /[A-Za-z]/.test(line[i + 1] || '') && lang !== 'smali') { const m = rest.match(/^@[\w.]+/); out += `<span class="an">${escHtml(m[0])}</span>`; i += m[0].length; continue; }
    if (/[0-9]/.test(ch) && !/[\w$]/.test(line[i - 1] || '')) { const m = rest.match(NUM); if (m) { out += `<span class="n">${m[0]}</span>`; i += m[0].length; continue; } }
    if (/[A-Za-z_$.]/.test(ch)) {
      const m = rest.match(lang === 'smali' ? /^[.\w$/;<>-]+/ : /^[A-Za-z_$][\w$]*/);
      if (m) {
        const w = m[0]; const next = line[i + w.length];
        if (kw.has(w)) out += `<span class="k">${w}</span>`;
        else if (lang === 'smali' && w.startsWith('.')) out += `<span class="k">${escHtml(w)}</span>`;
        else if (lang === 'smali' && /^L[\w/$]+;/.test(w)) out += `<span class="ty">${escHtml(w)}</span>`;
        else if (next === '(') out += `<span class="f">${w}</span>`;
        else if (/^[A-Z][a-z]\w*/.test(w) && lang !== 'sh') out += `<span class="ty">${w}</span>`;
        else out += escHtml(w);
        i += w.length; continue;
      }
    }
    out += escHtml(ch); i++;
  }
  return out;
}
function hlXml(line, state) {
  let s = escHtml(line);
  if (state === 1) { const e = s.indexOf('--&gt;'); if (e < 0) return `<span class="c">${s}</span>`; return `<span class="c">${s.slice(0, e + 6)}</span>` + hlXml(line.slice(line.indexOf('-->') + 3), 0); }
  s = s.replace(/(&lt;!--.*?(--&gt;|$))/g, '<span class="c">$1</span>');
  s = s.replace(/(&lt;\/?)([\w:.-]+)/g, '$1<span class="k">$2</span>');
  s = s.replace(/([\w:.-]+)(=)(&quot;|")(.*?)(&quot;|")/g, '<span class="ty">$1</span>$2<span class="s">"$4"</span>');
  return s;
}

// ───────── virtual line list
class Lines {
  constructor(el, { count, render, gutter = (i) => i + 1, hits }) {
    this.el = el; this.count = count; this.render = render; this.gutter = gutter; this.hits = hits || new Set();
    el.innerHTML = '<div class="vspace"><div class="vlines"></div></div>';
    this.space = el.firstChild; this.box = this.space.firstChild;
    this.space.style.height = count * LINE_H + 'px';
    this.from = -1; this.to = -1;
    this.onScroll = () => this.draw(); el.addEventListener('scroll', this.onScroll, { passive: true });
    this.ro = new ResizeObserver(() => this.draw(true)); this.ro.observe(el);
    this.draw(true);
  }
  draw(force) {
    const top = this.el.scrollTop, h = this.el.clientHeight || 600;
    const from = Math.max(0, Math.floor(top / LINE_H) - 40), to = Math.min(this.count, Math.ceil((top + h) / LINE_H) + 40);
    if (!force && from >= this.from && to <= this.to && this.from >= 0) return;
    const a = Math.max(0, from - 60), b = Math.min(this.count, to + 60);
    let html = '';
    for (let i = a; i < b; i++) html += `<div class="ln${this.hits.has(i) ? ' hit' : ''}"><span class="g">${this.gutter(i)}</span><span class="t">${this.render(i)}</span></div>`;
    this.box.style.transform = `translateY(${a * LINE_H}px)`; this.box.innerHTML = html;
    this.from = a; this.to = b;
  }
  scrollTo(i) { this.el.scrollTop = Math.max(0, i * LINE_H - this.el.clientHeight / 3); this.draw(true); }
  destroy() { this.el.removeEventListener('scroll', this.onScroll); this.ro.disconnect(); }
}

class CodeView {
  constructor(el) { this.el = el; this.list = null; this.wrap = false; }
  setText(text, name, { line } = {}) {
    this.destroy();
    const lines = text.replace(/\r\n?/g, '\n').split('\n'); if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
    const lang = langFor(name); const states = lineStates(lines, lang);
    this.lines = lines;
    const hits = new Set(line ? [line - 1] : []);
    this.el.classList.toggle('wrap', this.wrap && lines.length < 4000);
    if (this.wrap && lines.length < 4000) {
      this.el.innerHTML = lines.map((l, i) => `<div class="ln${hits.has(i) ? ' hit' : ''}"><span class="g">${i + 1}</span><span class="t">${highlight(l, lang, states[i])}</span></div>`).join('');
      if (line) { const n = this.el.children[line - 1]; if (n) n.scrollIntoView({ block: 'center' }); }
    } else {
      this.list = new Lines(this.el, { count: lines.length, render: (i) => highlight(lines[i], lang, states[i]), hits });
      if (line) this.list.scrollTo(line - 1);
    }
    return { lines: lines.length, lang };
  }
  setHex(bytes, size) {
    this.destroy(); this.el.classList.remove('wrap');
    const n = Math.ceil(bytes.length / 16);
    const hx = (b) => b.toString(16).padStart(2, '0');
    this.list = new Lines(this.el, {
      count: n + (size > bytes.length ? 1 : 0),
      gutter: (i) => (i < n ? (i * 16).toString(16).padStart(8, '0') : ''),
      render: (i) => {
        if (i >= n) return `<span class="c">… ${(size - bytes.length).toLocaleString()} more bytes (open the file to see everything)</span>`;
        const row = bytes.subarray(i * 16, i * 16 + 16); let h = '', a = '';
        for (let k = 0; k < 16; k++) { h += k < row.length ? hx(row[k]) + (k === 7 ? '  ' : ' ') : '   ' + (k === 7 ? ' ' : ''); a += k < row.length ? (row[k] >= 32 && row[k] < 127 ? String.fromCharCode(row[k]) : '·') : ''; }
        return `<span class="${row.every((x) => x === 0) ? 'c' : ''}">${h}</span><span class="asc">${escHtml(a)}</span>`;
      },
    });
    this.el.classList.add('hex');
  }
  destroy() { if (this.list) this.list.destroy(); this.list = null; this.el.classList.remove('hex'); this.el.innerHTML = ''; this.el.scrollTop = 0; }
}

window.CodeView = CodeView; window.langFor = langFor; window.escHtml = escHtml; window.highlightLine = highlight;
