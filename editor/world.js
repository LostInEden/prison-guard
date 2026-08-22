// World data model + scene builder. The editor and the play mode both drive this.
import * as THREE from 'three';
import { Brush, Evaluator, ADDITION, SUBTRACTION } from 'three-bvh-csg';

export const DEFAULTS = {
  box:      { scale: [2, 1, 2],     color: '#8d918c', solid: true,  grounded: true, interact: 'none', group: '', text: '' },
  cylinder: { scale: [1, 2, 1],     color: '#6e7480', solid: true,  grounded: true, interact: 'none', group: '', text: '', half: false },
  // a shell built from several shapes: union(parts) minus the same parts shrunk by `thickness`, minus any `cuts`
  hollow:   { color: '#8d918c', thickness: 0.3, parts: [], cuts: [], solid: true, grounded: false },
  sphere:   { scale: [1, 1, 1],     color: '#c0a060', solid: true,  grounded: true, interact: 'none', group: '', text: '' },
  wall:     { scale: [4, 3, 0.3],   color: '#9a9d97', solid: true,  grounded: true, interact: 'none', group: '', text: '' },
  ramp:     { scale: [3, 1, 4],     color: '#7a7d78', solid: false, grounded: true },
  // swing: 'auto' opens away from whoever opens it; 'in' / 'out' always swing towards local -z / +z
  door:     { scale: [1.2, 2.4, 0.1], color: '#4a5560', locked: false, keyName: 'Key', grounded: true, bars: false, swing: 'auto' },
  tree:     { scale: [1, 1, 1],     color: '#17301c', grounded: true },
  light:    { color: '#fff1d6', intensity: 20, distance: 18, on: true, group: '', grounded: true, offset: 2.6 },
  path:     { width: 3, color: '#2b2d30', points: [], smooth: true },
  fence:    { points: [], height: 2.2, spacing: 3, style: 'chainlink', color: '#9aa1a8', solid: true },
};
export const TYPE_LABELS = { box: 'Box', cylinder: 'Cylinder', sphere: 'Sphere', wall: 'Wall', ramp: 'Ramp', door: 'Door', tree: 'Tree', light: 'Light', path: 'Path', hollow: 'Hollow', fence: 'Fence' };
export const LINE_TYPES = ['path', 'fence'];   // drawn as a chain of points, not placed
export const HOLLOW_TYPES = ['box', 'wall', 'cylinder', 'sphere'];   // shapes that can be hollowed together

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
  // one diamond of chain-link on a transparent tile (tile = 0.25 m once the UVs are scaled)
  chainlink: makeTexture(64, (ctx, s) => {
    ctx.clearRect(0, 0, s, s); ctx.strokeStyle = '#b9bfc6'; ctx.lineWidth = 5; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(0, s / 2); ctx.lineTo(s / 2, 0); ctx.lineTo(s, s / 2); ctx.lineTo(s / 2, s); ctx.closePath(); ctx.stroke();
  }),
};
const matTrunk = new THREE.MeshStandardMaterial({ color: 0x3a2a1c, roughness: 1 });
const matMetal = new THREE.MeshStandardMaterial({ color: 0x5b6068, roughness: 0.5, metalness: 0.8 });
const matBars = new THREE.MeshStandardMaterial({ color: 0x3a3d42, roughness: 0.45, metalness: 0.9 });

// ---------------------------------------------------------------------
//  primitives + hollow (CSG) helpers
// ---------------------------------------------------------------------
// unit-sized solids, base at y = 0, footprint x,z in [-0.5, 0.5]. A half cylinder keeps its flat face at z = 0
// and bulges towards -z, so its inside can run straight into whatever it is pushed against.
const unitGeo = {};
export function primitiveGeometry(kind) {
  if (unitGeo[kind]) return unitGeo[kind];
  let geo;
  if (kind === 'cylinder') { geo = new THREE.CylinderGeometry(0.5, 0.5, 1, 24); geo.translate(0, 0.5, 0); }
  else if (kind === 'halfcyl') {
    const sh = new THREE.Shape(); sh.moveTo(0.5, 0); sh.absarc(0, 0, 0.5, 0, Math.PI, false); sh.lineTo(0.5, 0);
    geo = new THREE.ExtrudeGeometry(sh, { depth: 1, bevelEnabled: false, curveSegments: 16 }); geo.rotateX(-Math.PI / 2);
  }
  else if (kind === 'sphere') { geo = new THREE.SphereGeometry(0.5, 24, 16); geo.translate(0, 0.5, 0); }
  else { geo = new THREE.BoxGeometry(1, 1, 1); geo.translate(0, 0.5, 0); }
  return unitGeo[kind] = geo;
}
export const partKind = (p) => p.type === 'cylinder' ? (p.half ? 'halfcyl' : 'cylinder') : p.type === 'sphere' ? 'sphere' : 'box';
const _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3();
const partMatrix = (p) => new THREE.Matrix4().compose(new THREE.Vector3(p.pos[0], p.pos[1], p.pos[2]), _q.setFromEuler(_e.set(0, p.rot || 0, 0)), new THREE.Vector3(p.scale[0], p.scale[1], p.scale[2]));
// the inside of a part: shrunk by the wall thickness on every side. The shrink is about (0, 0.5, 0), so a half
// cylinder (which only occupies z <= 0) keeps its flat face in place and loses t off its curved side.
function insetScale(p, t) {
  const [sx, sy, sz] = p.scale;
  return [Math.max(0.02, (sx - 2 * t) / sx), Math.max(0.02, (sy - 2 * t) / sy), Math.max(0.02, (sz - 2 * t) / sz)];
}
function insetMatrix(p, t) {
  const k = insetScale(p, t);
  return partMatrix(p).multiply(new THREE.Matrix4().makeTranslation(0, 0.5, 0)).multiply(new THREE.Matrix4().makeScale(k[0], k[1], k[2])).multiply(new THREE.Matrix4().makeTranslation(0, -0.5, 0));
}
// is a unit-space point inside a part of this kind?
function insideUnit(kind, lx, ly, lz) {
  if (ly < 0 || ly > 1) return false;
  if (kind === 'box') return Math.abs(lx) <= 0.5 && Math.abs(lz) <= 0.5;
  if (kind === 'halfcyl') return lz <= 0 && lx * lx + lz * lz <= 0.25;
  return lx * lx + lz * lz <= 0.25;   // cylinder; a sphere is treated as a cylinder for walking purposes
}
// geometry of a hollow, in the hollow's own frame
function buildHollowGeometry(o) {
  const ev = new Evaluator(); ev.useGroups = false; ev.attributes = ['position', 'normal'];
  const mk = (kind, m) => { const b = new Brush(primitiveGeometry(kind)); b.matrixAutoUpdate = false; b.matrix.copy(m); b.updateMatrixWorld(true); return b; };
  const unionAll = (brushes) => brushes.reduce((acc, b) => acc ? ev.evaluate(acc, b, ADDITION) : b, null);
  const outer = unionAll(o.parts.map(p => mk(partKind(p), partMatrix(p))));
  const inner = unionAll(o.parts.map(p => mk(partKind(p), insetMatrix(p, o.thickness))));
  if (!outer || !inner) return null;
  let res = ev.evaluate(outer, inner, SUBTRACTION);
  for (const c of o.cuts || []) res = ev.evaluate(res, mk('box', partMatrix(c)), SUBTRACTION);
  res.geometry.computeBoundingSphere();
  return res.geometry;
}
// thin wall colliders (hollow-local) that follow every part's outline, minus bits that sit inside another
// part's interior or inside a cut — so you can walk from room to room and through doorways
function hollowSegments(o) {
  const t = o.thickness, segs = [], v = new THREE.Vector3(), a = new THREE.Vector3(), b = new THREE.Vector3();
  const parts = o.parts.map(p => ({ p, kind: partKind(p), M: partMatrix(p), invInset: insetMatrix(p, t).invert() }));
  const cutInv = (o.cuts || []).map(c => partMatrix(c).invert());
  const blocked = (wx, wy, wz, self) => {
    for (const q of parts) { if (q !== self) { v.set(wx, wy, wz).applyMatrix4(q.invInset); if (insideUnit(q.kind, v.x, v.y, v.z)) return true; } }
    for (const inv of cutInv) { v.set(wx, wy, wz).applyMatrix4(inv); if (insideUnit('box', v.x, v.y, v.z)) return true; }
    return false;
  };
  for (const q of parts) {
    const [sx, sy, sz] = q.p.scale;
    const ix = 0.5 - t / (2 * sx), iz = 0.5 - t / (2 * sz);   // outline pulled in by half a wall so the collider sits inside the wall
    const pts = [];
    if (q.kind === 'box') pts.push([ix, iz], [-ix, iz], [-ix, -iz], [ix, -iz], [ix, iz]);
    else {
      const full = q.kind !== 'halfcyl', n = Math.max(12, Math.ceil(Math.PI * (sx + sz) / 2 / 0.6)), m = full ? n : Math.ceil(n / 2);
      for (let i = 0; i <= m; i++) { const ang = full ? (i / n) * Math.PI * 2 : Math.PI + (i / m) * Math.PI; pts.push([Math.cos(ang) * ix, full ? Math.sin(ang) * iz : Math.min(Math.sin(ang) * iz, -t / (2 * sz))]); }
      if (!full) pts.push(pts[0]);   // the flat face
    }
    for (let i = 0; i < pts.length - 1; i++) {
      a.set(pts[i][0], 0, pts[i][1]).applyMatrix4(q.M); b.set(pts[i + 1][0], 0, pts[i + 1][1]).applyMatrix4(q.M);
      const len = Math.hypot(b.x - a.x, b.z - a.z); if (len < 1e-4) continue;
      const n = Math.max(1, Math.ceil(len / 0.6)), dx = (b.x - a.x) / len, dz = (b.z - a.z) / len, rot = Math.atan2(-dz, dx);
      for (let k = 0; k < n; k++) {
        const cx = a.x + dx * len * (k + 0.5) / n, cz = a.z + dz * len * (k + 0.5) / n;
        if (blocked(cx, a.y + Math.min(1, sy / 2), cz, q)) continue;
        segs.push({ cx, cz, rot, hx: len / n / 2 + 0.05, hz: Math.max(t / 2, 0.12), bottom: a.y, top: a.y + sy });
      }
    }
  }
  return segs;
}

// ---------------------------------------------------------------------
//  default / starter world
// ---------------------------------------------------------------------
export function emptyWorld() {
  // groundMode: 'center' snaps an object's origin to the terrain; 'highest' sits it on the highest ground under its footprint so nothing sinks in
  return { version: 1, name: 'Untitled', terrain: { size: 300, seg: 100, heights: null }, objects: [], spawn: { pos: [0, 0, 6], yaw: 0 }, settings: { time: 0.1, fog: 0.006, groundMode: 'highest' } };
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
    TEX.grass.repeat.set(size / 3.75, size / 3.75);   // keep the grass the same scale whatever the map size
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
  // change the map's edge length (metres). Existing heights are resampled into the new grid,
  // so growing keeps what you sculpted and shrinking just clips the outside.
  resizeTerrain(size) {
    size = THREE.MathUtils.clamp(Math.round(size), 40, 2000);
    const seg = THREE.MathUtils.clamp(Math.round(size / 3), 16, 240);   // ~3 m per vertex, capped for performance
    const n = seg + 1, step = size / seg, half = size / 2, heights = new Array(n * n);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) heights[j * n + i] = this.sampleHeight(-half + i * step, -half + j * step);
    this.data.terrain = { size, seg, heights };
    this.buildTerrain();
    this.groundAll();
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
    if (!this.data.settings.groundMode) this.data.settings.groundMode = 'center';   // older worlds keep their placement
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
  groundAll() { for (const o of this.data.objects) if (o.grounded) { o.pos[1] = this.groundY(o) + (o.offset || 0); this.syncTransform(o); } for (const o of this.data.objects) if (LINE_TYPES.includes(o.type)) this.rebuildObject(o.id); this.updateSpawnMarker(); }
  // the terrain height an object should sit at if its origin were at (x, z). In 'highest' mode that is the
  // highest ground anywhere under its footprint (hollows: under every part), so no corner sinks in.
  groundY(o, x = o.pos[0], z = o.pos[2], mode = this.data.settings.groundMode) {
    if (mode !== 'highest') return this.sampleHeight(x, z);
    let h = -Infinity;
    const obb = (cx, cz, sx, sz, rot, ox = 0, oz = 0) => {
      const c = Math.cos(rot), s = Math.sin(rot), n = 4;
      for (let i = 0; i <= n; i++) for (let j = 0; j <= n; j++) {
        const lx = (i / n - 0.5) * sx + ox, lz = (j / n - 0.5) * sz + oz;
        h = Math.max(h, this.sampleHeight(cx + lx * c + lz * s, cz - lx * s + lz * c));
      }
    };
    const r = o.rot || 0;
    if (o.type === 'hollow') {
      const c = Math.cos(r), s = Math.sin(r);
      for (const p of o.parts) {
        const half = partKind(p) === 'halfcyl';
        obb(x + p.pos[0] * c + p.pos[2] * s, z - p.pos[0] * s + p.pos[2] * c, p.scale[0], half ? p.scale[2] / 2 : p.scale[2], r + (p.rot || 0), 0, half ? -p.scale[2] / 4 : 0);
      }
    } else if (o.type === 'door') obb(x, z, o.scale[0], Math.max(0.3, o.scale[2]), r, o.scale[0] / 2, 0);
    else if (o.scale && o.type !== 'tree') obb(x, z, o.scale[0], o.half ? o.scale[2] / 2 : o.scale[2], r, 0, o.half ? -o.scale[2] / 4 : 0);
    else h = this.sampleHeight(x, z);
    return h;
  }
  // floor height inside a hollow at a world point, or null if the point is not over any part
  hollowFloorAt(o, x, z) {
    const H = this.meshes.get(o.id)?.userData.hollow; if (!H) return null;
    const c = Math.cos(o.rot || 0), s = Math.sin(o.rot || 0), dx = x - o.pos[0], dz = z - o.pos[2];
    const lx = dx * c - dz * s, lz = dx * s + dz * c;
    let best = null;
    for (const q of H.parts) { _v.set(lx, 0, lz).applyMatrix4(q.inv); if (insideUnit(q.kind, _v.x, 0.5, _v.z)) { const f = o.pos[1] + q.p.pos[1] + H.t; if (best === null || f < best) best = f; } }
    return best;
  }
  syncTransform(o) {
    const g = this.meshes.get(o.id); if (!g) return;
    g.position.set(o.pos[0], o.pos[1], o.pos[2]); g.rotation.set(0, o.rot || 0, 0);
    if (o.scale && o.type !== 'path' && o.type !== 'light') g.scale.set(o.scale[0], o.scale[1], o.scale[2]); else g.scale.set(1, 1, 1);
  }
  // read transform back from a gizmo-manipulated group.
  //   lifting — true while the user is dragging along the Y axis. A grounded object that gets lifted
  //             comes off the ground (a pole light instead grows/shrinks its pole).
  //   final   — true when the drag ends; pole lights rebuild their mesh then (not every tick, or the
  //             gizmo would be left holding a mesh that is no longer in the scene).
  pullTransform(o, lifting = false, final = false) {
    const g = this.meshes.get(o.id); if (!g) return;
    if (o.grounded) {
      const ground = this.groundY(o, g.position.x, g.position.z);
      if (lifting && Math.abs(g.position.y - (ground + (o.offset || 0))) > 0.02) {
        if (o.type === 'light') o.offset = Math.max(0, g.position.y - ground);
        else o.grounded = false;
      } else g.position.y = ground + (o.offset || 0);   // slide along the terrain
    }
    o.pos = [g.position.x, g.position.y, g.position.z]; o.rot = g.rotation.y;
    if (o.scale && o.type !== 'path' && o.type !== 'light') o.scale = [Math.max(0.05, g.scale.x), Math.max(0.05, g.scale.y), Math.max(0.05, g.scale.z)];
    this.syncTransform(o);
    if (final && o.type === 'light' && o.grounded) this.rebuildObject(o.id);
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
      case 'cylinder': { addMesh(primitiveGeometry(o.half ? 'halfcyl' : 'cylinder').clone(), std()); break; }
      case 'hollow': {
        let geo = null;
        try { geo = buildHollowGeometry(o); } catch (err) { console.warn('Hollow failed to build', err); }
        if (geo) addMesh(geo, std({ side: THREE.DoubleSide }));
        g.userData.hollow = { t: o.thickness, segs: hollowSegments(o), parts: o.parts.map(p => ({ p, kind: partKind(p), inv: partMatrix(p).invert() })) };
        break;
      }
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
        const fix = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 10), new THREE.MeshStandardMaterial({ color: 0xdddddd, emissive: col, emissiveIntensity: o.on ? 2.5 : 0 })); g.add(fix);
        const hit = new THREE.Mesh(new THREE.SphereGeometry(0.5, 8, 6), new THREE.MeshBasicMaterial({ visible: false })); g.add(hit);   // generous click target
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
      case 'fence': { this.buildFence(o, g); break; }
    }
    g.position.set(o.pos[0], o.pos[1], o.pos[2]);
    g.rotation.y = o.rot || 0;
    if (o.scale && o.type !== 'path' && o.type !== 'light') g.scale.set(o.scale[0], o.scale[1], o.scale[2]);
    this.group.add(g);
    this.meshes.set(o.id, g);
    return g;
  }
  // the centre line of a path: the clicked points, run through a spline when `smooth` (so corners bend
  // instead of mitring), sampled every ~1 m. Returns [[x, z], ...].
  static centerLine(points, smooth, step = 1) {
    const pts = points.filter((p, i) => i === 0 || Math.hypot(p[0] - points[i - 1][0], p[1] - points[i - 1][1]) > 1e-3);
    if (pts.length < 2) return pts;
    if (smooth && pts.length >= 3) {
      const curve = new THREE.CatmullRomCurve3(pts.map(([x, z]) => new THREE.Vector3(x, 0, z)), false, 'centripetal');
      return curve.getSpacedPoints(Math.max(2, Math.ceil(curve.getLength() / step))).map(v => [v.x, v.z]);
    }
    const out = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const [x0, z0] = pts[i], [x1, z1] = pts[i + 1], n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, z1 - z0) / step));
      for (let k = 0; k < n; k++) out.push([x0 + (x1 - x0) * k / n, z0 + (z1 - z0) * k / n]);
    }
    out.push(pts[pts.length - 1]);
    return out;
  }
  buildPathGeometry(o) {
    const line = World.centerLine(o.points || [], o.smooth !== false); if (line.length < 2) return null;
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
    for (let i = 0; i < line.length; i++) {
      const [x, z] = line[i], [px, pz] = line[Math.max(0, i - 1)], [nx, nz] = line[Math.min(line.length - 1, i + 1)];
      let dx = nx - px, dz = nz - pz; const len = Math.hypot(dx, dz) || 1; dx /= len; dz /= len;   // central-difference tangent
      if (i > 0) dist += Math.hypot(x - px, z - pz);
      pushRow(x, z, dx, dz);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(idx); geo.computeVertexNormals();
    return geo;
  }

  // posts every `spacing` metres along the clicked points, panels between them that follow the slope
  buildFence(o, g) {
    const pts = (o.points || []).filter((p, i) => i === 0 || Math.hypot(p[0] - o.points[i - 1][0], p[1] - o.points[i - 1][1]) > 1e-3);
    if (pts.length < 2) return;
    const col = new THREE.Color(o.color || '#9aa1a8');
    const matPost = new THREE.MeshStandardMaterial({ color: col, roughness: 0.6, metalness: o.style === 'rails' ? 0.1 : 0.7 });
    const matMesh = new THREE.MeshStandardMaterial({ map: TEX.chainlink.clone(), transparent: true, alphaTest: 0.4, side: THREE.DoubleSide, roughness: 0.5, metalness: 0.6, color: col });
    matMesh.map.needsUpdate = true;
    const postGeo = new THREE.CylinderGeometry(0.045, 0.05, 1, 8); postGeo.translate(0, 0.5, 0);
    const H = o.height;
    const post = (x, y, z) => { const m = new THREE.Mesh(postGeo, matPost); m.position.set(x, y, z); m.scale.y = H + 0.05; m.castShadow = true; g.add(m); };
    const panel = (x0, y0, z0, x1, y1, z1) => {
      const d = Math.hypot(x1 - x0, z1 - z0), dy = y1 - y0, len = Math.hypot(d, dy); if (d < 1e-3) return;
      const frame = new THREE.Group(); frame.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
      frame.rotation.y = Math.atan2(-(z1 - z0), x1 - x0);   // local x along the run
      const tilt = new THREE.Group(); tilt.rotation.z = Math.atan2(dy, d); frame.add(tilt);   // lift the far end
      if (o.style === 'rails') {
        for (const f of [0.22, 0.55, 0.88]) { const r = new THREE.Mesh(new THREE.BoxGeometry(len, 0.07, 0.035), matPost); r.position.y = H * f; r.castShadow = true; tilt.add(r); }
      } else {
        const pg = new THREE.PlaneGeometry(len, H); pg.translate(0, H / 2, 0);
        const uv = pg.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * len / 0.25, uv.getY(i) * H / 0.25);
        tilt.add(new THREE.Mesh(pg, matMesh));
        for (const y of [0.05, H]) { const r = new THREE.Mesh(new THREE.BoxGeometry(len, 0.03, 0.03), matPost); r.position.y = y; tilt.add(r); }
      }
      g.add(frame);
    };
    let prev = null;
    for (let i = 0; i < pts.length - 1; i++) {
      const [x0, z0] = pts[i], [x1, z1] = pts[i + 1], n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, z1 - z0) / (o.spacing || 3)));
      for (let k = 0; k <= n; k++) {
        if (k === n && i < pts.length - 2) break;   // the corner post belongs to the next run
        const x = x0 + (x1 - x0) * k / n, z = z0 + (z1 - z0) * k / n, y = this.sampleHeight(x, z) - 0.03;
        post(x, y, z);
        if (prev) panel(prev[0], prev[1], prev[2], x, y, z);
        prev = [x, y, z];
      }
    }
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
  // dir: +1 swings the leaf towards the door's local -z, -1 towards +z
  setDoor(id, open, dir = 1) { const d = this.doorState(id); if (d) { d.open = open; if (open) d.dir = dir; } }
  updateDoors(dt) {
    for (const [id, g] of this.meshes) {
      const d = g.userData.door; if (!d) continue;
      const target = d.open ? (d.dir || 1) * Math.PI / 2 : 0;
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
        const d = this.doorState(o.id); if (d && (d.open || Math.abs(d.angle) > 0.5)) continue;
        const c = Math.cos(o.rot || 0), s = Math.sin(o.rot || 0), hx = o.scale[0] / 2;
        out.push({ cx: o.pos[0] + c * hx, cz: o.pos[2] - s * hx, hx, hz: Math.max(0.12, o.scale[2] / 2), rot: o.rot || 0, top: o.pos[1] + o.scale[1], bottom: o.pos[1] });
      } else if (o.type === 'tree') {
        out.push({ cx: o.pos[0], cz: o.pos[2], hx: 0.3 * o.scale[0], hz: 0.3 * o.scale[2], rot: 0, top: o.pos[1] + 2, bottom: o.pos[1] });
      } else if (o.type === 'fence') {
        if (!o.solid) continue;
        const pts = o.points || [];
        for (let i = 0; i < pts.length - 1; i++) {
          const [x0, z0] = pts[i], [x1, z1] = pts[i + 1], len = Math.hypot(x1 - x0, z1 - z0); if (len < 1e-3) continue;
          const h0 = this.sampleHeight(x0, z0), h1 = this.sampleHeight(x1, z1);
          out.push({ cx: (x0 + x1) / 2, cz: (z0 + z1) / 2, hx: len / 2, hz: 0.06, rot: Math.atan2(-(z1 - z0), x1 - x0), top: Math.max(h0, h1) + o.height, bottom: Math.min(h0, h1) - 1 });
        }
      } else if (o.type === 'hollow') {
        if (!o.solid) continue;
        const H = this.meshes.get(o.id)?.userData.hollow; if (!H) continue;
        const r = o.rot || 0, c = Math.cos(r), s = Math.sin(r);
        for (const sg of H.segs) out.push({ cx: o.pos[0] + sg.cx * c + sg.cz * s, cz: o.pos[2] - sg.cx * s + sg.cz * c, hx: sg.hx, hz: sg.hz, rot: sg.rot + r, top: o.pos[1] + sg.top, bottom: o.pos[1] + sg.bottom });
      } else if (o.type === 'cylinder' && o.half && o.solid) {
        // the solid half sits on the -z side of the origin
        const r = o.rot || 0, lz = -o.scale[2] / 4;
        out.push({ cx: o.pos[0] + Math.sin(r) * lz, cz: o.pos[2] + Math.cos(r) * lz, hx: o.scale[0] / 2, hz: o.scale[2] / 4, rot: r, top: o.pos[1] + o.scale[1], bottom: o.pos[1] });
      } else if (o.solid && o.scale) {
        out.push({ cx: o.pos[0], cz: o.pos[2], hx: o.scale[0] / 2, hz: o.scale[2] / 2, rot: o.rot || 0, top: o.pos[1] + o.scale[1], bottom: o.pos[1] });
      }
    }
    return out;
  }
  // height of walkable surfaces (terrain + tops of low solids you can stand on + ramps)
  standHeight(x, z, feetY) {
    let h = this.sampleHeight(x, z);
    const stand = (top) => { if (top <= feetY + 0.55 && top > h) h = top; };
    for (const o of this.data.objects) {
      // world -> object local (rotation about Y by o.rot)
      const c = Math.cos(o.rot || 0), s = Math.sin(o.rot || 0);
      const dx = x - o.pos[0], dz = z - o.pos[2];
      const lx = dx * c - dz * s, lz = dx * s + dz * c;
      if (o.type === 'hollow') {
        const H = this.meshes.get(o.id)?.userData.hollow; if (!H) continue;
        for (const q of H.parts) {
          _v.set(lx, 0, lz).applyMatrix4(q.inv);
          if (!insideUnit(q.kind, _v.x, 0.5, _v.z)) continue;
          const bottom = o.pos[1] + q.p.pos[1];
          stand(bottom + H.t);            // the floor slab
          stand(bottom + q.p.scale[1]);   // the roof
        }
        continue;
      }
      if (!o.scale) continue;
      if (o.type === 'ramp') {
        if (Math.abs(lx) <= o.scale[0] / 2 && Math.abs(lz) <= o.scale[2] / 2) { const t = (lz + o.scale[2] / 2) / o.scale[2]; h = Math.max(h, o.pos[1] + t * o.scale[1]); }
      } else if (o.solid && (o.type === 'box' || o.type === 'wall' || o.type === 'cylinder')) {
        if (Math.abs(lx) <= o.scale[0] / 2 && Math.abs(lz) <= o.scale[2] / 2 && !(o.half && lz > 0)) stand(o.pos[1] + o.scale[1]);
      }
    }
    return h;
  }
}
