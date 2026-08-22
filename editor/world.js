// World data model + scene builder. The editor and the play mode both drive this.
import * as THREE from 'three';

export const DEFAULTS = {
  box:      { scale: [2, 1, 2],     color: '#8d918c', solid: true,  grounded: true, interact: 'none', group: '', text: '' },
  cylinder: { scale: [1, 2, 1],     color: '#6e7480', solid: true,  grounded: true, interact: 'none', group: '', text: '' },
  sphere:   { scale: [1, 1, 1],     color: '#c0a060', solid: true,  grounded: true, interact: 'none', group: '', text: '' },
  wall:     { scale: [4, 3, 0.3],   color: '#9a9d97', solid: true,  grounded: true, interact: 'none', group: '', text: '' },
  ramp:     { scale: [3, 1, 4],     color: '#7a7d78', solid: false, grounded: true },
  door:     { scale: [1.2, 2.4, 0.1], color: '#4a5560', locked: false, keyName: 'Key', grounded: true, bars: false },
  tree:     { scale: [1, 1, 1],     color: '#17301c', grounded: true },
  light:    { color: '#fff1d6', intensity: 20, distance: 18, on: true, group: '', grounded: true, offset: 2.6 },
  path:     { width: 3, color: '#2b2d30', points: [] },
};
export const TYPE_LABELS = { box: 'Box', cylinder: 'Cylinder', sphere: 'Sphere', wall: 'Wall', ramp: 'Ramp', door: 'Door', tree: 'Tree', light: 'Light', path: 'Path' };

let nextId = 1;
export const uid = () => 'o' + (nextId++).toString(36) + Math.random().toString(36).slice(2, 6);

// ---------------------------------------------------------------------
//  procedural textures
// ---------------------------------------------------------------------
function makeTexture(size, draw, repeat = [1, 1]) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.repeat.set(...repeat); t.anisotropy = 4;
  return t;
}
const speckle = (ctx, s, n, a, px = 2) => { for (let i = 0; i < n; i++) { const v = (Math.random() * 255) | 0; ctx.fillStyle = `rgba(${v},${v},${v},${a})`; ctx.fillRect(Math.random() * s, Math.random() * s, px, px); } };
export const TEX = {
  grass: makeTexture(256, (ctx, s) => {
    ctx.fillStyle = '#2f3d2a'; ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 9000; i++) { const v = 30 + Math.random() * 50; ctx.fillStyle = `rgba(${v * 0.7},${v},${v * 0.55},.35)`; ctx.fillRect(Math.random() * s, Math.random() * s, 2, 4); }
  }, [80, 80]),
  concrete: makeTexture(256, (ctx, s) => {
    ctx.fillStyle = '#8d918c'; ctx.fillRect(0, 0, s, s); speckle(ctx, s, 6000, 0.18);
    ctx.strokeStyle = 'rgba(40,42,40,.5)'; ctx.lineWidth = 2;
    for (let y = 0; y <= s; y += s / 4) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(s, y); ctx.stroke(); }
    for (let r = 0; r < 4; r++) for (let x = (r % 2) * s / 4; x <= s; x += s / 2) { ctx.beginPath(); ctx.moveTo(x, r * s / 4); ctx.lineTo(x, (r + 1) * s / 4); ctx.stroke(); }
  }),
  asphalt: makeTexture(256, (ctx, s) => { ctx.fillStyle = '#2b2d30'; ctx.fillRect(0, 0, s, s); speckle(ctx, s, 7000, 0.12); }, [1, 1]),
  steel: makeTexture(256, (ctx, s) => {
    ctx.fillStyle = '#4b5057'; ctx.fillRect(0, 0, s, s); speckle(ctx, s, 5000, 0.1);
    ctx.strokeStyle = 'rgba(20,22,26,.8)'; ctx.lineWidth = 4; ctx.strokeRect(4, 4, s - 8, s - 8);
  }),
};
const matTrunk = new THREE.MeshStandardMaterial({ color: 0x3a2a1c, roughness: 1 });
const matMetal = new THREE.MeshStandardMaterial({ color: 0x5b6068, roughness: 0.5, metalness: 0.8 });
const matBars = new THREE.MeshStandardMaterial({ color: 0x3a3d42, roughness: 0.45, metalness: 0.9 });

// ---------------------------------------------------------------------
//  default / starter world
// ---------------------------------------------------------------------
export function emptyWorld() {
  return { version: 1, name: 'Untitled', terrain: { size: 300, seg: 100, heights: null }, objects: [], spawn: { pos: [0, 0, 6], yaw: 0 }, settings: { time: 0.1, fog: 0.006 } };
}
export function starterWorld() {
  const w = emptyWorld();
  w.name = 'Starter';
  const add = (type, pos, extra = {}) => w.objects.push({ id: uid(), type, pos, rot: 0, ...structuredClone(DEFAULTS[type]), ...extra });
  // a little guard hut with a door and a light
  add('wall', [-3, 0, -3], { scale: [6.3, 3, 0.3] });
  add('wall', [-3, 0, 3], { scale: [6.3, 3, 0.3] });
  add('wall', [-6, 0, 0], { scale: [0.3, 3, 6.3] });
  add('wall', [0, 0, -1.9], { scale: [0.3, 3, 2.5] });
  add('wall', [0, 0, 1.9], { scale: [0.3, 3, 2.5] });
  add('door', [0, 0, -0.6], { rot: -Math.PI / 2, name: 'Hut door' });
  add('box', [-3, 3, 0], { scale: [6.6, 0.2, 6.6], color: '#3a3d42', grounded: false, name: 'Roof' });
  add('box', [-3, 0, 0], { scale: [1.6, 0.8, 0.8], color: '#5a4330', interact: 'note', text: 'A desk. Someone left the radio on.' });
  add('box', [-3, 0.8, 0], { scale: [0.25, 0.12, 0.25], color: '#d4a935', interact: 'pickup', name: 'Brass Key', grounded: false });
  add('light', [-3, 0, 0], { group: 'hut' });
  add('box', [-5.6, 0, -2.2], { scale: [0.2, 0.3, 0.2], color: '#e8e4d8', interact: 'switch', group: 'hut', grounded: false, pos: [-5.7, 1.3, -2.2] });
  add('light', [8, 0, 8], { color: '#bfd4ff', intensity: 40, distance: 30, offset: 5 });
  for (let i = 0; i < 40; i++) { const a = Math.random() * Math.PI * 2, r = 18 + Math.random() * 40; add('tree', [Math.cos(a) * r, 0, Math.sin(a) * r], { scale: [0.8 + Math.random() * 0.8, 0.8 + Math.random() * 0.8, 0.8 + Math.random() * 0.8] }); }
  w.objects.push({ id: uid(), type: 'path', pos: [0, 0, 0], rot: 0, ...structuredClone(DEFAULTS.path), points: [[2, 0], [10, 2], [20, 10], [34, 14]] });
  w.spawn = { pos: [4, 0, 0], yaw: Math.PI / 2 };
  return w;
}

// ---------------------------------------------------------------------
//  World
// ---------------------------------------------------------------------
export class World {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group(); scene.add(this.group);
    this.meshes = new Map();       // id -> Group
    this.data = emptyWorld();
    this.buildTerrain();
    this.spawnMarker = this.makeSpawnMarker();
    this.group.add(this.spawnMarker);
  }

  // ---------- terrain
  buildTerrain() {
    const { size, seg } = this.data.terrain;
    const n = seg + 1;
    if (!this.data.terrain.heights || this.data.terrain.heights.length !== n * n) this.data.terrain.heights = new Array(n * n).fill(0);
    if (this.terrain) { this.group.remove(this.terrain); this.terrain.geometry.dispose(); }
    const geo = new THREE.PlaneGeometry(size, size, seg, seg);
    geo.rotateX(-Math.PI / 2);
    this.terrain = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: TEX.grass, roughness: 1 }));
    this.terrain.receiveShadow = true;
    this.terrain.userData.terrain = true;
    this.group.add(this.terrain);
    this.refreshTerrain();
  }
  refreshTerrain() {
    const pos = this.terrain.geometry.attributes.position, h = this.data.terrain.heights;
    for (let i = 0; i < pos.count; i++) pos.setY(i, h[i]);
    pos.needsUpdate = true;
    this.terrain.geometry.computeVertexNormals();
    this.terrain.geometry.computeBoundingSphere();
  }
  sampleHeight(x, z) {
    const { size, seg, heights } = this.data.terrain, n = seg + 1, step = size / seg;
    const fx = THREE.MathUtils.clamp((x + size / 2) / step, 0, seg - 1e-6), fz = THREE.MathUtils.clamp((z + size / 2) / step, 0, seg - 1e-6);
    const ix = Math.floor(fx), iz = Math.floor(fz), tx = fx - ix, tz = fz - iz;
    const h00 = heights[iz * n + ix], h10 = heights[iz * n + ix + 1], h01 = heights[(iz + 1) * n + ix], h11 = heights[(iz + 1) * n + ix + 1];
    return (h00 * (1 - tx) + h10 * tx) * (1 - tz) + (h01 * (1 - tx) + h11 * tx) * tz;
  }
  sculpt(x, z, radius, strength, mode, target = 0) {
    const { size, seg, heights } = this.data.terrain, n = seg + 1, step = size / seg, half = size / 2;
    const i0 = Math.max(0, Math.floor((x - radius + half) / step)), i1 = Math.min(seg, Math.ceil((x + radius + half) / step));
    const j0 = Math.max(0, Math.floor((z - radius + half) / step)), j1 = Math.min(seg, Math.ceil((z + radius + half) / step));
    const r2 = radius * radius;
    const src = mode === 'smooth' ? heights.slice() : heights;
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const vx = -half + i * step, vz = -half + j * step;
      const d2 = (vx - x) ** 2 + (vz - z) ** 2;
      if (d2 > r2) continue;
      const f = (1 - d2 / r2) ** 2, k = j * n + i;
      let h = heights[k];
      if (mode === 'raise') h += strength * f;
      else if (mode === 'lower') h -= strength * f;
      else if (mode === 'flatten') h += (target - h) * Math.min(1, f * strength * 0.6);
      else if (mode === 'smooth') {
        let sum = 0, c = 0;
        for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const ii = i + di, jj = j + dj; if (ii >= 0 && ii <= seg && jj >= 0 && jj <= seg) { sum += src[jj * n + ii]; c++; } }
        h += (sum / c - h) * Math.min(1, f * strength * 0.8);
      }
      heights[k] = THREE.MathUtils.clamp(h, -40, 120);
    }
    this.refreshTerrain();
  }

  // ---------- serialize / load
  serialize() {
    const d = structuredClone(this.data);
    d.terrain.heights = d.terrain.heights.map(v => Math.round(v * 100) / 100);
    return d;
  }
  load(data) {
    for (const id of [...this.meshes.keys()]) this.removeObject(id, false);
    this.data = structuredClone(data);
    if (!this.data.settings) this.data.settings = { time: 0.1, fog: 0.006 };
    this.buildTerrain();
    for (const o of this.data.objects) this.buildObject(o);
    this.updateSpawnMarker();
  }

  // ---------- objects
  addObject(def) {
    const o = { id: uid(), rot: 0, ...structuredClone(DEFAULTS[def.type] || {}), ...def };
    this.data.objects.push(o);
    this.buildObject(o);
    return o;
  }
  getObject(id) { return this.data.objects.find(o => o.id === id); }
  removeObject(id, fromData = true) {
    const g = this.meshes.get(id);
    if (g) { this.group.remove(g); g.traverse(m => { m.geometry?.dispose?.(); }); this.meshes.delete(id); }
    if (fromData) this.data.objects = this.data.objects.filter(o => o.id !== id);
  }
  rebuildObject(id) { const o = this.getObject(id); if (!o) return; this.removeObject(id, false); this.buildObject(o); }
  groundAll() { for (const o of this.data.objects) if (o.grounded) { o.pos[1] = this.sampleHeight(o.pos[0], o.pos[2]) + (o.offset || 0); this.syncTransform(o); } for (const o of this.data.objects) if (o.type === 'path') this.rebuildObject(o.id); this.updateSpawnMarker(); }
  syncTransform(o) {
    const g = this.meshes.get(o.id); if (!g) return;
    g.position.set(o.pos[0], o.pos[1], o.pos[2]); g.rotation.set(0, o.rot || 0, 0);
    if (o.scale && o.type !== 'path' && o.type !== 'light') g.scale.set(o.scale[0], o.scale[1], o.scale[2]);
  }
  // read transform back from a gizmo-manipulated group
  pullTransform(o) {
    const g = this.meshes.get(o.id); if (!g) return;
    o.pos = [g.position.x, g.position.y, g.position.z]; o.rot = g.rotation.y;
    if (o.type !== 'path' && o.type !== 'light') o.scale = [Math.max(0.05, g.scale.x), Math.max(0.05, g.scale.y), Math.max(0.05, g.scale.z)];
    if (o.grounded) { o.pos[1] = this.sampleHeight(o.pos[0], o.pos[2]) + (o.offset || 0); }
    this.syncTransform(o);
    if (o.type === 'light') this.rebuildObject(o.id);
  }

  buildObject(o) {
    const g = new THREE.Group();
    g.userData.id = o.id;
    const col = new THREE.Color(o.color || '#888');
    const std = (extra = {}) => new THREE.MeshStandardMaterial({ color: col, roughness: 0.85, ...extra });
    const addMesh = (geo, mat) => { const m = new THREE.Mesh(geo, mat); m.castShadow = m.receiveShadow = true; g.add(m); return m; };
    switch (o.type) {
      case 'box': case 'wall': {
        const geo = new THREE.BoxGeometry(1, 1, 1); geo.translate(0, 0.5, 0);
        const mat = o.type === 'wall' ? std({ map: TEX.concrete }) : std();
        addMesh(geo, mat); break;
      }
      case 'ramp': {
        // wedge: rises along +z
        const geo = new THREE.BufferGeometry();
        const v = [ -0.5,0,-0.5,  0.5,0,-0.5,  0.5,0,0.5,  -0.5,0,0.5,  -0.5,1,0.5,  0.5,1,0.5 ];
        const idx = [ 0,2,1, 0,3,2,  3,4,5, 3,5,2,  0,1,5, 0,5,4,  0,4,3,  1,2,5 ];
        geo.setAttribute('position', new THREE.Float32BufferAttribute(v, 3)); geo.setIndex(idx); geo.computeVertexNormals();
        addMesh(geo, std({ side: THREE.DoubleSide })); break;
      }
      case 'cylinder': { const geo = new THREE.CylinderGeometry(0.5, 0.5, 1, 20); geo.translate(0, 0.5, 0); addMesh(geo, std()); break; }
      case 'sphere': { const geo = new THREE.SphereGeometry(0.5, 20, 14); geo.translate(0, 0.5, 0); addMesh(geo, std()); break; }
      case 'door': {
        const hinge = new THREE.Group(); hinge.name = 'hinge'; g.add(hinge);
        if (o.bars) {
          for (let i = 0; i < 6; i++) { const b = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 1, 8), matBars); b.position.set(0.08 + i * 0.168, 0.5, 0); b.castShadow = true; hinge.add(b); }
          for (const y of [0.08, 0.5, 0.92]) { const r = new THREE.Mesh(new THREE.BoxGeometry(1, 0.03, 0.6), matBars); r.position.set(0.5, y, 0); hinge.add(r); }
          const hit = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ visible: false })); hit.position.set(0.5, 0.5, 0); hinge.add(hit);
        } else {
          const geo = new THREE.BoxGeometry(1, 1, 1); geo.translate(0.5, 0.5, 0);
          const m = new THREE.Mesh(geo, std({ map: TEX.steel, metalness: 0.4, roughness: 0.6 })); m.castShadow = m.receiveShadow = true; hinge.add(m);
          const handle = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.03, 0.5), matMetal); handle.position.set(0.85, 0.45, 0); hinge.add(handle);
        }
        // frame posts (not scaled with thickness visually — fine for a prototype)
        const postL = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.02, 1.6), matMetal); postL.position.set(-0.03, 0.51, 0); g.add(postL);
        const postR = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.02, 1.6), matMetal); postR.position.set(1.03, 0.51, 0); g.add(postR);
        const top = new THREE.Mesh(new THREE.BoxGeometry(1.12, 0.05, 1.6), matMetal); top.position.set(0.5, 1.025, 0); g.add(top);
        g.userData.door = { open: false, angle: 0 };
        break;
      }
      case 'tree': {
        const leaves = new THREE.Mesh(new THREE.ConeGeometry(1.6, 5.5, 7), std({ roughness: 1 })); leaves.position.y = 1.2 + 2.75; leaves.castShadow = true; g.add(leaves);
        const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.28, 1.4, 6), matTrunk); trunk.position.y = 0.7; g.add(trunk);
        break;
      }
      case 'light': {
        const light = new THREE.PointLight(col, o.on ? o.intensity : 0, o.distance, 2); g.add(light);
        const fix = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 8), new THREE.MeshStandardMaterial({ color: 0xdddddd, emissive: col, emissiveIntensity: o.on ? 2.5 : 0 })); g.add(fix);
        if (o.grounded) { // pole from the ground to the lamp
          const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, o.offset || 2.6, 8), matMetal); pole.position.y = -(o.offset || 2.6) / 2; g.add(pole);
        }
        g.userData.light = light; g.userData.fixMat = fix.material;
        break;
      }
      case 'path': {
        const geo = this.buildPathGeometry(o);
        if (geo) { const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: col, map: TEX.asphalt, roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })); m.receiveShadow = true; g.add(m); }
        break;
      }
    }
    g.position.set(o.pos[0], o.pos[1], o.pos[2]);
    g.rotation.y = o.rot || 0;
    if (o.scale && o.type !== 'path' && o.type !== 'light') g.scale.set(o.scale[0], o.scale[1], o.scale[2]);
    this.group.add(g);
    this.meshes.set(o.id, g);
    return g;
  }
  buildPathGeometry(o) {
    const pts = o.points; if (!pts || pts.length < 2) return null;
    const w = o.width / 2, verts = [], uvs = [], idx = [];
    let row = 0, dist = 0;
    const pushRow = (x, z, dx, dz) => {
      const lx = -dz * w, lz = dx * w;
      const h0 = this.sampleHeight(x + lx, z + lz) + 0.04, h1 = this.sampleHeight(x - lx, z - lz) + 0.04;
      verts.push(x + lx, h0, z + lz, x - lx, h1, z - lz);
      uvs.push(0, dist / 4, 1, dist / 4);
      if (row > 0) { const b = row * 2; idx.push(b - 2, b, b - 1, b - 1, b, b + 1); }
      row++;
    };
    for (let i = 0; i < pts.length - 1; i++) {
      const [x0, z0] = pts[i], [x1, z1] = pts[i + 1];
      const len = Math.hypot(x1 - x0, z1 - z0); if (len < 1e-3) continue;
      const dx = (x1 - x0) / len, dz = (z1 - z0) / len, n = Math.max(1, Math.ceil(len / 1.5));
      for (let k = 0; k <= n; k++) { if (k === n && i < pts.length - 2) break; const t = k / n; pushRow(x0 + (x1 - x0) * t, z0 + (z1 - z0) * t, dx, dz); dist += len / n; }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(idx); geo.computeVertexNormals();
    return geo;
  }

  // ---------- spawn
  makeSpawnMarker() {
    const g = new THREE.Group(); g.name = 'spawn';
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 1.0, 4, 10), new THREE.MeshStandardMaterial({ color: 0x5ef2ff, emissive: 0x1c7c88, emissiveIntensity: 0.8, transparent: true, opacity: 0.8 }));
    body.position.y = 0.9; g.add(body);
    const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.5, 8), new THREE.MeshBasicMaterial({ color: 0xffd25a }));
    arrow.rotation.x = -Math.PI / 2; arrow.position.set(0, 1.4, -0.6); g.add(arrow);
    g.userData.spawn = true;
    return g;
  }
  updateSpawnMarker() {
    const s = this.data.spawn;
    s.pos[1] = this.sampleHeight(s.pos[0], s.pos[2]);
    this.spawnMarker.position.set(s.pos[0], s.pos[1], s.pos[2]);
    this.spawnMarker.rotation.y = s.yaw;
  }

  // ---------- runtime helpers (play mode)
  doorState(id) { return this.meshes.get(id)?.userData.door; }
  setDoor(id, open) { const d = this.doorState(id); if (d) d.open = open; }
  updateDoors(dt) {
    for (const [id, g] of this.meshes) {
      const d = g.userData.door; if (!d) continue;
      const target = d.open ? -Math.PI / 2 : 0;
      d.angle += (target - d.angle) * Math.min(1, dt * 8);
      const hinge = g.getObjectByName('hinge'); if (hinge) hinge.rotation.y = d.angle;
    }
  }
  setLight(id, on) {
    const o = this.getObject(id), g = this.meshes.get(id); if (!o || !g) return;
    o.on = on; g.userData.light.intensity = on ? o.intensity : 0; g.userData.fixMat.emissiveIntensity = on ? 2.5 : 0;
  }
  // oriented boxes for collision: {cx, cz, hx, hz, rot, id}
  colliders() {
    const out = [];
    for (const o of this.data.objects) {
      if (o.type === 'door') {
        const d = this.doorState(o.id); if (d && (d.open || d.angle < -0.5)) continue;
        const c = Math.cos(o.rot || 0), s = Math.sin(o.rot || 0), hx = o.scale[0] / 2;
        out.push({ cx: o.pos[0] + c * hx, cz: o.pos[2] - s * hx, hx, hz: Math.max(0.12, o.scale[2] / 2), rot: o.rot || 0, top: o.pos[1] + o.scale[1], bottom: o.pos[1] });
      } else if (o.type === 'tree') {
        out.push({ cx: o.pos[0], cz: o.pos[2], hx: 0.3 * o.scale[0], hz: 0.3 * o.scale[2], rot: 0, top: o.pos[1] + 2, bottom: o.pos[1] });
      } else if (o.solid && o.scale) {
        out.push({ cx: o.pos[0], cz: o.pos[2], hx: o.scale[0] / 2, hz: o.scale[2] / 2, rot: o.rot || 0, top: o.pos[1] + o.scale[1], bottom: o.pos[1] });
      }
    }
    return out;
  }
  // height of walkable surfaces (terrain + tops of low solids you can stand on + ramps)
  standHeight(x, z, feetY) {
    let h = this.sampleHeight(x, z);
    for (const o of this.data.objects) {
      if (!o.scale) continue;
      const c = Math.cos(-(o.rot || 0)), s = Math.sin(-(o.rot || 0));
      const dx = x - o.pos[0], dz = z - o.pos[2];
      const lx = dx * c - dz * s, lz = dx * s + dz * c;
      if (o.type === 'ramp') {
        if (Math.abs(lx) <= o.scale[0] / 2 && Math.abs(lz) <= o.scale[2] / 2) { const t = (lz + o.scale[2] / 2) / o.scale[2]; h = Math.max(h, o.pos[1] + t * o.scale[1]); }
      } else if (o.solid && (o.type === 'box' || o.type === 'wall' || o.type === 'cylinder')) {
        const top = o.pos[1] + o.scale[1];
        if (Math.abs(lx) <= o.scale[0] / 2 && Math.abs(lz) <= o.scale[2] / 2 && top <= feetY + 0.55 && top > h) h = top;
      }
    }
    return h;
  }
}
