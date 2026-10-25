// Facet — the rig marker editor: a flat front view of the character with eight draggable markers (Mixamo's set).
import * as THREE from './vendor/three.module.min.js';
import { GLTFLoader } from './vendor/GLTFLoader.js';
import { fileUrl } from './viewer.js';

export const MARKERS = [
  ['chin', 'Chin', '#ffd166'], ['lwrist', 'Left wrist', '#55c4ff'], ['rwrist', 'Right wrist', '#ff7ab0'],
  ['lelbow', 'Left elbow', '#55c4ff'], ['relbow', 'Right elbow', '#ff7ab0'], ['lknee', 'Left knee', '#7be0a8'],
  ['rknee', 'Right knee', '#c9a6ff'], ['groin', 'Groin', '#ffb366']
];

export class RigEditor {
  // host: element to fill; path: the model's GLB (raw coordinates, front = +z); markers: { id: [x, y] }
  constructor(host, path, markers, onChange) {
    this.host = host;
    this.markers = JSON.parse(JSON.stringify(markers));
    this.onChange = onChange;
    host.classList.add('rig-host');
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(2, devicePixelRatio || 1));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    host.appendChild(this.renderer.domElement);
    this.svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.svg.classList.add('rig-svg');
    host.appendChild(this.svg);
    this.scene = new THREE.Scene();
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x444466, 2.2));
    const key = new THREE.DirectionalLight(0xffffff, 1.4); key.position.set(0.5, 1, 2); this.scene.add(key);
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -10, 10);
    this.camera.position.set(0, 0, 5);
    this._ro = new ResizeObserver(() => this.layout()); this._ro.observe(host);
    this.ready = new GLTFLoader().loadAsync(fileUrl(path) + '?v=' + Date.now()).then((g) => {
      this.model = g.scene;
      this.model.traverse((o) => { if (o.isMesh) { const m = o.material; o.material = new THREE.MeshStandardMaterial({ map: m?.map || null, vertexColors: !!o.geometry.attributes.color, color: m?.map || o.geometry.attributes.color ? 0xffffff : 0xc9c4d6, roughness: 0.8, transparent: true, opacity: 0.92 }); } });
      this.scene.add(this.model);
      this.box = new THREE.Box3().setFromObject(this.model);
      this.layout();
    });
    this._drag = null;
    this.svg.addEventListener('pointerdown', (e) => this.down(e));
    addEventListener('pointermove', this._mv = (e) => this.move(e));
    addEventListener('pointerup', this._up = () => { this._drag = null; this.svg.classList.remove('dragging'); });
  }

  layout() {
    if (!this.box) return;
    const w = this.host.clientWidth || 1, h = this.host.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = w + 'px'; this.renderer.domElement.style.height = h + 'px';
    const b = this.box, pad = 0.06;
    const bw = b.max.x - b.min.x, bh = b.max.y - b.min.y;
    const cx = (b.min.x + b.max.x) / 2, cy = (b.min.y + b.max.y) / 2;
    // fit the taller of width/height, keep pixels square
    let halfH = bh / 2 * (1 + pad * 2), halfW = halfH * w / h;
    if (halfW < bw / 2 * (1 + pad * 2)) { halfW = bw / 2 * (1 + pad * 2); halfH = halfW * h / w; }
    Object.assign(this.camera, { left: cx - halfW, right: cx + halfW, top: cy + halfH, bottom: cy - halfH });
    this.camera.updateProjectionMatrix();
    this.view = { cx, cy, halfW, halfH, w, h };
    this.svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    this.renderer.render(this.scene, this.camera);
    this.draw();
  }
  toPx([x, y]) { const v = this.view; return [(x - (v.cx - v.halfW)) / (2 * v.halfW) * v.w, ((v.cy + v.halfH) - y) / (2 * v.halfH) * v.h]; }
  toModel(px, py) { const v = this.view; return [v.cx - v.halfW + px / v.w * 2 * v.halfW, v.cy + v.halfH - py / v.h * 2 * v.halfH]; }

  draw() {
    if (!this.view) return;
    const P = (k) => this.toPx(this.markers[k]);
    const m = this.markers;
    const shoulderY = m.chin[1] - (this.box.max.y - this.box.min.y) * 0.055;
    const sh = (sign) => this.toPx([m.chin[0] + sign * Math.min(Math.abs(m[sign > 0 ? 'lelbow' : 'relbow'][0] - m.chin[0]) * 0.55, (this.box.max.y - this.box.min.y) * 0.09), shoulderY]);
    const lines = [
      [P('chin'), this.toPx([m.chin[0], shoulderY])], [this.toPx([m.chin[0], shoulderY]), P('groin')],
      [sh(1), P('lelbow')], [P('lelbow'), P('lwrist')], [sh(-1), P('relbow')], [P('relbow'), P('rwrist')], [sh(1), sh(-1)],
      [P('groin'), P('lknee')], [P('groin'), P('rknee')],
      [P('lknee'), this.toPx([m.lknee[0], this.box.min.y + 0.03])], [P('rknee'), this.toPx([m.rknee[0], this.box.min.y + 0.03])]
    ];
    this.svg.innerHTML = lines.map(([a, b]) => `<line x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}" class="bone"/>`).join('') +
      MARKERS.map(([id, label, col]) => { const [x, y] = P(id); return `<g class="mk" data-id="${id}" transform="translate(${x} ${y})"><circle r="15" class="halo" style="fill:${col}"/><circle r="8" style="fill:${col}"/><text y="-20">${label}</text></g>`; }).join('');
  }
  down(e) {
    const g = e.target.closest('.mk');
    if (!g) return;
    e.preventDefault();
    this._drag = g.dataset.id;
    this.svg.classList.add('dragging');
  }
  move(e) {
    if (!this._drag) return;
    const r = this.svg.getBoundingClientRect();
    this.markers[this._drag] = this.toModel(Math.max(0, Math.min(r.width, e.clientX - r.left)), Math.max(0, Math.min(r.height, e.clientY - r.top)));
    this.draw();
    this.onChange?.(this.markers);
  }
  set(markers) { this.markers = JSON.parse(JSON.stringify(markers)); this.draw(); }
  dispose() {
    this._ro.disconnect();
    removeEventListener('pointermove', this._mv); removeEventListener('pointerup', this._up);
    this.renderer.dispose();
  }
}
