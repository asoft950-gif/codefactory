// CodeFactory 3D көрінісі: ойын логикасы (world, tweens) өзгермейді, бұл модуль тек оны әр кадрда 3D-де салады.
// Жұмыс істемесе (WebGL жоқ), ойын 2D көрінісінде қала береді.
import * as THREE from 'three';
import { RoundedBoxGeometry } from '../vendor/three/RoundedBoxGeometry.js';
import { RoomEnvironment } from '../vendor/three/RoomEnvironment.js';

const canvas = document.getElementById('gl');
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
} catch (e) {
  renderer = null;
}

if (renderer) init();

function init() {
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.92;

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(renderer), 0.04).texture;

  scene.add(new THREE.HemisphereLight(0xf3eeff, 0xc9cdee, 0.55));
  const sun = new THREE.DirectionalLight(0xfff6ee, 2.0);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.radius = 3;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.02;
  scene.add(sun, sun.target);
  const flashLight = new THREE.PointLight(0xfff3c4, 0, 3);
  scene.add(flashLight);

  const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 200);

  /* ---------- caches ---------- */
  const geoCache = new Map(), matCache = new Map();
  const cached = (map, key, make) => { let v = map.get(key); if (!v) { v = make(); map.set(key, v); } return v; };
  const rbox = (w, h, d, r = 0.05) => cached(geoCache, `rb${w},${h},${d},${r}`, () => new RoundedBoxGeometry(w, h, d, 3, Math.min(r, Math.min(w, h, d) / 2 - 0.001)));
  const cyl = (rt, rb, h, seg = 28) => cached(geoCache, `cy${rt},${rb},${h},${seg}`, () => new THREE.CylinderGeometry(rt, rb, h, seg));
  const sph = (r, half = false) => cached(geoCache, `sp${r},${half}`, () => new THREE.SphereGeometry(r, 32, 16, 0, Math.PI * 2, 0, half ? Math.PI / 2 : Math.PI));
  const mat = (color, o = {}) => cached(matCache, color + JSON.stringify(o), () => new THREE.MeshStandardMaterial({ color, roughness: 0.48, metalness: 0, envMapIntensity: 0.38, ...o }));
  const glow = (color, opacity = 1) => cached(matCache, 'glow' + color + opacity, () => new THREE.MeshBasicMaterial({ color, transparent: opacity < 1, opacity, toneMapped: false, depthWrite: opacity >= 1, blending: opacity < 1 ? THREE.AdditiveBlending : THREE.NormalBlending }));

  function gearGeo(r, teeth = 8, depth = 0.035) {
    return cached(geoCache, `gear${r},${teeth},${depth}`, () => {
      const s = new THREE.Shape();
      for (let i = 0; i < teeth; i++) {
        const a = (i / teeth) * Math.PI * 2, st = Math.PI / teeth;
        [[a - st * 0.95, r * 0.78], [a - st * 0.42, r], [a + st * 0.42, r], [a + st * 0.95, r * 0.78]].forEach(([aa, rr], k) => {
          const x = Math.cos(aa) * rr, y = Math.sin(aa) * rr;
          i === 0 && k === 0 ? s.moveTo(x, y) : s.lineTo(x, y);
        });
      }
      s.closePath();
      const hole = new THREE.Path(); hole.absarc(0, 0, r * 0.3, 0, Math.PI * 2, true); s.holes.push(hole);
      const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: true, bevelThickness: 0.008, bevelSize: 0.008, bevelSegments: 2, curveSegments: 12 });
      g.center(); return g;
    });
  }
  function archGeo(w, h, t, depth) {
    return cached(geoCache, `arch${w},${h},${t},${depth}`, () => {
      const r = w / 2, s = new THREE.Shape();
      s.moveTo(-r, 0); s.lineTo(-r, h - r); s.absarc(0, h - r, r, Math.PI, 0, true); s.lineTo(r, 0); s.lineTo(r - t, 0); s.lineTo(r - t, h - r);
      s.absarc(0, h - r, r - t, 0, Math.PI, false); s.lineTo(-r + t, 0); s.closePath();
      return new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: true, bevelThickness: 0.015, bevelSize: 0.015, bevelSegments: 2, curveSegments: 24 });
    });
  }
  function archFill(w, h) {
    return cached(geoCache, `archf${w},${h}`, () => {
      const r = w / 2, s = new THREE.Shape();
      s.moveTo(-r, 0); s.lineTo(-r, h - r); s.absarc(0, h - r, r, Math.PI, 0, true); s.lineTo(r, 0); s.closePath();
      return new THREE.ShapeGeometry(s, 24);
    });
  }
  function canvasTex(w, h, draw, repeat) {
    const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
    if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
    return t;
  }
  const beltTex = canvasTex(256, 64, (g, w, h) => {
    g.fillStyle = '#c3c8ee'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 6; i++) { g.fillStyle = '#eef0ff'; g.fillRect(i * w / 6 + 6, 0, 12, h); g.fillStyle = '#b3b8e4'; g.fillRect(i * w / 6 + 18, 0, 3, h); }
  }, true);
  const glowStripTex = canvasTex(8, 64, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.5, 'rgba(255,255,255,1)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
  });
  const markerTex = canvasTex(128, 128, (g) => {
    g.strokeStyle = '#ff7fab'; g.lineWidth = 6; g.setLineDash([14, 10]);
    g.beginPath(); g.roundRect ? g.roundRect(8, 8, 112, 112, 18) : g.rect(8, 8, 112, 112); g.stroke();
    g.fillStyle = 'rgba(255,143,179,.12)'; g.fill();
  });
  const softShadowTex = canvasTex(64, 64, (g) => {
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(70,60,130,.35)'); gr.addColorStop(1, 'rgba(70,60,130,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  });

  /* ---------- scene graph ---------- */
  let root = new THREE.Group(); scene.add(root);
  let built = null, W = 8, H = 6;
  const anim = { gears: [], spin: [], blinkers: [] };
  const X = (cx) => cx - W / 2, Z = (cy) => cy - H / 2;

  function M(geo, material, x, y, z, parent, shadow = true) {
    const m = new THREE.Mesh(geo, material);
    m.position.set(x, y, z); m.castShadow = shadow; m.receiveShadow = true;
    (parent || root).add(m); return m;
  }
  function stud(parent, x, y, z, r, h, color) { return M(cyl(r, r, h), mat(color), x, y + h / 2, z, parent); }
  function gearMesh(parent, r, color, teeth = 8) { const g = M(gearGeo(r, teeth), mat(color, { roughness: 0.35 }), 0, 0, 0, parent); return g; }
  function neonStrip(x1, z1, x2, z2, color, y = 0.012) {
    const len = Math.hypot(x2 - x1, z2 - z1), ang = -Math.atan2(z2 - z1, x2 - x1);
    const g = new THREE.Group(); g.position.set((x1 + x2) / 2, y, (z1 + z2) / 2); g.rotation.y = ang; root.add(g);
    M(rbox(len, 0.03, 0.05, 0.012), glow(color), 0, 0.012, 0, g, false);
    const halo = new THREE.Mesh(new THREE.PlaneGeometry(len + 0.3, 0.55), new THREE.MeshBasicMaterial({ color, map: glowStripTex, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    halo.rotation.x = -Math.PI / 2; halo.position.y = 0.004; g.add(halo);
  }

  /* ---------- items ---------- */
  const EYE_W = mat('#ffffff', { roughness: 0.2 }), EYE_D = mat('#2b2e57', { roughness: 0.25 }), CHEEK = mat('#f6a9c0', { roughness: 0.7 });
  function face(parent, y, z, s = 1, cheeks = true) {
    const eyes = [];
    [-1, 1].forEach((side) => {
      const w = M(sph(0.055 * s), EYE_W, side * 0.08 * s, y, z, parent, false); w.scale.z = 0.45;
      const p = M(sph(0.03 * s), EYE_D, side * 0.08 * s, y, z + 0.022 * s, parent, false); p.scale.z = 0.5;
      eyes.push(w, p);
      if (cheeks) { const c = M(sph(0.03 * s), CHEEK, side * 0.125 * s, y - 0.07 * s, z - 0.003, parent, false); c.scale.set(1.3, 0.6, 0.3); }
    });
    return eyes;
  }
  function makeItem(it) {
    const g = new THREE.Group();
    if (it.kind === 'brick') {
      const c = COL[it.color].base;
      M(rbox(0.32, 0.17, 0.32, 0.035), mat(c, { roughness: 0.32 }), 0, 0.085, 0, g);
      stud(g, 0, 0.17, 0, 0.075, 0.06, c);
    } else if (it.kind === 'head') {
      M(rbox(0.28, 0.27, 0.28, 0.06), mat('#f6efe0'), 0, 0.135, 0, g);
      face(g, 0.15, 0.142, 0.75);
      stud(g, 0, 0.27, 0, 0.055, 0.045, '#f6efe0');
    } else if (it.kind === 'body') {
      M(rbox(0.3, 0.28, 0.3, 0.05), mat('#93bcf5'), 0, 0.14, 0, g);
      const gm = gearMesh(g, 0.1, '#fbdc85'); gm.position.set(0, 0.14, 0.16);
    } else if (it.kind === 'battery') {
      M(cyl(0.1, 0.1, 0.3), mat('#fbdc85', { roughness: 0.3 }), 0, 0.15, 0, g);
      M(cyl(0.05, 0.05, 0.05), mat('#c9cbe0', { metalness: 0.4, roughness: 0.3 }), 0, 0.325, 0, g);
      M(rbox(0.12, 0.03, 0.02, 0.008), mat('#b98b2e'), 0, 0.16, 0.1, g, false);
      M(rbox(0.03, 0.12, 0.02, 0.008), mat('#b98b2e'), 0, 0.16, 0.1, g, false);
    }
    return g;
  }
  const dyn = new THREE.Group(); scene.add(dyn);
  let itemMeshes = new Map(), used = new Set();
  function place(it, x, y, z, rotY = Math.PI / 4, s = 1) {
    let m = itemMeshes.get(it);
    if (!m) { m = makeItem(it); itemMeshes.set(it, m); dyn.add(m); }
    m.visible = true; m.position.set(x, y, z); m.rotation.y = rotY; m.scale.setScalar(s); used.add(m);
  }

  /* ---------- robots ---------- */
  function makeRobot(color, chevron) {
    const r = { root: new THREE.Group(), body: new THREE.Group() };
    r.root.add(r.body);
    const limb = '#b4bde6';
    r.legs = [-1, 1].map((side) => {
      const p = new THREE.Group(); p.position.set(side * 0.1, 0.27, 0); r.body.add(p);
      M(rbox(0.13, 0.22, 0.13, 0.04), mat(limb), 0, -0.11, 0, p);
      M(rbox(0.16, 0.07, 0.2, 0.03), mat('#9aa4d8'), 0, -0.235, 0.025, p);
      return p;
    });
    M(rbox(0.42, 0.38, 0.4, 0.07), mat(color), 0, 0.45, 0, r.body);
    r.gear = gearMesh(r.body, 0.13, '#fbdc85', 9); r.gear.position.set(0, 0.45, 0.215);
    for (let i = 0; i < 3; i++) M(rbox(0.22, 0.03, 0.02, 0.01), mat('#7e9fd9'), 0, 0.39 + i * 0.06, -0.205, r.body, false);
    r.arms = [-1, 1].map((side) => {
      const p = new THREE.Group(); p.position.set(side * 0.27, 0.6, 0); r.body.add(p);
      M(sph(0.06), mat(limb), 0, 0, 0, p);
      M(rbox(0.1, 0.26, 0.1, 0.035), mat(limb), 0, -0.13, 0, p);
      M(rbox(0.12, 0.08, 0.12, 0.03), mat('#9aa4d8'), 0, -0.28, 0, p);
      return p;
    });
    M(cyl(0.07, 0.08, 0.06), mat(limb), 0, 0.66, 0, r.body);
    r.head = new THREE.Group(); r.head.position.set(0, 0.69, 0); r.body.add(r.head);
    M(rbox(0.38, 0.34, 0.36, 0.08), mat('#f6efe0'), 0, 0.17, 0, r.head);
    r.eyes = face(r.head, 0.19, 0.182, 1);
    stud(r.head, 0, 0.34, 0, 0.065, 0.05, '#f6efe0');
    r.holder = new THREE.Object3D(); r.holder.position.set(0, 0.36, 0.34); r.body.add(r.holder);
    const sh = new THREE.Mesh(new THREE.PlaneGeometry(0.75, 0.75), new THREE.MeshBasicMaterial({ map: softShadowTex, transparent: true, depthWrite: false }));
    sh.rotation.x = -Math.PI / 2; sh.position.y = 0.006; r.root.add(sh);
    if (chevron) {
      const tri = new THREE.Shape(); tri.moveTo(0, 0.1); tri.lineTo(-0.09, -0.04); tri.lineTo(0.09, -0.04); tri.closePath();
      const t = new THREE.Mesh(new THREE.ShapeGeometry(tri), glow('#ff8fb3'));
      t.rotation.x = -Math.PI / 2; t.position.set(0, 0.012, 0.45); r.root.add(t);
      const beam = new THREE.Mesh(cyl(0.012, 0.012, 1, 8), glow('#3fd0ff')); beam.visible = false; scene.add(beam); r.beam = beam;
    }
    r.ang = 0; r.root.traverse((o) => { if (o.isMesh && o.material.map === softShadowTex) o.castShadow = false; });
    return r;
  }
  const dirAngle = (d) => Math.atan2(DIRS[d][0], DIRS[d][1]);
  function syncRobot(R, r, dt, now, s = 1, seed = 0) {
    R.root.scale.setScalar(s);
    R.root.position.set(X(r.x + 0.5), (r.z || 0) + (r.hop || 0) * 1.4, Z(r.y + 0.5));
    let target = dirAngle(r.dir), diff = target - R.ang;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    R.ang += diff * Math.min(1, dt * 0.012 * Math.max(1, SPEED));
    R.root.rotation.y = R.ang;
    const walking = r.walk > 0, ph = r.walk * 2;
    R.legs[0].rotation.x = walking ? Math.sin(ph) * 0.6 : 0;
    R.legs[1].rotation.x = walking ? -Math.sin(ph) * 0.6 : 0;
    R.body.position.y = walking ? Math.abs(Math.sin(ph)) * 0.035 : Math.sin(now / 600 + seed) * 0.008;
    const lift = Math.max(r.hand ? 0.62 : 0, r.arm || 0);
    R.arms.forEach((a, i) => { a.rotation.x = -lift * 1.35 + (walking && !r.hand ? (i ? 1 : -1) * Math.sin(ph) * 0.45 : 0); });
    R.gear.rotation.z += dt * (walking ? 0.008 : 0.0015);
    R.head.rotation.z = r.alert > 0.3 ? Math.sin(now / 50) * 0.08 * r.alert : 0;
    const blink = ((now / 1000 + seed * 1.7) % 3.7) < 0.12;
    R.eyes.forEach((e, i) => { e.scale.y = blink ? 0.12 : 1; if (i % 2) e.material = r.scan > 0.1 ? glow('#3fd0ff') : EYE_D; });
    if (R.beam) {
      R.beam.visible = r.scan > 0.05 && !!r.hand;
      if (R.beam.visible) {
        const a = new THREE.Vector3(), b = new THREE.Vector3();
        R.head.localToWorld(a.set(0, 0.19, 0.2)); R.holder.getWorldPosition(b); b.y += 0.12;
        R.beam.position.copy(a).add(b).multiplyScalar(0.5);
        R.beam.scale.set(1, a.distanceTo(b), 1);
        R.beam.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
      }
    }
  }

  /* ---------- stations ---------- */
  function buildStation(s) {
    const g = new THREE.Group(); g.position.set(X(s.x + 0.5), 0, Z(s.y + 0.5)); root.add(g); s.__g = g;
    switch (s.type) {
      case 'bin': {
        const c = s.accept ? COL[s.accept].base : '#c6d3f6', m = mat(c, { roughness: 0.4 }), inner = mat(c, { roughness: 0.8, color: new THREE.Color(c).multiplyScalar(0.82) });
        M(rbox(0.76, 0.07, 0.76, 0.03), inner, 0, 0.035, 0, g);
        M(rbox(0.76, 0.5, 0.08, 0.035), m, 0, 0.25, 0.34, g); M(rbox(0.76, 0.5, 0.08, 0.035), m, 0, 0.25, -0.34, g);
        M(rbox(0.08, 0.5, 0.62, 0.035), m, 0.34, 0.25, 0, g); M(rbox(0.08, 0.5, 0.62, 0.035), m, -0.34, 0.25, 0, g);
        M(rbox(0.5, 0.06, 0.02, 0.01), mat('#ffffff', { roughness: 0.3 }), 0, 0.33, 0.385, g, false);
        break;
      }
      case 'pallet': {
        const wood = mat('#f2d3b0', { roughness: 0.75 });
        [-0.27, 0, 0.27].forEach((z) => M(rbox(0.12, 0.06, 0.12, 0.02), mat('#e2bd93', { roughness: 0.8 }), 0, 0.03, z, g));
        [-0.25, 0, 0.25].forEach((z) => M(rbox(0.76, 0.06, 0.2, 0.02), wood, 0, 0.09, z, g));
        break;
      }
      case 'shelf': {
        M(rbox(0.74, 0.4, 0.74, 0.07), mat('#d6c9f4'), 0, 0.2, 0, g);
        M(rbox(0.6, 0.04, 0.02, 0.01), mat('#ffffff'), 0, 0.22, 0.375, g, false);
        const item = makeItem({ kind: s.part }); item.position.y = 0.4; item.scale.setScalar(1.15); g.add(item); anim.spin.push(item);
        break;
      }
      case 'table': {
        const top = new THREE.Group(); g.add(top); s.__top = top;
        ['#f6a9c0', '#fbd98a', '#a6e3c7', '#9fc4f7'].forEach((c, i) => M(rbox(0.12, 0.44, 0.12, 0.04), mat(c), (i % 2 ? 0.28 : -0.28), 0.22, (i > 1 ? 0.28 : -0.28), g));
        M(rbox(0.86, 0.09, 0.86, 0.04), mat('#f8f2ff'), 0, 0.485, 0, top);
        for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) stud(top, i * 0.25, 0.53, j * 0.25, 0.05, 0.035, '#f8f2ff');
        break;
      }
      case 'machine': {
        const c = built.conv, f = c.path[0], dx = f[0] - s.x, dy = f[1] - s.y;
        M(rbox(0.9, 1.15, 0.9, 0.09), mat('#cdbaf3'), 0, 0.575, 0, g);
        const fg = new THREE.Group(); fg.rotation.y = Math.atan2(dx, dy); g.add(fg);
        M(rbox(0.7, 0.66, 0.06, 0.03), mat('#fbe39a'), 0, 0.33, 0.44, fg);
        M(rbox(0.52, 0.54, 0.07, 0.02), mat('#8d78c9', { roughness: 0.8 }), 0, 0.29, 0.455, fg, false);
        const side = new THREE.Group(); side.rotation.y = Math.atan2(dx, dy) + (dx === -1 ? Math.PI / 2 : -Math.PI / 2); g.add(side);
        const sideFace = new THREE.Group(); sideFace.position.set(0, 0, 0.46); side.add(sideFace);
        const gm = gearMesh(sideFace, 0.22, '#fbdc85', 10); gm.position.set(0, 0.68, 0); anim.gears.push([gm, 0.0012]);
        const light = M(sph(0.06), glow('#9fe0c3'), 0, 0.28, 0.01, sideFace, false); anim.blinkers.push(light);
        M(rbox(0.62, 0.1, 0.62, 0.04), mat('#f6c4d3'), 0, 1.2, 0, g);
        M(sph(0.25, true), mat('#fbe39a', { roughness: 0.25 }), 0, 1.25, 0, g);
        break;
      }
      case 'door': {
        const c = mat('#f6b8cb');
        M(rbox(0.4, 1.15, 0.17, 0.05), c, 0, 0.575, -0.37, g); M(rbox(0.4, 1.15, 0.17, 0.05), c, 0, 0.575, 0.37, g);
        M(rbox(0.5, 0.2, 0.92, 0.06), mat('#f9cbd9'), 0, 1.25, 0, g);
        stud(g, 0, 1.35, 0, 0.12, 0.08, '#a6e3c7');
        const pl = new THREE.Mesh(new THREE.PlaneGeometry(0.56, 1.0), new THREE.MeshBasicMaterial({ color: '#7fdcff', transparent: true, opacity: 0.45, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
        pl.rotation.y = Math.PI / 2; pl.position.y = 0.52; g.add(pl);
        break;
      }
      case 'decor': {
        if (s.kind === 'stack') {
          const cols = [['#f6a9c0', '#fbd98a', '#a9c7f6'], ['#a6e3c7', '#cdbaf3', '#fbd98a'], ['#fbd98a', '#f6a9c0', '#a6e3c7'], ['#a9c7f6', '#a6e3c7', '#f6a9c0']][s.seed % 4];
          M(rbox(0.7, 0.28, 0.5, 0.05), mat(cols[0], { roughness: 0.32 }), -0.03, 0.14, 0, g);
          stud(g, -0.2, 0.28, 0, 0.08, 0.06, cols[0]); stud(g, 0.14, 0.28, 0, 0.08, 0.06, cols[0]);
          const b2 = M(rbox(0.46, 0.27, 0.46, 0.05), mat(cols[1], { roughness: 0.32 }), 0.0, 0.415, 0.02, g); b2.rotation.y = 0.3;
          M(rbox(0.3, 0.22, 0.3, 0.04), mat(cols[2], { roughness: 0.32 }), -0.02, 0.66, 0, g);
          stud(g, -0.02, 0.77, 0, 0.075, 0.06, cols[2]);
        } else if (s.kind === 'pipe') {
          M(cyl(0.26, 0.28, 0.12), mat('#cdbaf3'), 0, 0.06, 0, g);
          M(cyl(0.16, 0.16, 1.75), mat('#dccff8', { roughness: 0.3 }), 0, 0.98, 0, g);
          M(cyl(0.21, 0.21, 0.1), mat('#cdbaf3'), 0, 0.95, 0, g);
          M(cyl(0.21, 0.21, 0.1), mat('#cdbaf3'), 0, 1.75, 0, g);
        } else if (s.kind === 'gearbox') {
          M(rbox(0.8, 0.8, 0.8, 0.08), mat('#fbe39a'), 0, 0.4, 0, g);
          M(rbox(0.5, 0.22, 0.5, 0.06), mat('#f6a9c0'), 0, 0.91, 0, g);
          const g1 = gearMesh(g, 0.25, '#a9c7f6', 10); g1.position.set(0, 0.42, 0.42); anim.gears.push([g1, 0.001]);
          const g2 = gearMesh(g, 0.25, '#a9c7f6', 10); g2.position.set(0.42, 0.42, 0); g2.rotation.y = Math.PI / 2; anim.gears.push([g2, -0.001]);
        }
        break;
      }
    }
  }
  function buildConveyor(c) {
    const fx = c.path[0][0] - c.machine.x, fy = c.path[0][1] - c.machine.y;
    beltTex.repeat.set(1, 1);
    const beltMat = new THREE.MeshStandardMaterial({ map: beltTex, roughness: 0.6, envMapIntensity: 0.4 });
    c.path.forEach(([x, y], i) => {
      const g = new THREE.Group(); g.position.set(X(x + 0.5), 0, Z(y + 0.5)); g.rotation.y = -Math.atan2(fy, fx); root.add(g);
      M(rbox(0.18, 0.24, 0.18, 0.04), mat(i % 2 ? '#fbd98a' : '#f6a9c0'), 0, 0.12, 0, g);
      M(rbox(1.0, 0.1, 0.72, 0.03), mat('#c9cdf1'), 0, 0.28, 0, g);
      const top = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 0.6), beltMat); top.rotation.x = -Math.PI / 2; top.position.y = 0.332; top.receiveShadow = true; g.add(top);
      M(rbox(1.0, 0.07, 0.06, 0.025), mat('#e4e6fb'), 0, 0.35, 0.34, g); M(rbox(1.0, 0.07, 0.06, 0.025), mat('#e4e6fb'), 0, 0.35, -0.34, g);
    });
    const e = c.path[c.path.length - 1];
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.24, 0.29, 40), new THREE.MeshBasicMaterial({ color: '#ff8fb3', transparent: true, opacity: 0.8, toneMapped: false, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2; ring.position.set(X(e[0] + 0.5), 0.336, Z(e[1] + 0.5)); root.add(ring); anim.ring = ring;
  }
  function buildRoom() {
    M(rbox(W + 0.3, 0.4, H + 0.3, 0.1), mat('#cfd4f2'), 0, -0.2, 0);
    const tiles = new THREE.InstancedMesh(rbox(0.95, 0.06, 0.95, 0.025), mat('#ffffff', { roughness: 0.55 }), W * H);
    const m4 = new THREE.Matrix4(), col = new THREE.Color(); let k = 0;
    for (let x = 0; x < W; x++) for (let y = 0; y < H; y++) {
      m4.makeTranslation(X(x + 0.5), -0.02, Z(y + 0.5)); tiles.setMatrixAt(k, m4);
      tiles.setColorAt(k++, col.set((x + y) % 2 ? '#e4e7fa' : '#dadef6'));
    }
    tiles.receiveShadow = true; root.add(tiles);
    // walls
    M(rbox(W + 0.3, 2.5, 0.26, 0.08), mat('#d9def8', { roughness: 0.7 }), 0, 0.9, -H / 2 - 0.13);
    M(rbox(0.26, 2.5, H + 0.3, 0.08), mat('#e3dcf8', { roughness: 0.7 }), -W / 2 - 0.13, 0.9, 0);
    // arch on the back wall
    const ax = X(W * 0.62 + 0.7), az = -H / 2;
    const fill = new THREE.Mesh(archFill(1.2, 1.7), mat('#d4c8f6', { roughness: 0.8 })); fill.position.set(ax, 0, az + 0.005); root.add(fill);
    const arch = M(archGeo(1.4, 1.8, 0.16, 0.08), mat('#ece5fd'), ax, 0, az, root); arch.castShadow = false;
    // neon ring on the left wall
    const rz = Z(H * 0.38);
    const ring = M(new THREE.TorusGeometry(0.42, 0.03, 16, 64), glow('#8fe2ff'), -W / 2 + 0.005, 1.35, rz, root, false); ring.rotation.y = Math.PI / 2;
    const halo = M(new THREE.TorusGeometry(0.42, 0.12, 16, 64), glow('#5fd2ff', 0.18), -W / 2 + 0.02, 1.35, rz, root, false); halo.rotation.y = Math.PI / 2;
    // wall neon line
    M(rbox(W * 0.5, 0.035, 0.035, 0.015), glow('#ffb3cf'), X(W * 0.27), 1.95, -H / 2 + 0.01, root, false);
    // floor neon
    neonStrip(X(0.15), Z(H - 0.15), X(W - 0.15), Z(H - 0.15), '#ff8fc0');
    neonStrip(X(W - 0.15), Z(H - 0.15), X(W - 0.15), Z(0.15), '#ff8fc0');
    neonStrip(X(0.15), Z(0.15), X(W - 0.6), Z(0.15), '#79d4ff');
  }
  let marker, robotR, minis = new Map();
  function build() {
    scene.remove(root); root = new THREE.Group(); scene.add(root);
    dyn.clear(); itemMeshes = new Map(); minis = new Map();
    anim.gears = []; anim.spin = []; anim.blinkers = []; anim.ring = null;
    if (robotR && robotR.beam) scene.remove(robotR.beam);
    built = world; W = world.W; H = world.H;
    buildRoom();
    if (world.conv) buildConveyor(world.conv);
    world.stations.forEach(buildStation);
    robotR = makeRobot('#9dbff5', true); robotR.ang = dirAngle(world.robot.dir); root.add(robotR.root);
    marker = new THREE.Mesh(new THREE.PlaneGeometry(0.92, 0.92), new THREE.MeshBasicMaterial({ map: markerTex, transparent: true, depthWrite: false, toneMapped: false }));
    marker.rotation.x = -Math.PI / 2; root.add(marker);
    const span = Math.max(W, H) * 0.8 + 2;
    Object.assign(sun.shadow.camera, { left: -span, right: span, top: span, bottom: -span, near: 0.5, far: 40 });
    sun.shadow.camera.updateProjectionMatrix();
    sun.position.set(3.5, 10, 6.5); sun.target.position.set(0, 0, 0);
    fit();
  }

  /* ---------- camera fit ---------- */
  let cw = 1, ch = 1;
  const DIR = new THREE.Vector3(1, 1.05, 1).normalize();
  function fit() {
    cw = canvas.clientWidth || 1; ch = canvas.clientHeight || 1;
    renderer.setSize(cw, ch, false);
    camera.aspect = cw / ch; camera.updateProjectionMatrix();
    const pts = [];
    for (const [x, z] of [[-W / 2, -H / 2], [W / 2, -H / 2], [-W / 2, H / 2], [W / 2, H / 2]]) pts.push(new THREE.Vector3(x, -0.05, z));
    pts.push(new THREE.Vector3(-W / 2 + 1.5, 1.1, -H / 2));
    const topLimit = 1 - 2 * 58 / ch;
    const target = new THREE.Vector3(0, 0.55, 0);
    const fits = (d) => {
      camera.position.copy(target).addScaledVector(DIR, d); camera.lookAt(target); camera.updateMatrixWorld();
      return pts.every((p) => { const v = p.clone().project(camera); return Math.abs(v.x) < 0.94 && v.y < topLimit && v.y > -0.95; });
    };
    let lo = 3, hi = 80;
    for (let i = 0; i < 24; i++) { const mid = (lo + hi) / 2; fits(mid) ? (hi = mid) : (lo = mid); }
    fits(hi);
    // centre the content vertically within the free area
    const ys = pts.map((p) => p.clone().project(camera).y), xs = pts.map((p) => p.clone().project(camera).x);
    const midY = (Math.max(...ys) + Math.min(...ys)) / 2, wantY = (topLimit - 0.96) / 2, midX = (Math.max(...xs) + Math.min(...xs)) / 2;
    camera.setViewOffset(cw, ch, midX * cw / 2, (wantY - midY) * ch / 2, cw, ch);
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(() => { if (built) fit(); }).observe(canvas);

  /* ---------- per frame ---------- */
  const v3 = new THREE.Vector3();
  function project(x, y, z = 0) {
    v3.set(X(x), z, Z(y)).project(camera);
    return [(v3.x + 1) / 2 * cw, (1 - v3.y) / 2 * ch];
  }
  let lastNow = performance.now();
  function render(now) {
    if (built !== world) build();
    const dt = Math.min(50, now - lastNow); lastNow = now;
    used = new Set();
    const w = world, r = w.robot;
    syncRobot(robotR, r, dt, now);
    // front marker
    const f = front(), onGrid = Number.isInteger(r.x) && Number.isInteger(r.y) && f.x >= 0 && f.y >= 0 && f.x < W && f.y < H;
    marker.visible = onGrid;
    if (onGrid) { marker.position.set(X(f.x + 0.5), 0.016, Z(f.y + 0.5)); marker.material.opacity = 0.65 + Math.sin(now / 250) * 0.25; }
    if (r.hand) { robotR.holder.getWorldPosition(v3); place(r.hand, v3.x, v3.y, v3.z, robotR.ang + Math.PI / 4, 0.95); }
    // conveyor
    const c = w.conv;
    if (c) {
      const fx = c.path[0][0] - c.machine.x, fy = c.path[0][1] - c.machine.y;
      beltTex.offset.x = -w.belt / 6;
      const e = c.path[c.path.length - 1];
      if (c.end) place(c.end, X(e[0] + 0.5), 0.335, Z(e[1] + 0.5));
      if (c.moving) { const [mx, my] = convPos(c, c.moving.pos); place(c.moving.item, X(mx), c.moving.pos < 0 ? 0.335 - Math.max(0, -c.moving.pos - 0.3) * 0.3 : 0.335, Z(my)); }
      if (anim.ring) { anim.ring.visible = !c.end; anim.ring.material.opacity = 0.5 + Math.sin(now / 200) * 0.3; }
      anim.blinkers.forEach((b) => (b.material = c.blink > 0.2 && Math.sin(now / 60) > 0 ? glow('#ff8fb3') : glow('#9fe0c3')));
      void fx; void fy;
    }
    // stations
    for (const s of w.stations) {
      const g = s.__g; if (!g) continue;
      const bx = X(s.x + 0.5), bz = Z(s.y + 0.5);
      if (s.type === 'bin') {
        g.scale.set(1 + s.bounce * 0.06, 1 + s.bounce * 0.14, 1 + s.bounce * 0.06);
        const slots = [[-0.14, 0.07, -0.13], [0.13, 0.07, 0.12], [-0.13, 0.07, 0.13], [0.14, 0.07, -0.12], [0, 0.24, 0], [-0.08, 0.24, 0.08]];
        s.items.slice(-6).forEach((it, i) => place(it, bx + slots[i][0], slots[i][1], bz + slots[i][2], 0.4 + i * 0.7, 0.85));
      } else if (s.type === 'pallet') s.items.forEach((it) => place(it, bx, 0.12, bz, Math.PI / 4, 1.15));
      else if (s.type === 'table') {
        const lift = s.bounce * 0.06; s.__top.position.y = lift;
        const pos = { head: [-0.2, -0.2], body: [0.18, -0.12], battery: [-0.12, 0.2] };
        s.items.forEach((it) => place(it, bx + pos[it.kind][0], 0.53 + lift, bz + pos[it.kind][1], Math.PI / 4, 0.9));
        flashLight.position.set(bx, 1.1, bz); flashLight.intensity = w.flash * 6;
      }
    }
    for (const fl of w.flying) place(fl.item, X(fl.x), fl.z, Z(fl.y), Math.PI / 4, 1);
    // spinning showcase parts and gears
    anim.spin.forEach((o) => (o.rotation.y += dt * 0.0008));
    anim.gears.forEach(([gm, sp]) => (gm.rotation.z += dt * sp * (c && c.moving ? 4 : 1)));
    // mini robots
    const live = new Set();
    for (const m of w.minis) {
      let R = minis.get(m);
      if (!R) { R = makeRobot(m.color, false); R.ang = dirAngle(m.dir); minis.set(m, R); root.add(R.root); }
      syncRobot(R, { ...m, x: m.x, y: m.y, hand: null, arm: 0, hop: 0, scan: 0, alert: 0 }, dt, now, 0.6 * Math.max(0.05, m.alpha), 3);
      live.add(m);
    }
    for (const [m, R] of minis) if (!live.has(m)) { root.remove(R.root); minis.delete(m); }
    for (const m of itemMeshes.values()) if (!used.has(m)) m.visible = false;
    renderer.render(scene, camera);
    const a = project(0, 0), b = project(1, 0);
    return Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.559;
  }

  window.GL3D = { render, project, resize: () => built && fit(), canvas };
  window.dispatchEvent(new Event('gl3d-ready'));
}
