import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// =====================================================================
//  CONSTANTS / STATE
// =====================================================================
const T = 2;                 // tile size (metres)
const WALL_H = 3;            // wall height
const GX0 = -14;             // first grid column (tile x) — the entry wing lives at negative x
const W = 58, H = 30;        // building grid size in tiles
const SEC_H = 0.7;           // the security room floor is raised
const $ = (id) => document.getElementById(id);

const KEY_NAMES = { utility: 'Utility Room Key', gate: 'Yard Gate Key' };

const state = {
  powered: false,
  inventory: [],
  zoneOn: { office: false, mess: false, infirmary: false, utility: true, hall: true, block: true, yard: true, exterior: true, entry: true, security: true },
  figure: 'hidden',
  won: false,
  flashlight: true,
  stage: -1,            // -1 = not yet reported to security
  travelOpen: false,
  paused: false,
  motion: {},           // manual motion-test flags per room key
};
const cine = { phase: 'menu', t: 0 };   // menu -> closing -> black -> fadein -> play

// =====================================================================
//  MAP DATA  (grid: 0 = wall, 1 = floor). Anything outside the grid is open ground.
// =====================================================================
const grid = Array.from({ length: H }, () => new Array(W).fill(0));
const inGrid = (gx, gy) => gx >= GX0 && gx < GX0 + W && gy >= 0 && gy < H;
const cellAt = (gx, gy) => grid[gy][gx - GX0];
const setCell = (gx, gy, v) => { grid[gy][gx - GX0] = v; };
const carve = (x0, y0, x1, y1) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) setCell(x, y, 1); };

const rooms = {
  mantrap:   { rect: [-13, 9, -12, 10], label: 'Man Trap',   bulb: [-24, 20] },
  entry:     { rect: [-10, 9, -1, 10],  label: 'Entry Hall', bulb: [-12, 20] },
  security:  { rect: [-9, 5, -4, 7],    label: 'Security',   bulb: [-12, 13], raised: SEC_H },
  office:    { rect: [1, 1, 8, 7],      label: 'Office',     bulb: [10, 9] },
  mess:      { rect: [10, 1, 20, 7],    label: 'Mess Hall',  bulb: [31, 9] },
  infirmary: { rect: [22, 1, 30, 7],    label: 'Infirmary',  bulb: [53, 9] },
  yard:      { rect: [32, 1, 42, 7],    label: 'Yard',       bulb: [75, 9], outdoor: true },
  hall:      { rect: [1, 9, 42, 10],    label: 'Main Hall',  bulb: [44, 20] },
  utility:   { rect: [1, 12, 6, 17],    label: 'Utility',    bulb: [8, 30] },
  block:     { rect: [8, 12, 42, 13],   label: 'Cell Block A', bulb: [50, 26] },
};
for (const r of Object.values(rooms)) carve(...r.rect);
carve(0, 9, 0, 10);                       // entry hall flows straight into the main hall

const cells = [];
for (let i = 0; i < 8; i++) {
  const x0 = 9 + i * 4;
  cells.push({ rect: [x0, 15, x0 + 2, 18], door: [x0 + 1, 14], index: i + 1 });
  carve(x0, 15, x0 + 2, 18);
}

// v: door sits in a wall that runs north-south (hinge on the north edge). zOff shifts the panel along z.
const doorDefs = [
  { x: -14, y: 9,  name: 'Main Entrance', v: true, open: true, metal: true },
  { x: -4,  y: 8,  name: 'Security Room Door', zOff: 0.85 },
  { x: 5,   y: 8,  name: 'Office Door' },
  { x: 15,  y: 8,  name: 'Mess Hall Door' },
  { x: 26,  y: 8,  name: 'Infirmary Door' },
  { x: 37,  y: 8,  name: 'Yard Gate', bars: true, locked: true, keyId: 'gate' },
  { x: 37,  y: 0,  name: 'Perimeter Gate', bars: true },
  { x: 3,   y: 11, name: 'Utility Room Door', locked: true, keyId: 'utility' },
  { x: 12,  y: 11, name: 'Cell Block Gate', bars: true },
  { x: 40,  y: 11, name: 'Cell Block Gate', bars: true },
  ...cells.map(c => ({ x: c.door[0], y: c.door[1], name: `Cell ${c.index}`, bars: true, open: c.index === 8 })),
];
for (const d of doorDefs) setCell(d.x, d.y, 1);
const slidingDefs = [{ x: -11, y0: 9, y1: 10, name: 'Man Trap Door' }];
for (const s of slidingDefs) for (let y = s.y0; y <= s.y1; y++) setCell(s.x, y, 1);

const windowTiles = new Set(['-8,8', '-7,8', '-6,8']);     // glass between the security room and the entry hall
const isMetalWall = (gx, gy) => gx <= -11 && gy >= 8 && gy <= 11;  // the man trap is a steel box

const inRect = (gx, gy, [x0, y0, x1, y1]) => gx >= x0 && gx <= x1 && gy >= y0 && gy <= y1;
const tileOf = (v) => Math.floor(v / T);
const roomAtTile = (gx, gy) => Object.entries(rooms).find(([, r]) => inRect(gx, gy, r.rect))?.[0] ?? null;

// Exterior layout (world metres). The building occupies x -30..88, z 0..60.
const PERIM = { x0: -60, z0: -26, x1: 114, z1: 86, h: 5 };
const ROAD_Z = 9 * T + T / 2;
const colliders = [];

// =====================================================================
//  TERRAIN — flat inside the perimeter and along the road, hills beyond
// =====================================================================
const smoothstep = (a, b, x) => { const t = THREE.MathUtils.clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
function terrainH(x, z) {
  const m = 14;
  const fx = Math.max(PERIM.x0 - m - x, x - (PERIM.x1 + m), 0);
  const fz = Math.max(PERIM.z0 - m - z, z - (PERIM.z1 + m), 0);
  let d = Math.hypot(fx, fz);
  if (x < PERIM.x0) d = Math.min(d, Math.max(0, Math.abs(z - ROAD_Z) - 9));   // keep the road flat, hills rise beside it
  const ramp = smoothstep(0, 85, d);
  const n = 0.5 + 0.28 * Math.sin(x * 0.022 + z * 0.014) + 0.17 * Math.sin(x * 0.047 - z * 0.035 + 1.7)
          + 0.09 * Math.sin(x * 0.11 + z * 0.09 + 3.1) + 0.06 * Math.sin(x * 0.21 - z * 0.17 + 0.4);
  return ramp * (10 + 32 * Math.max(0, n));
}
function groundHeight(x, z) {
  const gx = tileOf(x), gz = tileOf(z);
  if (inGrid(gx, gz)) {
    if (inRect(gx, gz, rooms.security.rect)) return SEC_H;
    if (gx === -4 && gz === 8) return SEC_H * THREE.MathUtils.clamp((18 - z) / 2, 0, 1);   // ramp in the doorway
    return 0;
  }
  return terrainH(x, z);
}

// =====================================================================
//  RENDERER / SCENE
// =====================================================================
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x05070f);
scene.fog = new THREE.FogExp2(0x0a0f1c, 0.0045);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.08, 700);
scene.add(camera);

scene.add(new THREE.HemisphereLight(0x2f3c5c, 0x0c0f0c, 0.32));
const moonDir = new THREE.Vector3(-0.45, 0.7, -0.55).normalize();
const moonLight = new THREE.DirectionalLight(0x93a8dc, 0.6);
moonLight.position.copy(moonDir).multiplyScalar(60);
scene.add(moonLight);

// =====================================================================
//  PROCEDURAL TEXTURES
// =====================================================================
function makeTexture(size, draw, repeat = [1, 1]) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  draw(ctx, size);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.repeat.set(repeat[0], repeat[1]);
  t.anisotropy = 4;
  return t;
}
function canvasTexture(w, h, draw) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}
function speckle(ctx, size, n, alpha, px = 2) {
  for (let i = 0; i < n; i++) {
    const v = (Math.random() * 255) | 0;
    ctx.fillStyle = `rgba(${v},${v},${v},${alpha})`;
    ctx.fillRect(Math.random() * size, Math.random() * size, px, px);
  }
}
const texWall = makeTexture(256, (ctx, s) => {
  ctx.fillStyle = '#8d918c'; ctx.fillRect(0, 0, s, s);
  speckle(ctx, s, 6000, 0.18);
  ctx.strokeStyle = 'rgba(40,42,40,.55)'; ctx.lineWidth = 2;
  for (let y = 0; y <= s; y += s / 4) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(s, y); ctx.stroke(); }
  for (let row = 0; row < 4; row++) {
    const off = (row % 2) * (s / 4);
    for (let x = off; x <= s; x += s / 2) { ctx.beginPath(); ctx.moveTo(x, row * s / 4); ctx.lineTo(x, (row + 1) * s / 4); ctx.stroke(); }
  }
  const g = ctx.createLinearGradient(0, s * 0.72, 0, s);
  g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,.45)');
  ctx.fillStyle = g; ctx.fillRect(0, s * 0.72, s, s * 0.28);
  ctx.fillStyle = 'rgba(60,90,70,.55)'; ctx.fillRect(0, s * 0.62, s, s * 0.05);
});
const texSteel = makeTexture(256, (ctx, s) => {
  ctx.fillStyle = '#4b5057'; ctx.fillRect(0, 0, s, s);
  speckle(ctx, s, 5000, 0.1);
  ctx.strokeStyle = 'rgba(20,22,26,.8)'; ctx.lineWidth = 4;
  ctx.strokeRect(4, 4, s - 8, s - 8);
  ctx.fillStyle = '#7c838c';
  for (const [x, y] of [[14, 14], [s - 14, 14], [14, s - 14], [s - 14, s - 14], [s / 2, 14], [s / 2, s - 14], [14, s / 2], [s - 14, s / 2]]) { ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.fill(); }
  const g = ctx.createLinearGradient(0, 0, s, s); g.addColorStop(0, 'rgba(255,255,255,.08)'); g.addColorStop(1, 'rgba(0,0,0,.18)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, s, s);
});
const texConcrete = makeTexture(256, (ctx, s) => {
  ctx.fillStyle = '#767a78'; ctx.fillRect(0, 0, s, s);
  speckle(ctx, s, 9000, 0.16, 3);
  ctx.strokeStyle = 'rgba(30,32,30,.5)'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(s / 2, 0); ctx.lineTo(s / 2, s); ctx.stroke();
}, [8, 1]);
const texFloor = makeTexture(256, (ctx, s) => {
  ctx.fillStyle = '#5c5f61'; ctx.fillRect(0, 0, s, s);
  speckle(ctx, s, 8000, 0.14);
  ctx.strokeStyle = 'rgba(25,26,28,.7)'; ctx.lineWidth = 3;
  for (let i = 0; i <= s; i += s / 2) {
    ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, s); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(s, i); ctx.stroke();
  }
}, [W, H]);
const texCeil = makeTexture(256, (ctx, s) => {
  ctx.fillStyle = '#a3a39c'; ctx.fillRect(0, 0, s, s);
  speckle(ctx, s, 5000, 0.1);
  ctx.strokeStyle = 'rgba(50,50,48,.6)'; ctx.lineWidth = 4;
  ctx.strokeRect(0, 0, s, s);
}, [W, H]);
const texGrass = makeTexture(256, (ctx, s) => {
  ctx.fillStyle = '#2f3d2a'; ctx.fillRect(0, 0, s, s);
  for (let i = 0; i < 9000; i++) {
    const v = 30 + Math.random() * 50;
    ctx.fillStyle = `rgba(${v * 0.7},${v},${v * 0.55},.35)`;
    ctx.fillRect(Math.random() * s, Math.random() * s, 2, 4);
  }
}, [180, 180]);
const texAsphalt = makeTexture(256, (ctx, s) => {
  ctx.fillStyle = '#2b2d30'; ctx.fillRect(0, 0, s, s);
  speckle(ctx, s, 7000, 0.12);
  ctx.fillStyle = '#b9b28a'; ctx.fillRect(0, s / 2 - 3, s * 0.6, 6);
}, [40, 1]);
const texCarpet = makeTexture(128, (ctx, s) => { ctx.fillStyle = '#2c3340'; ctx.fillRect(0, 0, s, s); speckle(ctx, s, 2500, 0.12, 1); }, [6, 3]);

const matWall = new THREE.MeshStandardMaterial({ map: texWall, roughness: 0.95 });
const matSteelWall = new THREE.MeshStandardMaterial({ map: texSteel, roughness: 0.55, metalness: 0.7 });
const matConcrete = new THREE.MeshStandardMaterial({ map: texConcrete, roughness: 0.95 });
const matFloor = new THREE.MeshStandardMaterial({ map: texFloor, roughness: 0.85 });
const matCeil = new THREE.MeshStandardMaterial({ map: texCeil, roughness: 1 });
const matRoof = new THREE.MeshStandardMaterial({ color: 0x2a2d31, roughness: 1 });
const matMetal = new THREE.MeshStandardMaterial({ color: 0x5b6068, roughness: 0.5, metalness: 0.8 });
const matBars = new THREE.MeshStandardMaterial({ color: 0x3a3d42, roughness: 0.45, metalness: 0.9 });
const matDoor = new THREE.MeshStandardMaterial({ color: 0x4a5560, roughness: 0.7, metalness: 0.4 });
const matWood = new THREE.MeshStandardMaterial({ color: 0x5a4330, roughness: 0.9 });
const matGold = new THREE.MeshStandardMaterial({ color: 0xd4a935, roughness: 0.3, metalness: 1, emissive: 0x553300, emissiveIntensity: 0.4 });
const matTree = new THREE.MeshStandardMaterial({ color: 0x17301c, roughness: 1 });
const matTrunk = new THREE.MeshStandardMaterial({ color: 0x3a2a1c, roughness: 1 });
const matGlass = new THREE.MeshStandardMaterial({ color: 0x9fc4d8, roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.28, side: THREE.DoubleSide });
const matCarpet = new THREE.MeshStandardMaterial({ map: texCarpet, roughness: 1 });

// =====================================================================
//  BUILDING: walls, windows, floor, ceiling, roof
// =====================================================================
const blockers = [];   // meshes that stop the interaction raycast (walls, glass)
{
  const geos = [], steelGeos = [];
  const hasFloorNeighbour = (x, y) => {
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx, ny = y + dy;
      if (inGrid(nx, ny) && cellAt(nx, ny) === 1) return true;
    }
    return false;
  };
  for (let y = 0; y < H; y++) for (let x = GX0; x < GX0 + W; x++) {
    if (cellAt(x, y) !== 0 || !hasFloorNeighbour(x, y)) continue;
    const cx = x * T + T / 2, cz = y * T + T / 2;
    if (windowTiles.has(`${x},${y}`)) {
      const lo = new THREE.BoxGeometry(T, 1.15, T); lo.translate(cx, 0.575, cz); geos.push(lo);
      const hi = new THREE.BoxGeometry(T, 0.4, T); hi.translate(cx, 2.8, cz); geos.push(hi);
      const glass = new THREE.Mesh(new THREE.BoxGeometry(T, 1.45, 0.06), matGlass);
      glass.position.set(cx, 1.875, cz); scene.add(glass); blockers.push(glass);
      const frame = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.45, 0.12), matMetal); frame.position.set(x * T, 1.875, cz); scene.add(frame);
      const sill = new THREE.Mesh(new THREE.BoxGeometry(T, 0.08, 0.5), matMetal); sill.position.set(cx, 1.16, cz); scene.add(sill);
      const top = new THREE.Mesh(new THREE.BoxGeometry(T, 0.08, 0.5), matMetal); top.position.set(cx, 2.58, cz); scene.add(top);
      continue;
    }
    const g = new THREE.BoxGeometry(T, WALL_H, T);
    g.translate(cx, WALL_H / 2, cz);
    (isMetalWall(x, y) ? steelGeos : geos).push(g);
  }
  for (const [gs, mat] of [[geos, matWall], [steelGeos, matSteelWall]]) {
    const m = new THREE.Mesh(mergeGeometries(gs), mat);
    m.castShadow = m.receiveShadow = true;
    scene.add(m); blockers.push(m);
  }
}
{
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(W * T, H * T), matFloor);
  floor.rotation.x = -Math.PI / 2;
  floor.position.set((GX0 + W / 2) * T, 0, H * T / 2);
  floor.receiveShadow = true;
  scene.add(floor);

  const addCeil = (x0, z0, x1, z1) => {
    const c = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, z1 - z0), matCeil);
    c.rotation.x = Math.PI / 2;
    c.position.set((x0 + x1) / 2, WALL_H, (z0 + z1) / 2);
    scene.add(c);
    const r = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, z1 - z0), matRoof);
    r.rotation.x = -Math.PI / 2;
    r.position.set((x0 + x1) / 2, WALL_H + 0.02, (z0 + z1) / 2);
    scene.add(r);
  };
  const yr = rooms.yard.rect;
  addCeil(GX0 * T, 0, yr[0] * T, H * T);
  addCeil(yr[0] * T, (yr[3] + 1) * T, (GX0 + W) * T, H * T);

  const yardMat = new THREE.MeshStandardMaterial({ map: texGrass.clone(), roughness: 1 });
  yardMat.map.repeat.set(11, 7); yardMat.map.needsUpdate = true;
  const yard = new THREE.Mesh(new THREE.PlaneGeometry((yr[2] - yr[0] + 1) * T, (yr[3] - yr[1] + 1) * T), yardMat);
  yard.rotation.x = -Math.PI / 2;
  yard.position.set((yr[0] + yr[2] + 1) / 2 * T, 0.02, (yr[1] + yr[3] + 1) / 2 * T);
  yard.receiveShadow = true;
  scene.add(yard);

  // raised security room floor + ramp in its doorway
  const sr = rooms.security.rect;
  const sf = new THREE.Mesh(new THREE.PlaneGeometry((sr[2] - sr[0] + 1) * T, (sr[3] - sr[1] + 1) * T), matCarpet);
  sf.rotation.x = -Math.PI / 2; sf.position.set((sr[0] + sr[2] + 1) / 2 * T, SEC_H, (sr[1] + sr[3] + 1) / 2 * T); sf.receiveShadow = true; scene.add(sf);
  const rampLen = Math.hypot(T, SEC_H);
  const ramp = new THREE.Mesh(new THREE.PlaneGeometry(T, rampLen), matCarpet);
  ramp.rotation.x = -Math.PI / 2 + Math.atan2(SEC_H, T);
  ramp.position.set(-4 * T + T / 2, SEC_H / 2, 8 * T + T / 2); ramp.receiveShadow = true; scene.add(ramp);
}

// =====================================================================
//  HELPERS: props, signs, lights
// =====================================================================
const interactables = [];
function box(w, h, d, mat, x, y, z, ry = 0, solid = false) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z); m.rotation.y = ry;
  m.castShadow = m.receiveShadow = true;
  scene.add(m);
  if (solid) colliders.push({ x0: x - w / 2, x1: x + w / 2, z0: z - d / 2, z1: z + d / 2 });
  return m;
}
function sign(text, x, y, z, ry = 0, width = 2.2) {
  const tex = canvasTexture(512, 128, (ctx) => {
    ctx.fillStyle = '#1b1f1d'; ctx.fillRect(0, 0, 512, 128);
    ctx.strokeStyle = '#c9cfc4'; ctx.lineWidth = 6; ctx.strokeRect(6, 6, 500, 116);
    ctx.fillStyle = '#e9eee4'; ctx.font = 'bold 58px Courier New'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(text, 256, 68);
  });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(width, width / 4), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.25 }));
  m.position.set(x, y, z); m.rotation.y = ry;
  scene.add(m);
  return m;
}
function poster(tex, w, h, x, y, z, ry = 0, emissive = 0) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9, emissive: emissive ? 0xffffff : 0x000000, emissiveMap: emissive ? tex : null, emissiveIntensity: emissive }));
  m.position.set(x, y, z); m.rotation.y = ry;
  scene.add(m);
  return m;
}

const lamps = [];
function addLamp(x, z, zone, { color = 0xfff1d6, intensity = 22, distance = 16, flicker = false, y = WALL_H - 0.12, fixture = true, alwaysOn = false } = {}) {
  const light = new THREE.PointLight(color, 0, distance, 2);
  light.position.set(x, y, z);
  scene.add(light);
  let fixMat = null;
  if (fixture) {
    fixMat = new THREE.MeshStandardMaterial({ color: 0xdddddd, emissive: color, emissiveIntensity: 0 });
    const f = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.12, 0.35), fixMat);
    f.position.set(x, WALL_H - 0.06, z);
    scene.add(f);
  }
  lamps.push({ light, fixMat, zone, intensity, flicker, alwaysOn, seed: Math.random() * 100 });
}
function updateLights() {
  for (const l of lamps) {
    const on = l.alwaysOn || (state.powered && state.zoneOn[l.zone]);
    l.light.intensity = on ? l.intensity : 0;
    if (l.fixMat) l.fixMat.emissiveIntensity = on ? 2.2 : 0;
  }
  $('powerState').textContent = state.powered ? 'ON' : 'OFF';
}
function floodlight(x, z, zone, opts = {}) {
  box(0.15, 5.5, 0.15, matMetal, x, 2.75, z);
  box(0.7, 0.25, 0.4, matMetal, x, 5.4, z);
  addLamp(x, z, zone, { color: 0xbfd4ff, intensity: 40, distance: 26, y: 5.2, fixture: false, ...opts });
}

// entry wing runs on its own circuit: always lit
addLamp(-24, 20, 'entry', { color: 0xffc9a0, intensity: 9, distance: 8, alwaysOn: true });
for (const x of [-18, -10, -2]) addLamp(x, 20, 'entry', { color: 0xfdf6e3, intensity: 30, alwaysOn: true });
addLamp(-12, 13, 'security', { color: 0xeef3ff, intensity: 18, alwaysOn: true });
// main building
for (const x of [6, 14, 22, 30, 38]) addLamp(x * T, 10 * T, 'hall', { flicker: x === 22 });
for (const x of [10, 18, 26, 34, 41]) addLamp(x * T, 13 * T, 'block', { color: 0xe8f0ff });
addLamp(5 * T, 4.5 * T, 'office');
addLamp(13 * T, 4.5 * T, 'mess'); addLamp(18 * T, 4.5 * T, 'mess');
addLamp(26.5 * T, 4.5 * T, 'infirmary', { color: 0xe0ffe8 });
addLamp(4 * T, 15 * T, 'utility', { color: 0xffd29a, intensity: 12, flicker: true });
for (const [x, z] of [[34 * T, 2 * T], [41 * T, 2 * T], [37.5 * T, 6 * T]]) floodlight(x, z, 'yard');

// =====================================================================
//  DOORS (hinged) + SLIDING DOORS
// =====================================================================
const doors = [];
function makeDoor(def) {
  const group = new THREE.Group();
  const base = def.v ? -Math.PI / 2 : 0;
  if (def.v) group.position.set(def.x * T + T / 2, 0, def.y * T);
  else group.position.set(def.x * T, 0, def.y * T + T / 2 + (def.zOff || 0));
  const parts = [];
  if (def.bars) {
    const n = 6;
    for (let i = 0; i < n; i++) {
      const b = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 2.62, 8), matBars);
      b.position.set(0.12 + i * ((T - 0.24) / (n - 1)), 1.31, 0);
      parts.push(b);
    }
    for (const yy of [0.25, 1.3, 2.5]) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(T - 0.1, 0.08, 0.08), matBars);
      b.position.set(T / 2, yy, 0);
      parts.push(b);
    }
    const hit = new THREE.Mesh(new THREE.BoxGeometry(T - 0.1, 2.6, 0.2), new THREE.MeshBasicMaterial({ visible: false }));
    hit.position.set(T / 2, 1.3, 0);
    parts.push(hit);
  } else {
    const panel = new THREE.Mesh(new THREE.BoxGeometry(T - 0.12, 2.6, 0.12), def.metal ? matSteelWall : matDoor);
    panel.position.set(T / 2, 1.3, 0);
    parts.push(panel);
    if (!def.metal) {
      const win = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.6, 0.14), new THREE.MeshStandardMaterial({ color: 0x99bbcc, roughness: 0.1, metalness: 0.2, transparent: true, opacity: 0.55 }));
      win.position.set(T / 2, 1.75, 0);
      parts.push(win);
    }
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.05, 0.2), matMetal);
    handle.position.set(T - 0.35, 1.1, 0);
    parts.push(handle);
  }
  const door = { def, group, open: !!def.open, locked: !!def.locked, keyId: def.keyId, base, targetRot: base + (def.open ? -Math.PI / 2 : 0), tiles: [[def.x, def.y]] };
  for (const p of parts) { p.castShadow = true; p.userData.entity = door; group.add(p); interactables.push(p); }
  group.rotation.y = door.targetRot;
  scene.add(group);
  const lintel = box(T, WALL_H - 2.62, 0.5, def.metal ? matSteelWall : matWall, def.x * T + T / 2, 2.81, def.y * T + T / 2);
  if (def.v) lintel.rotation.y = Math.PI / 2;

  door.blocks = () => !door.open;
  door.prompt = () => {
    if (door.locked) return state.inventory.includes(door.keyId) ? `Unlock ${def.name}` : `${def.name} (locked)`;
    return `${door.open ? 'Close' : 'Open'} ${def.name}`;
  };
  door.setOpen = (open) => { door.open = open; door.targetRot = base + (open ? -Math.PI / 2 : 0); };
  door.interact = () => {
    if (door.locked) {
      if (state.inventory.includes(door.keyId)) {
        door.locked = false;
        message(`Unlocked the ${def.name} with the ${KEY_NAMES[door.keyId]}.`);
        sfx('unlock');
      } else {
        message(`Locked. You need the ${KEY_NAMES[door.keyId]}.`);
        sfx('locked');
        return;
      }
    }
    door.setOpen(!door.open);
    sfx(def.bars ? 'bars' : 'door');
    onDoorToggled(door);
  };
  door.update = (dt) => { group.rotation.y += (door.targetRot - group.rotation.y) * Math.min(1, dt * 9); };
  doors.push(door);
  return door;
}
function makeSlidingDoor(def) {
  const len = (def.y1 - def.y0 + 1) * T;
  const cx = def.x * T + T / 2, cz = (def.y0 * T + (def.y1 + 1) * T) / 2;
  const panel = new THREE.Mesh(new THREE.BoxGeometry(0.22, 2.75, len - 0.1), matSteelWall);
  panel.position.set(cx, 1.375, cz);
  panel.castShadow = panel.receiveShadow = true;
  scene.add(panel);
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.18, len - 0.1), new THREE.MeshStandardMaterial({ color: 0xd8b23a, roughness: 0.6 }));
  stripe.position.set(cx, 1.0, cz); scene.add(stripe);
  // frame
  box(0.5, 0.35, len + 0.6, matSteelWall, cx, 2.9, cz);
  box(0.5, 3, 0.3, matSteelWall, cx, 1.5, def.y0 * T - 0.15); box(0.5, 3, 0.3, matSteelWall, cx, 1.5, (def.y1 + 1) * T + 0.15);
  const door = { def, open: false, progress: 0, tiles: [] };
  for (let y = def.y0; y <= def.y1; y++) door.tiles.push([def.x, y]);
  panel.userData.entity = door; stripe.userData.entity = door; interactables.push(panel, stripe);
  door.blocks = () => door.progress < 0.75;
  door.prompt = () => `${door.open ? 'Close' : 'Open'} ${def.name}`;
  door.setOpen = (open) => { if (door.open === open) return; door.open = open; sfx('slide'); };
  door.interact = () => { door.setOpen(!door.open); };
  door.update = (dt) => {
    const target = door.open ? 1 : 0;
    door.progress += Math.sign(target - door.progress) * Math.min(Math.abs(target - door.progress), dt / 2.2);
    panel.position.y = 1.375 + door.progress * 2.7;
    stripe.position.y = 1.0 + door.progress * 2.7;
  };
  doors.push(door);
  return door;
}
doorDefs.forEach(makeDoor);
slidingDefs.forEach(makeSlidingDoor);
const doorByName = (n) => doors.find(d => d.def.name === n);
const doorAt = (gx, gy) => doors.find(d => d.tiles.some(([x, y]) => x === gx && y === gy));

// =====================================================================
//  KEYS / SWITCHES / BREAKER / BUTTONS
// =====================================================================
const keys = [];
function makeKey(id, x, y, z, visible = true) {
  const g = new THREE.Group();
  const head = new THREE.Mesh(new THREE.TorusGeometry(0.09, 0.03, 8, 16), matGold);
  const shaft = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.035, 0.035), matGold);
  shaft.position.x = 0.2;
  const tooth1 = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.07, 0.035), matGold); tooth1.position.set(0.3, -0.045, 0);
  const tooth2 = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.05, 0.035), matGold); tooth2.position.set(0.22, -0.035, 0);
  const hit = new THREE.Mesh(new THREE.SphereGeometry(0.35), new THREE.MeshBasicMaterial({ visible: false }));
  const key = { id, group: g, taken: false };
  const parts = [head, shaft, tooth1, tooth2, hit];
  for (const p of parts) { p.castShadow = true; p.userData.entity = key; g.add(p); }
  g.position.set(x, y, z);
  g.rotation.x = Math.PI / 2;
  g.visible = visible;
  scene.add(g);
  key.reveal = () => { if (g.visible) return; g.visible = true; interactables.push(...parts); };
  if (visible) interactables.push(...parts);
  key.prompt = () => `Pick up ${KEY_NAMES[id]}`;
  key.interact = () => {
    if (key.taken) return;
    key.taken = true;
    g.visible = false;
    for (const p of parts) { const i = interactables.indexOf(p); if (i >= 0) interactables.splice(i, 1); }
    state.inventory.push(id);
    renderInventory();
    message(`Picked up the ${KEY_NAMES[id]}.`);
    sfx('pickup');
    onKeyPicked(id);
  };
  keys.push(key);
  return key;
}

function makeSwitch(zone, label, x, y, z, ry = 0) {
  const plate = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.28, 0.04), new THREE.MeshStandardMaterial({ color: 0xe8e4d8, roughness: 0.6 }));
  const toggle = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.1, 0.05), new THREE.MeshStandardMaterial({ color: 0x222222 }));
  toggle.position.set(0, 0, 0.035);
  const hit = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.6, 0.2), new THREE.MeshBasicMaterial({ visible: false }));
  const group = new THREE.Group();
  group.position.set(x, y, z); group.rotation.y = ry;
  const sw = { zone };
  for (const p of [plate, toggle, hit]) { p.userData.entity = sw; group.add(p); interactables.push(p); }
  scene.add(group);
  const refresh = () => { toggle.position.y = state.zoneOn[zone] ? 0.06 : -0.06; };
  refresh();
  sw.prompt = () => `${label} light switch (${state.zoneOn[zone] ? 'on' : 'off'})`;
  sw.interact = () => {
    state.zoneOn[zone] = !state.zoneOn[zone];
    refresh();
    sfx('click');
    if (!state.powered) message('Click. Nothing happens — the power is out.');
    updateLights();
  };
  return sw;
}

function makeBreaker(x, y, z, ry = 0) {
  const group = new THREE.Group();
  group.position.set(x, y, z); group.rotation.y = ry;
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.0, 0.22), new THREE.MeshStandardMaterial({ color: 0x77808a, roughness: 0.5, metalness: 0.6 }));
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.12, 0.23), new THREE.MeshStandardMaterial({ color: 0xd8b23a }));
  stripe.position.y = 0.4;
  const lever = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.38, 0.1), new THREE.MeshStandardMaterial({ color: 0xb83a2a, roughness: 0.4 }));
  lever.position.set(0, -0.15, 0.16);
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.04), new THREE.MeshStandardMaterial({ color: 0x220000, emissive: 0xff2200, emissiveIntensity: 0 }));
  lamp.position.set(0.22, 0.15, 0.13);
  const breaker = {};
  for (const p of [body, stripe, lever, lamp]) { p.userData.entity = breaker; group.add(p); interactables.push(p); }
  scene.add(group);
  breaker.prompt = () => state.powered ? 'Main breaker (ON)' : 'Reset main breaker';
  breaker.interact = () => {
    if (state.powered) { message('The breaker is already on.'); return; }
    state.powered = true;
    lever.position.y = 0.15;
    lamp.material.emissiveIntensity = 3;
    sfx('breaker');
    updateLights();
    onPowerRestored();
  };
  return breaker;
}

// small physical push-button with a label plate above it
function makeButton(label, x, y, z, ry, onPress, promptFn) {
  const group = new THREE.Group(); group.position.set(x, y, z); group.rotation.y = ry;
  const base = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.22, 0.06), matMetal);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.05, 16), new THREE.MeshStandardMaterial({ color: 0xb83a2a, roughness: 0.4, emissive: 0x330000, emissiveIntensity: 0.4 }));
  cap.rotation.x = Math.PI / 2; cap.position.z = 0.05;
  const plate = poster(canvasTexture(256, 96, (ctx) => {
    ctx.fillStyle = '#e8e4d8'; ctx.fillRect(0, 0, 256, 96);
    ctx.fillStyle = '#111'; ctx.font = 'bold 40px Courier New'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(label.toUpperCase(), 128, 50);
  }), 0.3, 0.11, 0, 0.2, 0.0);
  scene.remove(plate); group.add(plate);
  const hit = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.42, 0.2), new THREE.MeshBasicMaterial({ visible: false }));
  hit.position.y = 0.08;
  const btn = { cap };
  for (const p of [base, cap, hit]) { p.userData.entity = btn; group.add(p); interactables.push(p); }
  scene.add(group);
  btn.prompt = promptFn;
  btn.interact = () => { sfx('click'); onPress(); };
  return btn;
}

// =====================================================================
//  INTERIOR DRESSING — main building
// =====================================================================
{
  // --- Guard office
  box(2.4, 0.08, 1.2, matWood, 6, 0.78, 4);
  box(0.12, 0.78, 1.1, matWood, 4.9, 0.39, 4); box(0.12, 0.78, 1.1, matWood, 7.1, 0.39, 4);
  box(0.6, 0.4, 0.08, new THREE.MeshStandardMaterial({ color: 0x111418, emissive: 0x2a4a66, emissiveIntensity: 0.8 }), 6.6, 1.05, 3.7, 0.2);
  box(0.9, 0.9, 0.9, matWood, 6, 0.45, 5.4);
  for (let i = 0; i < 3; i++) box(0.8, 1.6, 0.6, matMetal, 2.6 + i * 0.9, 0.8, 2.4);
  box(2.2, 1.4, 0.3, matMetal, 12, 2.0, 2.2);
  box(1.2, 2.0, 0.5, matMetal, 16.5, 1.0, 4);
  makeKey('utility', 5.6, 0.86, 4.1);
  makeSwitch('office', 'Office', 6 * T + 1, 1.3, 8 * T - 0.03);
  sign('GUARD OFFICE', 5 * T + 1, 2.78, 9 * T + 0.02);
  sign('MESS HALL', 15 * T + 1, 2.78, 9 * T + 0.02);
  sign('INFIRMARY', 26 * T + 1, 2.78, 9 * T + 0.02);
  sign('YARD', 37 * T + 1, 2.78, 9 * T + 0.02);
  sign('UTILITY', 3 * T + 1, 2.78, 11 * T - 0.02, Math.PI);
  sign('CELL BLOCK A', 12 * T + 1, 2.78, 11 * T - 0.02, Math.PI);
  sign('CELL BLOCK A', 40 * T + 1, 2.78, 11 * T - 0.02, Math.PI);
  sign('PERIMETER', 37 * T + 1, 2.78, 1 * T + 0.02, 0);
  sign('SECURITY', -4 * T + 1, 2.78, 9 * T + 0.02);
  sign('MAIN HALL', 1 * T + 0.02, 2.78, 8 * T - 1, Math.PI / 2, 1.6);
  sign('EXIT', -11 * T + 0.02, 2.78, 8 * T - 1, Math.PI / 2, 1.4);

  // --- Mess hall
  for (let r = 0; r < 2; r++) for (let c = 0; c < 3; c++) {
    const x = 24 + c * 6, z = 5 + r * 6;
    box(3.2, 0.08, 1.0, matWood, x, 0.78, z);
    box(0.1, 0.78, 0.9, matMetal, x - 1.4, 0.39, z); box(0.1, 0.78, 0.9, matMetal, x + 1.4, 0.39, z);
    box(3.2, 0.06, 0.35, matWood, x, 0.45, z - 0.8); box(3.2, 0.06, 0.35, matWood, x, 0.45, z + 0.8);
  }
  box(4, 1.0, 0.8, matMetal, 31, 0.5, 2.6);
  makeSwitch('mess', 'Mess hall', 16 * T + 1, 1.3, 8 * T - 0.03);

  // --- Infirmary
  for (let i = 0; i < 3; i++) {
    const x = 47 + i * 4;
    box(1.0, 0.5, 2.0, matMetal, x, 0.25, 4);
    box(1.0, 0.15, 2.0, new THREE.MeshStandardMaterial({ color: 0xd8dfe4, roughness: 1 }), x, 0.57, 4);
    box(0.5, 0.12, 0.4, new THREE.MeshStandardMaterial({ color: 0xffffff }), x, 0.7, 3.2);
  }
  box(2.0, 1.8, 0.5, new THREE.MeshStandardMaterial({ color: 0xe8e8e8, roughness: 0.7 }), 58, 0.9, 2.6);
  makeSwitch('infirmary', 'Infirmary', 27 * T + 1, 1.3, 8 * T - 0.03);

  // --- Utility room
  makeBreaker(1 * T + 0.12, 1.5, 15 * T, Math.PI / 2);
  const boiler = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, 2.4, 20), matMetal);
  boiler.position.set(10, 1.2, 26.5); boiler.castShadow = true; scene.add(boiler);
  for (let i = 0; i < 3; i++) {
    const p = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 10, 8), matMetal);
    p.rotation.z = Math.PI / 2; p.position.set(7, 2.4 + i * 0.2, 25 + i * 0.5); scene.add(p);
  }

  // --- Cells
  for (const c of cells) {
    const [x0, , , y1] = c.rect;
    box(0.9, 0.35, 1.9, matMetal, x0 * T + 0.55, 0.45, (y1 + 1) * T - 1.1);
    box(0.9, 0.12, 1.9, new THREE.MeshStandardMaterial({ color: 0x8c8f86, roughness: 1 }), x0 * T + 0.55, 0.68, (y1 + 1) * T - 1.1);
    const toilet = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.2, 0.45, 12), new THREE.MeshStandardMaterial({ color: 0xdddddd, roughness: 0.3 }));
    toilet.position.set((x0 + 3) * T - 0.45, 0.22, (y1 + 1) * T - 0.5); scene.add(toilet);
  }
  makeKey('gate', 77.2, 0.12, 34.2, false);

  // --- Hall
  box(2.0, 0.45, 0.5, matWood, 20 * T, 0.22, 9 * T + 0.35);
  box(2.0, 0.45, 0.5, matWood, 34 * T, 0.22, 9 * T + 0.35);
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 1.0, 14), new THREE.MeshStandardMaterial({ color: 0x6e3b2a, roughness: 0.8 }));
  barrel.position.set(9 * T - 0.8, 0.5, 13 * T + 0.5); barrel.castShadow = true; scene.add(barrel);

  // --- Man trap + entry hall dressing
  box(0.5, 1.2, 0.06, new THREE.MeshStandardMaterial({ color: 0x222, roughness: 0.3 }), -22.2, 1.5, 18.06, 0);   // intercom panel
  poster(canvasTexture(256, 128, (ctx) => { ctx.fillStyle = '#c9352b'; ctx.fillRect(0, 0, 256, 128); ctx.fillStyle = '#fff'; ctx.font = 'bold 34px Courier New'; ctx.textAlign = 'center'; ctx.fillText('WAIT FOR', 128, 52); ctx.fillText('GREEN LIGHT', 128, 96); }), 0.8, 0.4, -25.0, 2.25, 18.04, 0);
  poster(canvasTexture(512, 256, (ctx) => {
    ctx.fillStyle = '#e9e4d2'; ctx.fillRect(0, 0, 512, 256);
    ctx.fillStyle = '#1a1a1a'; ctx.font = 'bold 44px Courier New'; ctx.textAlign = 'center'; ctx.fillText('NOTICE', 256, 60);
    ctx.font = '22px Courier New'; ['All staff must sign in at', 'SECURITY before shift.', 'Radio check: channel 3.', 'No phones past this point.'].forEach((l, i) => ctx.fillText(l, 256, 112 + i * 32));
  }), 1.2, 0.6, -14, 1.8, 18.03);
  for (let i = 0; i < 4; i++) box(0.4, 1.9, 0.5, matMetal, -9 + i * 0.5, 0.95, 21.7);  // lockers along the south wall
  box(1.2, 0.45, 0.5, matWood, -3.5, 0.22, 21.7);
}

// =====================================================================
//  SECURITY ROOM — desks, monitors, cork boards, motion map
// =====================================================================
const motionRooms = Object.entries(rooms).map(([key, r]) => ({ key, label: r.label, x: r.bulb[0], z: r.bulb[1] }));
motionRooms.push({ key: 'cells', label: 'Cells', x: 50, z: 34 });
const bulbs = {};
{
  const f = SEC_H;
  // desks under the window (south wall, z=16)
  for (const dx of [-14.6, -9.6]) {
    box(3.4, 0.08, 1.0, new THREE.MeshStandardMaterial({ color: 0x8a8f96, roughness: 0.7 }), dx, f + 0.78, 15.1);
    box(0.1, 0.78, 0.9, matMetal, dx - 1.6, f + 0.39, 15.1); box(0.1, 0.78, 0.9, matMetal, dx + 1.6, f + 0.39, 15.1);
    box(0.7, 0.7, 0.7, new THREE.MeshStandardMaterial({ color: 0x23262b, roughness: 0.8 }), dx, f + 0.35, 14.0);  // chair
    box(0.7, 0.8, 0.1, new THREE.MeshStandardMaterial({ color: 0x23262b, roughness: 0.8 }), dx, f + 1.0, 13.65);
  }
  // CCTV monitor wall: 6 screens
  const cctv = canvasTexture(512, 384, (ctx) => {
    ctx.fillStyle = '#0b1116'; ctx.fillRect(0, 0, 512, 384);
    const cams = ['CAM 01  HALL W', 'CAM 02  HALL E', 'CAM 03  BLOCK A', 'CAM 04  YARD', 'CAM 05  MESS', 'CAM 06  GATE'];
    cams.forEach((c, i) => {
      const x = (i % 3) * 170 + 6, y = Math.floor(i / 3) * 190 + 6;
      ctx.fillStyle = i === 2 ? '#1d2a1f' : '#18202a'; ctx.fillRect(x, y, 160, 178);
      for (let k = 0; k < 400; k++) { ctx.fillStyle = `rgba(255,255,255,${Math.random() * 0.08})`; ctx.fillRect(x + Math.random() * 160, y + Math.random() * 178, 2, 2); }
      ctx.fillStyle = '#9fd1a5'; ctx.font = '15px Courier New'; ctx.textAlign = 'left'; ctx.fillText(c, x + 6, y + 20);
      ctx.fillStyle = '#e0513f'; ctx.beginPath(); ctx.arc(x + 148, y + 15, 4, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#7f8a93'; ctx.fillText(i === 5 ? 'NO SIGNAL' : '23:' + String(41 + i).padStart(2, '0'), x + 6, y + 168);
    });
  });
  for (let i = 0; i < 3; i++) {
    const m = poster(cctv, 0.9, 0.68, -16.1 + i * 1.05, f + 1.25, 15.45, Math.PI, 1.1);
    box(0.95, 0.73, 0.06, new THREE.MeshStandardMaterial({ color: 0x111418 }), -16.1 + i * 1.05, f + 1.25, 15.5);
    box(0.3, 0.35, 0.15, matMetal, -16.1 + i * 1.05, f + 0.98, 15.4);
    m.position.z = 15.46;
  }
  // the computer — master test toggle
  const screen = canvasTexture(512, 320, (ctx) => {
    ctx.fillStyle = '#061018'; ctx.fillRect(0, 0, 512, 320);
    ctx.fillStyle = '#58d38a'; ctx.font = '20px Courier New'; ctx.textAlign = 'left';
    ['NIGHT SHIFT CONTROL  v0.3', '', '> motion grid ........ ONLINE', '> cameras ............ 5/6', '> main power ......... FAULT', '> man trap ........... LOCKED', '', '[F] TOGGLE MOTION TEST (ALL)', '_'].forEach((l, i) => ctx.fillText(l, 18, 36 + i * 30));
  });
  const pc = poster(screen, 0.9, 0.56, -9.6, f + 1.2, 15.4, Math.PI, 1.2);
  box(0.95, 0.62, 0.06, new THREE.MeshStandardMaterial({ color: 0x111418 }), -9.6, f + 1.2, 15.46);
  box(0.3, 0.3, 0.15, matMetal, -9.6, f + 0.95, 15.35);
  box(0.9, 0.03, 0.3, new THREE.MeshStandardMaterial({ color: 0x1c1f24 }), -9.6, f + 0.835, 14.75);   // keyboard
  box(0.12, 0.03, 0.18, new THREE.MeshStandardMaterial({ color: 0x1c1f24 }), -8.9, f + 0.835, 14.75);  // mouse
  box(0.45, 1.0, 0.5, new THREE.MeshStandardMaterial({ color: 0x2a2e34 }), -8.0, f + 0.5, 15.2);       // tower
  const pcEntity = {
    prompt: () => `Computer: ${allMotionOn() ? 'stop' : 'run'} motion test (all rooms)`,
    interact: () => { const on = !allMotionOn(); for (const r of motionRooms) state.motion[r.key] = on; sfx('click'); message(on ? 'Motion test: all sensors flashing.' : 'Motion test stopped.'); },
  };
  pc.userData.entity = pcEntity; interactables.push(pc);
  const pcHit = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.9, 0.6), new THREE.MeshBasicMaterial({ visible: false }));
  pcHit.position.set(-9.6, f + 1.1, 15.1); pcHit.userData.entity = pcEntity; scene.add(pcHit); interactables.push(pcHit);
  // mug, papers, radio
  const mug = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.045, 0.11, 12), new THREE.MeshStandardMaterial({ color: 0xd8d0c0 })); mug.position.set(-13.2, f + 0.875, 14.9); scene.add(mug);
  box(0.3, 0.01, 0.4, new THREE.MeshStandardMaterial({ color: 0xeeeae0 }), -15.8, f + 0.83, 14.7, 0.2);
  box(0.25, 0.12, 0.2, matMetal, -11.2, f + 0.88, 15.3);

  // cork boards
  const cork = (draw) => canvasTexture(768, 512, (ctx) => {
    ctx.fillStyle = '#b58a57'; ctx.fillRect(0, 0, 768, 512);
    for (let i = 0; i < 6000; i++) { ctx.fillStyle = `rgba(60,35,15,${Math.random() * 0.18})`; ctx.fillRect(Math.random() * 768, Math.random() * 512, 3, 3); }
    ctx.strokeStyle = '#5a3b1e'; ctx.lineWidth = 18; ctx.strokeRect(9, 9, 750, 494);
    draw(ctx);
  });
  const pin = (ctx, x, y) => { ctx.fillStyle = '#d8302a'; ctx.beginPath(); ctx.arc(x, y, 7, 0, Math.PI * 2); ctx.fill(); };
  const wanted = cork((ctx) => {
    // wanted poster
    ctx.save(); ctx.translate(70, 50); ctx.rotate(-0.03);
    ctx.fillStyle = '#efe7d2'; ctx.fillRect(0, 0, 290, 400);
    ctx.fillStyle = '#1a1a1a'; ctx.font = 'bold 54px Courier New'; ctx.textAlign = 'center'; ctx.fillText('WANTED', 145, 60);
    ctx.fillStyle = '#2a2f36'; ctx.fillRect(55, 85, 180, 180);
    ctx.fillStyle = '#0c0d10'; ctx.beginPath(); ctx.arc(145, 150, 40, 0, Math.PI * 2); ctx.fill(); ctx.fillRect(95, 190, 100, 75);
    ctx.fillStyle = '#ff3b2a'; ctx.beginPath(); ctx.arc(132, 148, 4, 0, Math.PI * 2); ctx.arc(158, 148, 4, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#1a1a1a'; ctx.font = 'bold 24px Courier New'; ctx.fillText('INMATE #4471', 145, 300);
    ctx.font = '18px Courier New'; ctx.fillText('ESCAPED  ·  ARMED?', 145, 330); ctx.fillText('DO NOT APPROACH', 145, 356); ctx.fillText('REPORT TO SECURITY', 145, 382);
    ctx.restore(); pin(ctx, 215, 58);
    // memo
    ctx.save(); ctx.translate(400, 70); ctx.rotate(0.05);
    ctx.fillStyle = '#fff6b8'; ctx.fillRect(0, 0, 300, 170);
    ctx.fillStyle = '#222'; ctx.font = '20px Courier New'; ctx.textAlign = 'left';
    ['MEMO — all shifts', '', 'Breaker in UTILITY trips', 'if the boiler runs hot.', 'Reset it, then check', 'Block A cell doors.'].forEach((l, i) => ctx.fillText(l, 14, 30 + i * 24));
    ctx.restore(); pin(ctx, 550, 75);
    // photo
    ctx.save(); ctx.translate(420, 290); ctx.rotate(-0.08);
    ctx.fillStyle = '#eee'; ctx.fillRect(0, 0, 220, 160); ctx.fillStyle = '#3b4a33'; ctx.fillRect(12, 12, 196, 110);
    ctx.fillStyle = '#8d918c'; ctx.fillRect(40, 60, 140, 50); ctx.fillStyle = '#222'; ctx.font = '16px Courier New'; ctx.fillText('east fence – 03/12', 22, 146);
    ctx.restore(); pin(ctx, 530, 295);
  });
  const schedule = cork((ctx) => {
    ctx.save(); ctx.translate(60, 40);
    ctx.fillStyle = '#f2eee2'; ctx.fillRect(0, 0, 640, 420);
    ctx.fillStyle = '#1a1a1a'; ctx.font = 'bold 34px Courier New'; ctx.textAlign = 'left'; ctx.fillText('NIGHT SHIFT SCHEDULE', 24, 48);
    ctx.font = '22px Courier New';
    const rows = [['22:00', 'Lights out — all blocks'], ['22:30', 'Count  (Block A)'], ['23:00', 'Patrol route 1 — Hall / Mess'], ['23:45', 'Radio check  ch. 3'], ['00:30', 'Patrol route 2 — Yard / Infirmary'], ['01:15', 'Boiler check — UTILITY'], ['02:00', 'Count  (Block A)'], ['03:00', 'Perimeter walk'], ['05:30', 'Handover']];
    rows.forEach(([t, d], i) => { ctx.fillStyle = i % 2 ? '#e6e1d3' : '#f2eee2'; ctx.fillRect(16, 70 + i * 36, 608, 36); ctx.fillStyle = '#a3241e'; ctx.fillText(t, 28, 96 + i * 36); ctx.fillStyle = '#1a1a1a'; ctx.fillText(d, 120, 96 + i * 36); });
    ctx.restore(); pin(ctx, 100, 46); pin(ctx, 660, 46);
  });
  poster(wanted, 2.4, 1.6, -17.93, f + 1.45, 12.2, Math.PI / 2);
  poster(schedule, 2.4, 1.6, -6.07, f + 1.45, 13.2, -Math.PI / 2);
  box(0.9, 1.5, 0.5, matMetal, -17.5, f + 0.75, 15.2);   // filing cabinet
  box(0.6, 0.9, 0.5, matMetal, -6.4, f + 0.45, 10.5);     // safe
  box(1.0, 0.8, 0.5, new THREE.MeshStandardMaterial({ color: 0x3a3d42 }), -7.3, f + 0.4, 10.45);
  const coffee = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.32, 12), new THREE.MeshStandardMaterial({ color: 0x222 })); coffee.position.set(-7.3, f + 0.96, 10.45); scene.add(coffee);

  // ---- MOTION SENSOR MAP on the north wall (z = 10), facing into the room (+z)
  const PX0 = GX0 * T, PW = W * T, PZ0 = 0, PH = H * T;   // building extents in world metres
  const panelW = 2.2, mapH = 1.12, headH = 0.16;
  const mapTex = canvasTexture(1024, Math.round(1024 * (mapH + headH) / panelW), (ctx, w, h) => {
    ctx.fillStyle = '#0f1418'; ctx.fillRect(0, 0, w, h);
    const hh = h * headH / (mapH + headH);
    ctx.fillStyle = '#1c2430'; ctx.fillRect(0, 0, w, hh);
    ctx.fillStyle = '#ffd25a'; ctx.font = 'bold 40px Courier New'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillText('MOTION SENSOR GRID', 24, hh / 2);
    ctx.fillStyle = '#7f8a93'; ctx.font = '22px Courier New'; ctx.textAlign = 'right'; ctx.fillText('● = sensor   flashing = motion', w - 24, hh / 2);
    const sx = w / PW, sy = (h - hh) / PH;
    for (let y = 0; y < H; y++) for (let x = GX0; x < GX0 + W; x++) {
      if (cellAt(x, y) !== 1) continue;
      ctx.fillStyle = inRect(x, y, rooms.yard.rect) ? '#2d4632' : '#3a4450';
      ctx.fillRect((x * T - PX0) * sx, hh + (y * T - PZ0) * sy, T * sx + 0.6, T * sy + 0.6);
    }
    ctx.strokeStyle = '#aab4bd'; ctx.lineWidth = 2;
    for (let y = 0; y < H; y++) for (let x = GX0; x < GX0 + W; x++) {
      if (cellAt(x, y) !== 0) continue;
      let near = false;
      for (let dy = -1; dy <= 1 && !near; dy++) for (let dx = -1; dx <= 1; dx++) if (inGrid(x + dx, y + dy) && cellAt(x + dx, y + dy) === 1) { near = true; break; }
      if (near) { ctx.fillStyle = '#7c8791'; ctx.fillRect((x * T - PX0) * sx, hh + (y * T - PZ0) * sy, T * sx + 0.6, T * sy + 0.6); }
    }
    ctx.fillStyle = '#e6ecf0'; ctx.font = 'bold 17px Courier New'; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    for (const r of motionRooms) ctx.fillText(r.label.toUpperCase(), (r.x - PX0) * sx, hh + (r.z - PZ0) * sy + 26);
  });
  const panel = new THREE.Group(); panel.position.set(-12, f + 1.55, 10.04); scene.add(panel);
  const board = new THREE.Mesh(new THREE.PlaneGeometry(panelW, mapH + headH), new THREE.MeshStandardMaterial({ map: mapTex, roughness: 0.6, emissive: 0xffffff, emissiveMap: mapTex, emissiveIntensity: 0.5 }));
  panel.add(board);
  const frame = new THREE.Mesh(new THREE.BoxGeometry(panelW + 0.08, mapH + headH + 0.08, 0.05), matMetal); frame.position.z = -0.03; panel.add(frame);
  for (const r of motionRooms) {
    const u = (r.x - PX0) / PW, v = (r.z - PZ0) / PH;
    const lx = (u - 0.5) * panelW, ly = (mapH + headH) / 2 - headH - v * mapH;
    const mat = new THREE.MeshStandardMaterial({ color: 0x2a0000, emissive: 0xff2a1a, emissiveIntensity: 0, roughness: 0.3 });
    const b = new THREE.Mesh(new THREE.SphereGeometry(0.028, 12, 12), mat);
    b.position.set(lx, ly, 0.03); panel.add(b);
    const glow = new THREE.PointLight(0xff3a2a, 0, 1.2, 2); glow.position.set(lx, ly, 0.12); panel.add(glow);
    bulbs[r.key] = { mat, glow, phase: Math.random() * 6 };
  }
  // toggle buttons along the wall under the map
  const n = motionRooms.length, spacing = 0.42, startX = -12 - (n - 1) * spacing / 2;
  box(n * spacing + 0.3, 0.5, 0.08, new THREE.MeshStandardMaterial({ color: 0x2b3036, roughness: 0.7 }), -12, f + 0.72, 10.04);
  motionRooms.forEach((r, i) => {
    makeButton(r.label, startX + i * spacing, f + 0.68, 10.09, 0,
      () => { state.motion[r.key] = !state.motion[r.key]; message(`Motion test: ${r.label} ${state.motion[r.key] ? 'ON' : 'OFF'}.`); },
      () => `Motion test: ${r.label} (${state.motion[r.key] ? 'on' : 'off'})`);
  });
  sign('SECURITY OFFICE', -14, 2.78, 18.02, 0, 2.4);   // hall side, above the window
}
const allMotionOn = () => motionRooms.every(r => state.motion[r.key]);
function updateMotionBulbs(t) {
  for (const r of motionRooms) {
    const b = bulbs[r.key];
    const live = r.key === 'block' && figure.visible;                           // real motion: the prisoner in Block A
    const on = state.motion[r.key] || live;
    const blink = on ? (Math.sin(t * 9 + b.phase) > 0 ? 1 : 0) : 0;
    b.mat.emissiveIntensity = blink * 3;
    b.glow.intensity = blink * 0.8;
  }
}

// =====================================================================
//  EXTERIOR: terrain, road, perimeter wall, towers, forest, sky
// =====================================================================
{
  const size = 1000, seg = 250;
  const geo = new THREE.PlaneGeometry(size, size, seg, seg);
  geo.rotateX(-Math.PI / 2);
  const cx = 44, cz = 30, pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) pos.setY(i, terrainH(pos.getX(i) + cx, pos.getZ(i) + cz) - 0.02);
  geo.computeVertexNormals();
  const ground = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: texGrass, roughness: 1 }));
  ground.position.set(cx, 0, cz);
  ground.receiveShadow = true;
  scene.add(ground);

  const road = new THREE.Mesh(new THREE.PlaneGeometry(260, 6), new THREE.MeshStandardMaterial({ map: texAsphalt, roughness: 0.9 }));
  road.rotation.x = -Math.PI / 2;
  road.position.set(-160, 0.01, ROAD_Z);
  road.receiveShadow = true;
  scene.add(road);
  const apronMat = new THREE.MeshStandardMaterial({ map: texConcrete.clone(), roughness: 0.95 });
  apronMat.map.repeat.set(3, 6); apronMat.map.needsUpdate = true;
  const apron = new THREE.Mesh(new THREE.PlaneGeometry(10, 20), apronMat);
  apron.rotation.x = -Math.PI / 2; apron.position.set(-35, 0.005, ROAD_Z); scene.add(apron);

  const wallMat = matConcrete;
  const { x0, z0, x1, z1, h } = PERIM;
  const gapHalf = 5;
  box(x1 - x0, h, 1, wallMat, (x0 + x1) / 2, h / 2, z0, 0, true);
  box(x1 - x0, h, 1, wallMat, (x0 + x1) / 2, h / 2, z1, 0, true);
  box(1, h, z1 - z0, wallMat, x1, h / 2, (z0 + z1) / 2, 0, true);
  box(1, h, (ROAD_Z - gapHalf) - z0, wallMat, x0, h / 2, (z0 + ROAD_Z - gapHalf) / 2, 0, true);
  box(1, h, z1 - (ROAD_Z + gapHalf), wallMat, x0, h / 2, (ROAD_Z + gapHalf + z1) / 2, 0, true);
  for (const [w, d, bx, bz] of [[x1 - x0, 0.3, (x0 + x1) / 2, z0], [x1 - x0, 0.3, (x0 + x1) / 2, z1], [0.3, z1 - z0, x1, (z0 + z1) / 2], [0.3, z1 - z0, x0, (z0 + z1) / 2]]) box(w, 0.3, d, matMetal, bx, h + 0.15, bz);
  box(0.6, 6, 0.6, wallMat, x0, 3, ROAD_Z - gapHalf - 0.3, 0, true);
  box(0.6, 6, 0.6, wallMat, x0, 3, ROAD_Z + gapHalf + 0.3, 0, true);
  const arm = box(0.15, 0.15, 9.5, new THREE.MeshStandardMaterial({ color: 0xd84a3a }), x0, 3.2, ROAD_Z);
  arm.rotation.x = Math.PI / 2 - 0.25;

  const towerAt = (tx, tz) => {
    box(4, 6, 4, wallMat, tx, 3, tz, 0, true);
    box(5, 0.3, 5, matMetal, tx, 6.15, tz);
    box(4.4, 1.1, 4.4, new THREE.MeshStandardMaterial({ color: 0x2e3338, roughness: 0.4, metalness: 0.3, transparent: true, opacity: 0.65 }), tx, 7.2, tz);
    box(5.4, 0.3, 5.4, matRoof, tx, 8.2, tz);
    addLamp(tx, tz, 'exterior', { color: 0xbfd4ff, intensity: 90, distance: 45, y: 6.9, fixture: false, alwaysOn: true });
  };
  towerAt(x0 + 2, z0 + 2); towerAt(x1 - 2, z0 + 2); towerAt(x0 + 2, z1 - 2); towerAt(x1 - 2, z1 - 2);

  for (const [lx, lz] of [[-36, ROAD_Z - 5], [-36, ROAD_Z + 5], [-50, ROAD_Z - 4.5], [x0 - 8, ROAD_Z + 4.5], [x0 - 30, ROAD_Z - 4.5]]) floodlight(lx, lz, 'exterior', { alwaysOn: true, intensity: 30, color: 0xffd9a0 });
  floodlight(37 * T + 1, -4, 'exterior', { alwaysOn: true, intensity: 35 });

  // forest — on the grounds outside the perimeter and all over the hills
  const N = 3200;
  const leaves = new THREE.InstancedMesh(new THREE.ConeGeometry(1.7, 6.5, 7), matTree, N);
  const trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.18, 0.28, 1.6, 6), matTrunk, N);
  const m = new THREE.Matrix4();
  let placed = 0, guard = 0;
  while (placed < N && guard++ < 60000) {
    const x = cx - 480 + Math.random() * 960, z = cz - 480 + Math.random() * 960;
    const insidePerimeter = x > x0 - 6 && x < x1 + 6 && z > z0 - 6 && z < z1 + 6;
    const onRoad = x < x0 && Math.abs(z - ROAD_Z) < 8;
    if (insidePerimeter || onRoad) continue;
    const y = terrainH(x, z);
    const s = 0.8 + Math.random() * 1.0;
    m.makeScale(s, s, s).setPosition(x, y + 0.8 + 3.25 * s, z);
    leaves.setMatrixAt(placed, m);
    m.makeScale(1, 1, 1).setPosition(x, y + 0.8, z);
    trunks.setMatrixAt(placed, m);
    placed++;
  }
  leaves.count = trunks.count = placed;
  scene.add(leaves, trunks);
}

// sky dome (horizon gradient) + stars + moon — follow the player
const sky = new THREE.Group();
{
  const domeGeo = new THREE.SphereGeometry(620, 32, 16);
  const col = new Float32Array(domeGeo.attributes.position.count * 3);
  const horizon = new THREE.Color(0x1b2440), zenith = new THREE.Color(0x04060c), c = new THREE.Color();
  for (let i = 0; i < domeGeo.attributes.position.count; i++) {
    const y = domeGeo.attributes.position.getY(i) / 620;
    c.copy(horizon).lerp(zenith, smoothstep(-0.05, 0.5, y));
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  domeGeo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  sky.add(new THREE.Mesh(domeGeo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false })));

  const n = 2200, pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const theta = 2 * Math.PI * Math.random(), phi = Math.acos(1 - Math.random());
    const r = 560;
    pos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    pos[i * 3 + 1] = Math.max(8, r * Math.cos(phi));
    pos[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  sky.add(new THREE.Points(g, new THREE.PointsMaterial({ color: 0xcfd8ff, size: 1.6, sizeAttenuation: false, fog: false, transparent: true, opacity: 0.85, depthWrite: false })));
  const moon = new THREE.Mesh(new THREE.SphereGeometry(14, 24, 24), new THREE.MeshBasicMaterial({ color: 0xe8ecf8, fog: false }));
  moon.position.copy(moonDir).multiplyScalar(520);
  sky.add(moon);
  const glowTex = canvasTexture(128, 128, (ctx) => { const gr = ctx.createRadialGradient(64, 64, 0, 64, 64, 64); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.35, 'rgba(200,215,255,.45)'); gr.addColorStop(1, 'rgba(200,215,255,0)'); ctx.fillStyle = gr; ctx.fillRect(0, 0, 128, 128); });
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0x8fa2d8, transparent: true, opacity: 0.55, fog: false, depthWrite: false }));
  glow.scale.set(150, 150, 1); glow.position.copy(moon.position);
  sky.add(glow);
  scene.add(sky);
}

// =====================================================================
//  THE "PRISONER" — placeholder silhouette
// =====================================================================
const figure = new THREE.Group();
{
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x0a0a0c, roughness: 1, transparent: true, opacity: 1 });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.32, 1.1, 4, 10), bodyMat);
  body.position.y = 0.95;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 10), bodyMat);
  head.position.y = 1.75;
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0xff3b2a, transparent: true });
  for (const s of [-1, 1]) { const e = new THREE.Mesh(new THREE.SphereGeometry(0.03), eyeMat); e.position.set(s * 0.07, 1.78, 0.17); figure.add(e); }
  figure.add(body, head);
  figure.userData = { bodyMat, eyeMat, path: [], speed: 5.5 };
  figure.visible = false;
  scene.add(figure);
}

// =====================================================================
//  PLAYER + FLASHLIGHT
// =====================================================================
const controls = new PointerLockControls(camera, renderer.domElement);
const player = { pos: new THREE.Vector3(-24, 0, 20), vel: new THREE.Vector3(), radius: 0.38, height: 1.62, bob: 0, stepDist: 0 };
const options = { sens: 1, fov: 75, bob: true, shadows: true };
camera.position.set(player.pos.x, player.height, player.pos.z);
camera.rotation.set(0, Math.PI / 2, 0, 'YXZ');   // menu view: looking west out of the open entrance

const flashPivot = new THREE.Group();
camera.add(flashPivot);
const flashlight = new THREE.SpotLight(0xfff3d9, 70, 38, 0.58, 0.75, 1.7);
flashlight.position.set(0, 0, 0);
flashlight.target.position.set(0, 0, -1);
flashlight.castShadow = true;
flashlight.shadow.mapSize.set(1024, 1024);
flashlight.shadow.camera.near = 0.3;
flashlight.shadow.camera.far = 38;
flashlight.shadow.bias = -0.0025;
flashPivot.add(flashlight, flashlight.target);
flashlight.intensity = 0;   // stays off until the intro hands over control
const aim = { active: false, yaw: 0, pitch: 0, limit: 1.1 };
const playing = () => cine.phase === 'play';

const keysDown = {};
window.addEventListener('keydown', (e) => {
  keysDown[e.code] = true;
  if (!playing()) return;
  if (e.code === 'KeyF') tryInteract();
  if (e.code === 'KeyL') toggleFlashlight();
  if (e.code === 'KeyQ') aim.active = true;
  if (e.code === 'KeyM' || e.code === 'Tab') { e.preventDefault(); toggleTravel(); }
});
window.addEventListener('keyup', (e) => { keysDown[e.code] = false; if (e.code === 'KeyQ') aim.active = false; });
window.addEventListener('mousedown', (e) => { if (e.button === 2 && controls.isLocked && playing()) aim.active = true; });
window.addEventListener('mouseup', (e) => { if (e.button === 2) aim.active = false; });
window.addEventListener('contextmenu', (e) => e.preventDefault());
window.addEventListener('mousemove', (e) => {
  if (!controls.isLocked) return;
  if (!playing()) { e.stopImmediatePropagation(); return; }       // no looking around during the intro
  if (!aim.active) return;
  const dx = e.movementX || 0, dy = e.movementY || 0;
  aim.yaw = THREE.MathUtils.clamp(aim.yaw - dx * 0.0022 * options.sens, -aim.limit, aim.limit);
  aim.pitch = THREE.MathUtils.clamp(aim.pitch - dy * 0.0022 * options.sens, -aim.limit * 0.8, aim.limit * 0.8);
  e.stopImmediatePropagation();
}, true);

function toggleFlashlight() {
  state.flashlight = !state.flashlight;
  flashlight.intensity = state.flashlight ? 70 : 0;
  $('flashState').textContent = state.flashlight ? 'ON' : 'OFF';
  sfx('click');
}
function updateFlashlight(dt) {
  if (!aim.active) {
    const k = 1 - Math.exp(-dt * 7);
    aim.yaw += (0 - aim.yaw) * k;
    aim.pitch += (0 - aim.pitch) * k;
  }
  flashPivot.rotation.set(aim.pitch, aim.yaw, 0, 'YXZ');
  $('aimState').textContent = aim.active ? '(aiming)' : '';
}

const isBlocked = (gx, gy) => {
  if (!inGrid(gx, gy)) return false;
  if (cellAt(gx, gy) === 0) return true;
  const d = doorAt(gx, gy);
  return d ? d.blocks() : false;
};
function pushOutOfBox(pos, bx0, bx1, bz0, bz1, r) {
  const nx = Math.max(bx0, Math.min(pos.x, bx1));
  const nz = Math.max(bz0, Math.min(pos.z, bz1));
  const ddx = pos.x - nx, ddz = pos.z - nz;
  const dist = Math.hypot(ddx, ddz);
  if (dist >= r) return;
  if (dist < 1e-5) {
    const cx = (bx0 + bx1) / 2, cz = (bz0 + bz1) / 2;
    const ex = (bx1 - bx0) / 2, ez = (bz1 - bz0) / 2;
    const px = ex - Math.abs(pos.x - cx), pz = ez - Math.abs(pos.z - cz);
    if (px < pz) pos.x = cx + Math.sign(pos.x - cx || 1) * (ex + r);
    else pos.z = cz + Math.sign(pos.z - cz || 1) * (ez + r);
    return;
  }
  pos.x += (ddx / dist) * (r - dist);
  pos.z += (ddz / dist) * (r - dist);
}
function resolveCollisions(pos) {
  const gx = tileOf(pos.x), gz = tileOf(pos.z), r = player.radius;
  for (let iter = 0; iter < 2; iter++) {
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const tx = gx + dx, tz = gz + dy;
      if (isBlocked(tx, tz)) pushOutOfBox(pos, tx * T, (tx + 1) * T, tz * T, (tz + 1) * T, r);
    }
    for (const c of colliders) {
      if (pos.x < c.x0 - 2 || pos.x > c.x1 + 2 || pos.z < c.z0 - 2 || pos.z > c.z1 + 2) continue;
      pushOutOfBox(pos, c.x0, c.x1, c.z0, c.z1, r);
    }
  }
}

const _fwd = new THREE.Vector3(), _right = new THREE.Vector3(), _wish = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);
let eyeY = player.height;
function updatePlayer(dt) {
  camera.getWorldDirection(_fwd); _fwd.y = 0; _fwd.normalize();
  _right.crossVectors(_fwd, _up);
  _wish.set(0, 0, 0);
  if (controls.isLocked && playing() && !state.paused) {
    if (keysDown.KeyW || keysDown.ArrowUp) _wish.add(_fwd);
    if (keysDown.KeyS || keysDown.ArrowDown) _wish.sub(_fwd);
    if (keysDown.KeyD || keysDown.ArrowRight) _wish.add(_right);
    if (keysDown.KeyA || keysDown.ArrowLeft) _wish.sub(_right);
  }
  const running = keysDown.ShiftLeft || keysDown.ShiftRight;
  if (_wish.lengthSq() > 0) _wish.normalize().multiplyScalar(running ? 6.4 : 3.8);
  player.vel.lerp(_wish, 1 - Math.exp(-dt * 10));
  const before = player.pos.clone();
  player.pos.addScaledVector(player.vel, dt);
  resolveCollisions(player.pos);
  const moved = player.pos.distanceTo(before);
  const speed = moved / Math.max(dt, 1e-4);
  player.bob += dt * (running ? 11 : 8) * Math.min(1, speed / 3);
  player.stepDist += moved;
  if (player.stepDist > (running ? 2.2 : 1.7)) { player.stepDist = 0; sfx('step'); }
  const groundY = groundHeight(player.pos.x, player.pos.z);
  eyeY += (groundY + player.height - eyeY) * Math.min(1, dt * 14);   // smooth over ramps and hills
  const bob = options.bob ? Math.sin(player.bob) * 0.035 * Math.min(1, speed / 3) : 0;
  camera.position.set(player.pos.x, eyeY + bob, player.pos.z);
  sky.position.set(player.pos.x, 0, player.pos.z);
}

// =====================================================================
//  INTERACTION
// =====================================================================
const raycaster = new THREE.Raycaster();
raycaster.far = 3.2;
let focused = null;
function findFocus() {
  raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
  const hits = raycaster.intersectObjects([...blockers, ...interactables], false);
  for (const h of hits) {
    if (blockers.includes(h.object)) return null;
    if (h.object.userData.entity) return h.object.userData.entity;
  }
  return null;
}
function tryInteract() {
  if (!controls.isLocked || !focused) return;
  focused.interact();
  focused = null;
}

// =====================================================================
//  FAST TRAVEL
// =====================================================================
const travelSpots = [
  { name: 'Man Trap',            x: -24, z: 20, yaw: -Math.PI / 2 },
  { name: 'Security Room',       x: -12, z: 12.5, yaw: Math.PI },
  { name: 'Entry Hall',          x: -8,  z: 19, yaw: -Math.PI / 2 },
  { name: 'Guard Office',        x: 9,   z: 9,  yaw: Math.PI },
  { name: 'Main Hall (west)',    x: 8,   z: 19, yaw: -Math.PI / 2 },
  { name: 'Mess Hall',           x: 31,  z: 11, yaw: 0 },
  { name: 'Infirmary',           x: 53,  z: 11, yaw: 0 },
  { name: 'Utility Room',        x: 9,   z: 30, yaw: Math.PI / 2 },
  { name: 'Cell Block A',        x: 20,  z: 26, yaw: -Math.PI / 2 },
  { name: 'Cell 8',              x: 77,  z: 32, yaw: 0 },
  { name: 'Yard',                x: 75,  z: 11, yaw: 0 },
  { name: 'Main Entrance (out)', x: -36, z: ROAD_Z, yaw: Math.PI / 2 },
  { name: 'Perimeter Gate',      x: PERIM.x0 + 8, z: ROAD_Z, yaw: Math.PI / 2 },
  { name: 'Hilltop (west)',      x: PERIM.x0 - 120, z: ROAD_Z - 70, yaw: -Math.PI / 2 },
  { name: 'Behind the Yard',     x: 75,  z: -8, yaw: Math.PI },
];
const MAP = { x0: -200, z0: -110, x1: 200, z1: 140 };
const mapCanvas = $('travelMap');
const mapScale = mapCanvas.width / (MAP.x1 - MAP.x0);
const toMap = (x, z) => [(x - MAP.x0) * mapScale, (z - MAP.z0) * mapScale];
const fromMap = (px, py) => [px / mapScale + MAP.x0, py / mapScale + MAP.z0];

let mapBase = null;
function drawMapBase() {
  const c = document.createElement('canvas'); c.width = mapCanvas.width; c.height = mapCanvas.height;
  const ctx = c.getContext('2d');
  // terrain shading
  const img = ctx.createImageData(c.width, c.height);
  for (let py = 0; py < c.height; py++) for (let px = 0; px < c.width; px++) {
    const [x, z] = fromMap(px + 0.5, py + 0.5);
    const h = terrainH(x, z) / 42;
    const i = (py * c.width + px) * 4;
    img.data[i] = 14 + h * 60; img.data[i + 1] = 30 + h * 70; img.data[i + 2] = 18 + h * 40; img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  let [ax, ay] = toMap(PERIM.x0, PERIM.z0), [bx, by] = toMap(PERIM.x1, PERIM.z1);
  ctx.fillStyle = '#1d2b1c'; ctx.fillRect(ax, ay, bx - ax, by - ay);
  ctx.strokeStyle = '#b9bdb0'; ctx.lineWidth = 2; ctx.strokeRect(ax, ay, bx - ax, by - ay);
  [ax, ay] = toMap(-290, ROAD_Z - 3); [bx, by] = toMap(-30, ROAD_Z + 3);
  ctx.fillStyle = '#3a3d42'; ctx.fillRect(ax, ay, bx - ax, by - ay);
  for (const [tx, tz] of [[PERIM.x0 + 2, PERIM.z0 + 2], [PERIM.x1 - 2, PERIM.z0 + 2], [PERIM.x0 + 2, PERIM.z1 - 2], [PERIM.x1 - 2, PERIM.z1 - 2]]) {
    const [px, py] = toMap(tx, tz); ctx.fillStyle = '#d8dcd0'; ctx.fillRect(px - 3, py - 3, 6, 6);
  }
  const s = T * mapScale;
  for (let y = 0; y < H; y++) for (let x = GX0; x < GX0 + W; x++) {
    if (cellAt(x, y) !== 1) continue;
    const [px, py] = toMap(x * T, y * T);
    ctx.fillStyle = inRect(x, y, rooms.yard.rect) ? '#2f4a2a' : '#6c7078'; ctx.fillRect(px, py, s + 0.5, s + 0.5);
  }
  for (let y = 0; y < H; y++) for (let x = GX0; x < GX0 + W; x++) {
    if (cellAt(x, y) !== 0) continue;
    let near = false;
    for (let dy = -1; dy <= 1 && !near; dy++) for (let dx = -1; dx <= 1; dx++) if (inGrid(x + dx, y + dy) && cellAt(x + dx, y + dy) === 1) { near = true; break; }
    if (!near) continue;
    const [px, py] = toMap(x * T, y * T);
    ctx.fillStyle = '#c8ccc0'; ctx.fillRect(px, py, s + 0.5, s + 0.5);
  }
  for (const d of doors) for (const [tx, ty] of d.tiles) { const [px, py] = toMap(tx * T + 1, ty * T + 1); ctx.fillStyle = d.locked ? '#e0513f' : '#ffd25a'; ctx.fillRect(px - 2, py - 2, 4, 4); }
  ctx.fillStyle = '#9aa'; ctx.font = '10px Courier New'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('ROAD', ...toMap(-120, ROAD_Z - 7));
  ctx.fillText('HILLS', ...toMap(-150, -80)); ctx.fillText('HILLS', ...toMap(170, 120)); ctx.fillText('HILLS', ...toMap(150, -90));
  travelSpots.forEach((sp, i) => {
    const [px, py] = toMap(sp.x, sp.z);
    ctx.fillStyle = '#ffd25a'; ctx.beginPath(); ctx.arc(px, py, 7, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#000'; ctx.font = 'bold 10px Courier New'; ctx.fillText(String(i + 1), px, py + 0.5);
  });
  mapBase = c;
}
function drawMap() {
  if (!mapBase) drawMapBase();
  const ctx = mapCanvas.getContext('2d');
  ctx.drawImage(mapBase, 0, 0);
  const [px, py] = toMap(player.pos.x, player.pos.z);
  camera.getWorldDirection(_fwd);
  ctx.strokeStyle = '#5ef2ff'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px + _fwd.x * 14, py + _fwd.z * 14); ctx.stroke();
  ctx.fillStyle = '#5ef2ff'; ctx.beginPath(); ctx.arc(px, py, 5, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.stroke();
}
function teleport(x, z, yaw) {
  player.pos.set(x, 0, z);
  player.vel.set(0, 0, 0);
  resolveCollisions(player.pos);
  if (yaw !== undefined) camera.rotation.set(0, yaw, 0, 'YXZ');
  eyeY = groundHeight(player.pos.x, player.pos.z) + player.height;
  camera.position.set(player.pos.x, eyeY, player.pos.z);
  sfx('travel');
}
function canStandAt(x, z) {
  if (isBlocked(tileOf(x), tileOf(z))) return false;
  for (const c of colliders) if (x > c.x0 - 0.4 && x < c.x1 + 0.4 && z > c.z0 - 0.4 && z < c.z1 + 0.4) return false;
  return true;
}
function toggleTravel(force) {
  const open = force !== undefined ? force : !state.travelOpen;
  if (open === state.travelOpen) return;
  state.travelOpen = open;
  $('travel').classList.toggle('open', open);
  if (open) { drawMap(); controls.unlock(); }
  else controls.lock();
}
{
  const list = $('travelList');
  travelSpots.forEach((sp, i) => {
    const b = document.createElement('button');
    b.innerHTML = `<b>${i + 1}</b>${sp.name}`;
    b.addEventListener('click', () => { teleport(sp.x, sp.z, sp.yaw); toggleTravel(false); });
    list.appendChild(b);
  });
  const close = document.createElement('div'); close.className = 'close'; close.textContent = 'M / Tab — close'; list.appendChild(close);
  mapCanvas.addEventListener('click', (e) => {
    const r = mapCanvas.getBoundingClientRect();
    const [x, z] = fromMap((e.clientX - r.left) * (mapCanvas.width / r.width), (e.clientY - r.top) * (mapCanvas.height / r.height));
    if (!canStandAt(x, z)) { sfx('locked'); return; }
    teleport(x, z);
    toggleTravel(false);
  });
  $('travel').addEventListener('click', (e) => { if (e.target === $('travel')) toggleTravel(false); });
}

// =====================================================================
//  HUD / MESSAGES / OBJECTIVES
// =====================================================================
let msgTimer = 0;
function message(text, seconds = 3.2) {
  $('message').textContent = text;
  $('message').style.opacity = 1;
  msgTimer = seconds;
}
function objective(text) { $('objectiveText').textContent = text; }
function renderInventory() {
  $('inventoryText').innerHTML = state.inventory.length ? state.inventory.map(k => `<span>🔑 ${KEY_NAMES[k]}</span>`).join('') : '— empty —';
}

function onKeyPicked(id) {
  if (id === 'utility' && state.stage === 0) {
    state.stage = 1;
    objective('Head out of the office, cross the hall, and unlock the UTILITY room. Reset the main breaker.');
  }
  if (id === 'gate') {
    state.stage = 4;
    objective('He dropped the yard gate key. Get back to the main hall and open the YARD gate at the east end before he gets over the fence.');
  }
}
function onPowerRestored() {
  state.stage = Math.max(state.stage, 2);
  message('Power restored. The hall lights hum back on… and something just moved in Cell Block A.', 5);
  objective('Lights are back. Something is moving in CELL BLOCK A — the gate is down the main hall to the right. Tip: the office light switch works now too.');
  sfx('hum');
}
function onDoorToggled(door) {
  if (door.def.name === 'Yard Gate' && door.open && !state.won) objective('Go through the gate into the yard.');
  mapBase = null;
}
let reportedIn = false;
function checkSecurityRoom() {
  if (reportedIn) return;
  if (!inRect(tileOf(player.pos.x), tileOf(player.pos.z), rooms.security.rect)) return;
  reportedIn = true;
  state.stage = 0;
  message('Signed in. The main block\'s power is out — the breaker is in UTILITY, and the key is on the desk in the GUARD OFFICE.', 6);
  objective('Power is out in the main block. Grab the utility key off the desk in the GUARD OFFICE (main hall, first door on the left), then reset the breaker in UTILITY. Try the motion-test buttons under the map first if you like.');
}
function spawnFigureIfNeeded() {
  if (state.figure !== 'hidden' || state.stage < 2) return;
  const gx = tileOf(player.pos.x), gz = tileOf(player.pos.z);
  if (!inRect(gx, gz, rooms.block.rect)) return;
  figure.position.set(41 * T + 1, 0, 12.5 * T + 1);
  figure.visible = true;
  state.figure = 'standing';
  message('There — at the end of the block. Someone is out of their cell.', 4);
  objective('Stop him! He is at the far east end of the cell block.');
}
function updateFigure(dt) {
  if (!figure.visible) return;
  const ud = figure.userData;
  const toP = new THREE.Vector3(player.pos.x - figure.position.x, 0, player.pos.z - figure.position.z);
  if (state.figure === 'standing') {
    figure.rotation.y = Math.atan2(toP.x, toP.z);
    if (toP.length() < 15) {
      state.figure = 'fleeing';
      ud.path = [new THREE.Vector3(77, 0, 26), new THREE.Vector3(77, 0, 29.2), new THREE.Vector3(77, 0, 34.5)];
      message('He is running — into cell 8!', 3);
      sfx('alarm');
    }
  } else if (state.figure === 'fleeing') {
    const target = ud.path[0];
    const d = new THREE.Vector3().subVectors(target, figure.position);
    const len = d.length();
    if (len < 0.15) { ud.path.shift(); if (!ud.path.length) state.figure = 'vanishing'; return; }
    figure.rotation.y = Math.atan2(d.x, d.z);
    figure.position.addScaledVector(d.normalize(), Math.min(len, ud.speed * dt));
    figure.position.y = Math.abs(Math.sin(performance.now() * 0.012)) * 0.05;
  } else if (state.figure === 'vanishing') {
    ud.bodyMat.opacity -= dt * 1.4;
    ud.eyeMat.opacity = ud.bodyMat.opacity;
    if (ud.bodyMat.opacity <= 0) {
      figure.visible = false;
      state.figure = 'gone';
      keys.find(k => k.id === 'gate').reveal();
      state.stage = 3;
      message('…Gone. Cell 8 is empty. But he dropped something.', 4);
      objective('Search CELL 8 (east end of the block) — he dropped something on the floor.');
    }
  }
}
function checkWin() {
  if (state.won) return;
  const gx = tileOf(player.pos.x), gz = tileOf(player.pos.z);
  if (inRect(gx, gz, rooms.yard.rect)) {
    state.won = true;
    sfx('win');
    message('DEMO COMPLETE — he is gone over the fence… for now. Free roam: the PERIMETER gate at the back of the yard leads outside.', 7);
    objective('DEMO COMPLETE — free roam. Try the PERIMETER gate at the back of the yard, walk the hills, or press M to fast travel.');
  }
}

// =====================================================================
//  AUDIO
// =====================================================================
let actx = null;
function initAudio() { if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)(); }
function tone({ type = 'sine', f0 = 440, f1 = f0, dur = 0.15, vol = 0.2, delay = 0 }) {
  if (!actx) return;
  const t = actx.currentTime + delay;
  const o = actx.createOscillator(), g = actx.createGain();
  o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0005, t + dur);
  o.connect(g).connect(actx.destination); o.start(t); o.stop(t + dur + 0.02);
}
function noiseBurst(dur = 0.08, vol = 0.08, lowpass = 1200, delay = 0) {
  if (!actx) return;
  const n = actx.sampleRate * dur, buf = actx.createBuffer(1, n, actx.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
  const s = actx.createBufferSource(); s.buffer = buf;
  const f = actx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = lowpass;
  const g = actx.createGain(); g.gain.value = vol;
  s.connect(f).connect(g).connect(actx.destination); s.start(actx.currentTime + delay);
}
function sfx(name) {
  switch (name) {
    case 'pickup': tone({ f0: 880, f1: 1320, dur: 0.12 }); tone({ f0: 1320, f1: 1760, dur: 0.18, delay: 0.1 }); break;
    case 'door': tone({ type: 'triangle', f0: 140, f1: 60, dur: 0.3, vol: 0.25 }); noiseBurst(0.15, 0.05, 600); break;
    case 'slam': tone({ type: 'triangle', f0: 90, f1: 40, dur: 0.5, vol: 0.4 }); noiseBurst(0.35, 0.25, 500); tone({ type: 'sine', f0: 1200, f1: 300, dur: 0.6, vol: 0.05, delay: 0.05 }); break;
    case 'slide': tone({ type: 'sawtooth', f0: 38, f1: 46, dur: 2.2, vol: 0.18 }); noiseBurst(2.0, 0.07, 700); tone({ type: 'square', f0: 160, f1: 150, dur: 0.25, vol: 0.06, delay: 2.1 }); break;
    case 'bars': tone({ type: 'square', f0: 220, f1: 180, dur: 0.25, vol: 0.08 }); tone({ type: 'sine', f0: 1800, f1: 900, dur: 0.4, vol: 0.06 }); break;
    case 'locked': tone({ type: 'square', f0: 200, f1: 180, dur: 0.07, vol: 0.12 }); tone({ type: 'square', f0: 200, f1: 180, dur: 0.07, vol: 0.12, delay: 0.12 }); break;
    case 'unlock': tone({ type: 'triangle', f0: 600, f1: 900, dur: 0.08, vol: 0.15 }); tone({ type: 'triangle', f0: 400, f1: 200, dur: 0.15, vol: 0.15, delay: 0.1 }); break;
    case 'click': noiseBurst(0.03, 0.15, 3000); break;
    case 'breaker': tone({ type: 'sawtooth', f0: 50, f1: 60, dur: 0.7, vol: 0.25 }); noiseBurst(0.3, 0.2, 900); break;
    case 'hum': tone({ type: 'sine', f0: 120, f1: 120, dur: 1.6, vol: 0.06 }); break;
    case 'step': noiseBurst(0.07, 0.05, 500); break;
    case 'alarm': tone({ type: 'square', f0: 520, f1: 520, dur: 0.25, vol: 0.08 }); tone({ type: 'square', f0: 400, f1: 400, dur: 0.25, vol: 0.08, delay: 0.3 }); break;
    case 'travel': tone({ type: 'sine', f0: 300, f1: 900, dur: 0.25, vol: 0.12 }); noiseBurst(0.25, 0.06, 2000); break;
    case 'win': [523, 659, 784, 1046].forEach((f, i) => tone({ f0: f, f1: f, dur: 0.35, vol: 0.15, delay: i * 0.13 })); break;
  }
}

// =====================================================================
//  MENU / OPTIONS / INTRO CINEMATIC / PAUSE / EXIT
// =====================================================================
const entrance = doorByName('Main Entrance');
const mantrapDoor = doorByName('Man Trap Door');
const fade = (opacity, seconds) => { const b = $('black'); b.style.transition = seconds ? `opacity ${seconds}s ease` : 'none'; void b.offsetWidth; b.style.opacity = opacity; };

function loadOptions() {
  try { Object.assign(options, JSON.parse(localStorage.getItem('ns-options') || '{}')); } catch { /* ignore */ }
  $('optSens').value = options.sens; $('optFov').value = options.fov; $('optBob').checked = options.bob; $('optShadows').checked = options.shadows;
  applyOptions();
}
function applyOptions() {
  options.sens = +$('optSens').value; options.fov = +$('optFov').value; options.bob = $('optBob').checked; options.shadows = $('optShadows').checked;
  $('optSensVal').textContent = options.sens.toFixed(1); $('optFovVal').textContent = options.fov;
  controls.pointerSpeed = options.sens;
  camera.fov = options.fov; camera.updateProjectionMatrix();
  flashlight.castShadow = options.shadows;
  localStorage.setItem('ns-options', JSON.stringify(options));
}
for (const id of ['optSens', 'optFov', 'optBob', 'optShadows']) $(id).addEventListener('input', applyOptions);
$('btnOptions').addEventListener('click', () => { $('menuButtons').classList.add('hidden'); $('options').classList.add('show'); });
$('btnBack').addEventListener('click', () => { $('menuButtons').classList.remove('hidden'); $('options').classList.remove('show'); });

$('btnStart').addEventListener('click', () => {
  if (cine.phase !== 'menu') return;
  initAudio();
  controls.lock();                       // grab the mouse now, while we still have the click gesture
  $('menu').classList.add('hidden');
  cine.phase = 'closing'; cine.t = 0;
  entrance.setOpen(false);
  sfx('slam');
});
$('btnExit').addEventListener('click', () => {
  fade(1, 1.2);
  setTimeout(() => $('exitScreen').classList.add('show'), 1300);
});
$('btnExitMenu').addEventListener('click', () => location.reload());
$('btnResume').addEventListener('click', () => { state.paused = false; $('pause').classList.remove('show'); controls.lock(); });
$('btnMenu').addEventListener('click', () => location.reload());

function updateCinematic(dt) {
  cine.t += dt;
  if (cine.phase === 'menu') {
    // gentle sway while the menu is up
    camera.rotation.set(Math.sin(cine.t * 0.3) * 0.02, Math.PI / 2 + Math.sin(cine.t * 0.21) * 0.05, 0, 'YXZ');
    camera.position.set(-23.4, player.height, 20);
  } else if (cine.phase === 'closing') {
    if (cine.t > 1.3) { fade(1, 0); cine.phase = 'black'; cine.t = 0; }
  } else if (cine.phase === 'black') {
    if (cine.t > 1.0) {
      player.pos.set(-24, 0, 20);
      camera.rotation.set(0, -Math.PI / 2, 0, 'YXZ');   // now facing the inner door (east)
      eyeY = player.height;
      camera.position.set(player.pos.x, eyeY, player.pos.z);
      fade(0, 3.0);
      cine.phase = 'fadein'; cine.t = 0;
    }
  } else if (cine.phase === 'fadein') {
    if (cine.t > 2.6 && !mantrapDoor.open) { mantrapDoor.setOpen(true); objective('Wait for the door.'); }
    if (cine.t > 3.6) {
      cine.phase = 'play'; cine.t = 0;
      flashlight.intensity = state.flashlight ? 70 : 0;
      $('hud').classList.add('show');
      objective('Report to the SECURITY ROOM — down the hall, up the ramp on your left.');
      if (!controls.isLocked) showPause();
    }
  }
}
function showPause() { state.paused = true; $('pause').classList.add('show'); }

controls.addEventListener('lock', () => { state.paused = false; $('pause').classList.remove('show'); });
controls.addEventListener('unlock', () => {
  aim.active = false;
  if (state.travelOpen || !playing()) return;
  showPause();
});
window.addEventListener('resize', () => {
  if (!window.innerWidth || !window.innerHeight) return;   // ignore bogus 0x0 layouts (hidden tabs)
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// =====================================================================
//  MAIN LOOP
// =====================================================================
loadOptions();
updateLights();
renderInventory();
window.__game = { state, cine, player, camera, controls, doors, keys, lamps, figure, colliders, aim, flashPivot, bulbs, motionRooms, message, objective, teleport, toggleTravel, canStandAt, groundHeight, terrainH, frame: () => frame() };
const clock = new THREE.Clock();
function animate() {
  requestAnimationFrame(animate);
  frame();
}
function frame() {
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;

  updateCinematic(dt);
  if (playing()) updatePlayer(dt);
  updateFlashlight(dt);

  for (const d of doors) d.update(dt);
  for (const k of keys) if (k.group.visible) { k.group.rotation.z += dt * 1.2; k.group.position.y += Math.sin(t * 2.5) * 0.0008; }
  for (const l of lamps) if (l.flicker && l.light.intensity > 0) {
    const f = Math.sin(t * 37 + l.seed) * Math.sin(t * 11 + l.seed) > 0.55 ? 0.15 : 1;
    l.light.intensity = l.intensity * f;
    l.fixMat.emissiveIntensity = 2.2 * f;
  }
  updateMotionBulbs(t);

  if (playing()) {
    checkSecurityRoom();
    spawnFigureIfNeeded();
    updateFigure(dt);
    checkWin();
  }

  focused = controls.isLocked && playing() ? findFocus() : null;
  const p = $('prompt');
  if (focused) { p.innerHTML = `<b>[F]</b> ${focused.prompt()}`; p.style.opacity = 1; } else p.style.opacity = 0;

  if (msgTimer > 0) { msgTimer -= dt; if (msgTimer <= 0) $('message').style.opacity = 0; }

  renderer.render(scene, camera);
}
animate();
