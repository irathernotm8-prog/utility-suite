// Facet — the 3D viewer: orbit, shaded / clay / wireframe / normals, soft floor shadow, auto-turn, thumbnails.
import * as THREE from './vendor/three.module.min.js';
import { OrbitControls } from './vendor/OrbitControls.js';
import { GLTFLoader } from './vendor/GLTFLoader.js';
import { RoomEnvironment } from './vendor/RoomEnvironment.js';

export const fileUrl = (p) => 'file://' + (p.startsWith('/') ? '' : '/') + p.replace(/\\/g, '/').split('/').map(encodeURIComponent).join('/').replace(/^\/([A-Za-z])%3A/, '/$1:');

export class Viewer {
  constructor(host, { autoRotate = true } = {}) {
    this.host = host;
    this.mode = 'shaded';
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NeutralToneMapping;   // keeps the model's colours true
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.setClearColor(0x000000, 0);
    host.appendChild(this.renderer.domElement);
    this.renderer.domElement.className = 'viewer-canvas';

    this.scene = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.85;

    this.camera = new THREE.PerspectiveCamera(32, 1, 0.01, 100);
    this.camera.position.set(1.6, 1.1, 2.2);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.autoRotate = autoRotate;
    this.controls.autoRotateSpeed = 1.1;
    this.controls.minDistance = 0.2;
    this.controls.maxDistance = 12;
    this.controls.addEventListener('start', () => { this._touched = true; });

    const key = new THREE.DirectionalLight(0xffffff, 1.6);
    key.position.set(2.2, 3.5, 2.4);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.near = 0.1; key.shadow.camera.far = 12;
    Object.assign(key.shadow.camera, { left: -1.5, right: 1.5, top: 1.5, bottom: -1.5 });
    key.shadow.radius = 6; key.shadow.bias = -0.0004; key.shadow.normalBias = 0.01;
    this.scene.add(key);
    this.key = key;
    const rim = new THREE.DirectionalLight(0xb9b0ff, 0.7);
    rim.position.set(-2.5, 1.8, -2.2);
    this.scene.add(rim);

    this.floor = new THREE.Mesh(new THREE.CircleGeometry(3, 64), new THREE.ShadowMaterial({ opacity: 0.28 }));
    this.floor.rotation.x = -Math.PI / 2;
    this.floor.receiveShadow = true;
    this.scene.add(this.floor);
    this.grid = new THREE.GridHelper(4, 32, 0x8b7bff, 0x8888aa);
    this.grid.material.transparent = true;
    this.grid.material.opacity = 0.12;
    this.grid.visible = false;
    this.scene.add(this.grid);

    this.root = new THREE.Group();
    this.scene.add(this.root);
    this.clay = new THREE.MeshStandardMaterial({ color: 0xc9c4d6, roughness: 0.62, metalness: 0.0 });
    this.colorMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.58, metalness: 0.0 });
    this.normalMat = new THREE.MeshNormalMaterial();
    this.clayWire = new THREE.MeshStandardMaterial({ color: 0xc9c4d6, roughness: 0.62, metalness: 0.0, wireframe: true });
    this.wireMat = new THREE.MeshBasicMaterial({ color: 0x8b7bff, wireframe: true, transparent: true, opacity: 0.35 });

    this._ro = new ResizeObserver(() => this.resize());
    this._ro.observe(host);
    this.resize();
    this.clock = new THREE.Clock();
    this._loop = () => { this._raf = requestAnimationFrame(this._loop); const dt = this.clock.getDelta(); this.mixer?.update(dt); this.controls.update(); this.renderer.render(this.scene, this.camera); };
    this._loop();
  }

  resize() {
    const w = this.host.clientWidth || 1, h = this.host.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  clear() {
    for (const c of [...this.root.children]) {
      this.root.remove(c);
      c.traverse?.((o) => { if (o.isMesh) { o.geometry?.dispose(); } });
    }
    this.meshes = [];
    this.info = null;
    this.mixer?.stopAllAction();
    this.mixer = null; this.clips = [];
    if (this.skel) { this.scene.remove(this.skel); this.skel = null; }
  }

  async load(path) {
    const gltf = await new GLTFLoader().loadAsync(fileUrl(path) + '?v=' + Date.now());
    this.clear();
    const obj = gltf.scene;
    this.meshes = [];
    let tris = 0, verts = 0, colors = false, textured = false;
    const found = [];
    obj.traverse((o) => { if (o.isMesh) found.push(o); });
    for (const o of found) {
      o.castShadow = true; o.receiveShadow = false;
      if (!o.geometry.attributes.normal) o.geometry.computeVertexNormals();
      o.userData.orig = o.material;
      if (o.geometry.attributes.color) colors = true;
      if (o.material?.map) textured = true;
      tris += o.geometry.index ? o.geometry.index.count / 3 : o.geometry.attributes.position.count / 3;
      verts += o.geometry.attributes.position.count;
      if (!o.isSkinnedMesh) {
        const wire = new THREE.Mesh(o.geometry, this.wireMat);
        wire.visible = false; wire.userData.isWire = true;
        o.add(wire);
      }
      this.meshes.push(o);
    }
    // sit the model on the floor, centred, about one unit tall
    const box = new THREE.Box3().setFromObject(obj);
    const size = box.getSize(new THREE.Vector3());
    const s = 1 / (Math.max(size.x, size.y, size.z) || 1);
    obj.scale.setScalar(s);
    box.setFromObject(obj);
    const c = box.getCenter(new THREE.Vector3());
    obj.position.set(-c.x, -box.min.y, -c.z);
    this.root.add(obj);
    this.bounds = new THREE.Box3().setFromObject(obj);
    // rigged models: animations and a skeleton overlay
    this.mixer = gltf.animations?.length ? new THREE.AnimationMixer(obj) : null;
    this.clips = gltf.animations || [];
    this.action = null;
    const rigged = found.some((o) => o.isSkinnedMesh);
    if (this.skel) { this.scene.remove(this.skel); this.skel = null; }
    if (rigged) {
      this.skel = new THREE.SkeletonHelper(obj);
      this.skel.visible = false;
      this.scene.add(this.skel);
    }
    this.info = { triangles: Math.round(tris), vertices: verts, colors, textured, size, rigged, clips: this.clips.map((c) => c.name) };
    this.setMode(this.mode === 'shaded' && !colors && !textured ? 'shaded' : this.mode);
    this.frame();
    return this.info;
  }

  frame() {
    const b = this.bounds || new THREE.Box3(new THREE.Vector3(-.5, 0, -.5), new THREE.Vector3(.5, 1, .5));
    const c = b.getCenter(new THREE.Vector3());
    const r = b.getSize(new THREE.Vector3()).length() / 2;
    const d = r / Math.sin(THREE.MathUtils.degToRad(this.camera.fov / 2)) * 1.05;
    const dir = new THREE.Vector3(0.62, 0.42, 1).normalize();
    this.camera.position.copy(c).addScaledVector(dir, d);
    this.controls.target.copy(c);
    this.camera.near = d / 50; this.camera.far = d * 20;
    this.camera.updateProjectionMatrix();
    this.controls.update();
  }

  setMode(mode) {
    this.mode = mode;
    for (const m of this.meshes || []) {
      const hasColor = !!m.geometry.attributes.color;
      const orig = m.userData.orig;
      const shaded = orig?.map ? orig : hasColor ? this.colorMat : this.clay;
      m.material = mode === 'normals' ? this.normalMat : mode === 'wire' && m.isSkinnedMesh ? this.clayWire : mode === 'clay' || mode === 'wire' ? this.clay : shaded;
      for (const ch of m.children) if (ch.userData.isWire) ch.visible = mode === 'wire';
    }
  }
  setAutoRotate(on) { this.controls.autoRotate = !!on; }
  // plays one clip on loop; null returns to the bind pose
  setClip(name) {
    if (!this.mixer) return;
    this.mixer.stopAllAction();
    this.action = null;
    const clip = this.clips.find((c) => c.name === name);
    if (clip) { this.action = this.mixer.clipAction(clip); this.action.reset().play(); }
    else this.mixer.update(0);
  }
  setSkeleton(on) { if (this.skel) this.skel.visible = !!on; }
  setGrid(on) { this.grid.visible = !!on; }

  // A square, transparent PNG of the current model from a pleasant angle, for the library
  snapshot(size = 512) {
    const prev = { pos: this.camera.position.clone(), target: this.controls.target.clone(), aspect: this.camera.aspect, mode: this.mode, grid: this.grid.visible };
    const w = this.renderer.domElement.width, h = this.renderer.domElement.height;
    this.renderer.setSize(size, size, false);
    this.camera.aspect = 1; this.camera.updateProjectionMatrix();
    this.grid.visible = false;
    this.frame();
    this.renderer.render(this.scene, this.camera);
    const url = this.renderer.domElement.toDataURL('image/png');
    this.renderer.setSize(w / this.renderer.getPixelRatio(), h / this.renderer.getPixelRatio(), false);
    this.camera.aspect = prev.aspect; this.camera.updateProjectionMatrix();
    this.camera.position.copy(prev.pos); this.controls.target.copy(prev.target);
    this.grid.visible = prev.grid;
    this.resize();
    return url;
  }

  dispose() {
    cancelAnimationFrame(this._raf);
    this._ro.disconnect();
    this.clear();
    this.mixer?.stopAllAction();
    this.controls.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
