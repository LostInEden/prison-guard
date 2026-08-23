// Generates worlds/prison.json — the compound from the aerial reference, in world-editor objects.
// Run:  node worlds/gen-prison.mjs
// Units are metres; x east, z south (+z is "down" on the plan), origin at the map centre.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const T = 0.3;                       // wall thickness of every hollow
const objects = [];
let n = 0;
const id = () => 'p' + (++n).toString(36);
const deg = (d) => d * Math.PI / 180;

// ---------------------------------------------------------------- helpers
function hollow(name, cx, cz, w, h, d, rot = 0, color = '#8d918c') {
  const o = { id: id(), type: 'hollow', name, pos: [cx, 0, cz], rot, thickness: T, color, solid: true, grounded: true,
    parts: [{ type: 'box', pos: [0, 0, 0], rot: 0, scale: [w, h, d], half: false }], cuts: [] };
  objects.push(o);
  return o;
}
// a doorway in one face of a single-box hollow. face: 'n' (local -z) 's' (+z) 'e' (+x) 'w' (-x); along = -1..1 slides it along that face
function doorway(h, face, along = 0, width = 1.4, height = 2.2) {
  const [w, , d] = h.parts[0].scale, r = h.rot || 0;
  const ln = { n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0] }[face];                 // local normal
  const lt = ln[0] ? [0, 1] : [1, 0];                                                  // slide along local +x (n/s faces) or +z (e/w faces), same direction for both opposite faces
  const dist = (ln[0] ? w : d) / 2 - T / 2, slide = ((ln[0] ? d : w) / 2 - 2) * along;
  const lx = ln[0] * dist + lt[0] * slide, lz = ln[1] * dist + lt[1] * slide;
  const c = Math.cos(r), s = Math.sin(r);
  const wx = h.pos[0] + lx * c + lz * s, wz = h.pos[2] - lx * s + lz * c;              // local -> world
  const nx = ln[0] * c + ln[1] * s, nz = -ln[0] * s + ln[1] * c;
  objects.push({ id: id(), type: 'doorway', pos: [wx, T, wz], rot: Math.atan2(nx, nz), scale: [width, height, T + 0.4], color: '#5b6068', target: h.id, grounded: false });
}
function box(name, cx, cz, w, h, d, rot = 0, extra = {}) {
  objects.push({ id: id(), type: 'box', name, pos: [cx, 0, cz], rot, scale: [w, h, d], color: '#8d918c', solid: true, grounded: true, interact: 'none', group: '', text: '', ...extra });
}
function wallSeg(a, b, height = 5, thick = 1) {
  const dx = b[0] - a[0], dz = b[1] - a[1], len = Math.hypot(dx, dz);
  objects.push({ id: id(), type: 'wall', name: 'Perimeter wall', pos: [(a[0] + b[0]) / 2, 0, (a[1] + b[1]) / 2], rot: Math.atan2(-dz, dx), scale: [len, height, thick], color: '#9a9d97', solid: true, grounded: true, interact: 'none', group: '', text: '' });
}
function fence(name, points, height = 3) { objects.push({ id: id(), type: 'fence', name, pos: [0, 0, 0], rot: 0, points, height, spacing: 3, style: 'chainlink', color: '#9aa1a8', solid: true }); }
function path(name, points, width) { objects.push({ id: id(), type: 'path', name, pos: [0, 0, 0], rot: 0, points, width, color: '#2b2d30', smooth: true }); }
function light(x, z, offset = 5, extra = {}) { objects.push({ id: id(), type: 'light', pos: [x, offset, z], rot: 0, color: '#dfe8ff', intensity: 45, distance: 32, on: true, group: 'site', grounded: true, offset, ...extra }); }
function cylinder(name, cx, cz, dia, h, extra = {}) { objects.push({ id: id(), type: 'cylinder', name, pos: [cx, 0, cz], rot: 0, scale: [dia, h, dia], color: '#6e7480', solid: true, grounded: true, interact: 'none', group: '', text: '', half: false, ...extra }); }
const ellipse = (cx, cz, rx, rz, k = 28) => Array.from({ length: k + 1 }, (_, i) => { const a = i / k * Math.PI * 2; return [cx + Math.cos(a) * rx, cz + Math.sin(a) * rz]; });

// ---------------------------------------------------------------- 1–3  perimeter wall, towers, inner fence
const W = [[-154, -49], [-44, -130], [29, -189], [151, -191], [181, -130], [187, 73], [182, 143], [-118, 136], [-181, 77]];
// the south run (W6 -> W7) is split so the gatehouse (x -29..11) sits in the gap instead of having the wall run through it
const onSouth = (x) => [x, W[6][1] + (W[7][1] - W[6][1]) * ((W[6][0] - x) / (W[6][0] - W[7][0]))];
for (let i = 0; i < W.length; i++) {
  if (i === 6) { wallSeg(W[6], onSouth(12)); wallSeg(onSouth(-30), W[7]); }
  else wallSeg(W[i], W[(i + 1) % W.length]);
}
for (const [x, z] of W) {
  const t = hollow('Guard tower', x, z, 8, 12, 8, 0, '#7f837e');
  const toC = [10 - x, -20 - z];                                         // doorway on the face that looks into the compound
  doorway(t, Math.abs(toC[0]) > Math.abs(toC[1]) ? (toC[0] > 0 ? 'e' : 'w') : (toC[1] > 0 ? 's' : 'n'));
  light(x, z, 13, { color: '#fff4d6', intensity: 60, distance: 45, group: 'towers' });
}
const inner = W.map(([x, z]) => [Math.round((x - 10) * 0.955 + 10), Math.round((z + 20) * 0.955 - 20)]);
// the loop is broken at the gatehouse: start east of it (index 6 = SE corner) and run all the way round to the west side
fence('Inner fence', [[14, 134], inner[6], inner[5], inner[4], inner[3], inner[2], inner[1], inner[0], inner[8], inner[7], [-32, 133]]);

// ---------------------------------------------------------------- 4–6  gates and roads
const gatehouse = hollow('Gatehouse', -9, 139, 40, 7, 18, 0, '#8a8d88'); doorway(gatehouse, 'n', 0.45, 6, 4.5); doorway(gatehouse, 's', 0.45, 6, 4.5);
const innerGate = hollow('Inner gate', -2, 92, 16, 6, 17, 0, '#8a8d88'); doorway(innerGate, 'n', 0.25, 6, 4.2); doorway(innerGate, 's', 0.25, 6, 4.2);
path('Spine road', [[0, 160], [0, -65]], 6);
path('Entrance road', [[0, 160], [0, 185]], 8);
path('Entrance loop', [[-60, 205], [-60, 185], [60, 185], [60, 205]], 8);
path('West road', [[0, -45], [-60, -45]], 4);
path('Yard road', [[0, -60], [41, -60], [41, -125]], 4);
path('Middle road', [[0, -17], [36, -17]], 4);
path('Cell block road', [[0, 72], [60, 72]], 4);
path('South-west road', [[0, 108], [-40, 108]], 4);

// ---------------------------------------------------------------- 7–15  buildings
const admin = hollow('Admin', -26, -85, 34, 11, 63); doorway(admin, 'e');
const ne = hollow('North-east block', 133, -130, 34, 8, 90); doorway(ne, 'w');
const nw = hollow('North-west block', -80, -80, 76, 8, 20, deg(45)); doorway(nw, 's');
const west = hollow('West building', -113, -9, 66, 8, 56); doorway(west, 'e');
[[-106, 60], [-90, 76], [-74, 92]].forEach(([x, z], i) => { const b = hollow(`Cell block ${String.fromCharCode(65 + i)}`, x, z, 84, 8, 16, deg(45)); doorway(b, 'e'); });
const central = hollow('Central block', -22, 50, 20, 8, 66); doorway(central, 'e');
[72, 92, 112, 138].forEach((x, i) => { const b = hollow(`East block ${i + 1}`, x, 47, 16, 8, 40); doorway(b, 's'); });
const util = hollow('Utility', 73, 93, 109, 8, 26); doorway(util, 'n');
for (const x of [67, 78, 90, 101]) cylinder('Tank', x, 115, 12, 8, { color: '#9aa0a8' });

// ---------------------------------------------------------------- 9  yards
for (const [cx, cz, rx, rz, fx, fz] of [[78, -131, 30, 27, 34, 31], [88, -17, 45, 36, 50, 41]]) {
  cylinder('Yard dirt', cx, cz, 1, 0.12, { scale: [rx * 2, 0.12, rz * 2], color: '#8c7b5c', solid: false });
  fence('Yard fence', ellipse(cx, cz, fx, fz), 3.5);
  for (const [ax, az] of [[-0.55, -0.5], [0.55, -0.5], [-0.55, 0.5], [0.55, 0.5]]) light(cx + ax * rx, cz + az * rz, 6);
}

// ---------------------------------------------------------------- 17  huts and sheds
const huts = [
  [-62, -29, 17, 13, 'e'], [-62, 2, 17, 13, 'e'], [-22, -28, 23, 20, 'e', 7], [20, -40, 17, 23, 'w'], [24, 7, 15, 17, 'w'], [30, 30, 23, 13, 'w'], [30, 50, 23, 13, 'w'],
  [42, -163, 23, 12, 's'], [22, -140, 23, 15, 'w'], [22, -115, 21, 13, 'w'], [56, -92, 18, 13, 'w'], [98, -80, 20, 13, 's'], [126, -72, 20, 13, 's'], [160, -70, 20, 13, 's'],
];
huts.forEach(([x, z, w, d, face, h = 3.5], i) => { const b = hollow(`Hut ${i + 1}`, x, z, w, h, d); doorway(b, face); });
for (const [x, z] of [[149, -49], [151, -19], [149, 1]]) box('Shed', x, z, 17, 3, 12, 0, { color: '#7d8078' });

// ---------------------------------------------------------------- 18  street lights
for (let z = 150; z >= -60; z -= 30) light(7, z);
light(-55, -50, 5); light(-36, 112, 5); light(55, 76, 5); light(45, -128, 5); light(40, -21, 5);

// ---------------------------------------------------------------- 19  terrain + forest outside the wall
const SIZE = 600, SEG = 200, N = SEG + 1, step = SIZE / SEG;
// point-in-polygon (ray cast) for the wall outline, grown by a margin
const inside = (x, z, grow = 1) => {
  const P = W.map(([px, pz]) => [10 + (px - 10) * grow, -20 + (pz + 20) * grow]);
  let c = false;
  for (let i = 0, j = P.length - 1; i < P.length; j = i++) { const [xi, zi] = P[i], [xj, zj] = P[j]; if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) c = !c; }
  return c;
};
const noise = (x, z) => Math.sin(x * 0.031) * Math.cos(z * 0.027) + 0.5 * Math.sin(x * 0.073 + 1.3) * Math.sin(z * 0.061 + 0.4) + 0.25 * Math.sin(x * 0.17 + z * 0.11);
// how far a point is outside the wall polygon (0 inside)
const distOutside = (x, z) => {
  let best = Infinity;
  for (let i = 0, j = W.length - 1; i < W.length; j = i++) {
    const [ax, az] = W[j], [bx, bz] = W[i], dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2));
    best = Math.min(best, Math.hypot(x - (ax + t * dx), z - (az + t * dz)));
  }
  return inside(x, z) ? 0 : best;
};
const smooth = (a, b, v) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };
const heights = new Array(N * N);
for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
  const x = -SIZE / 2 + i * step, z = -SIZE / 2 + j * step, d = distOutside(x, z);
  // flat strip 12 m outside the wall, then the ground rolls up into hills; big hills further out
  const near = smooth(12, 60, d), far = smooth(60, 160, d);
  let h = near * (10 + 6 * noise(x, z)) + far * (30 + 14 * noise(x * 0.7 + 40, z * 0.7 - 25));
  const road = smooth(18, 4, Math.abs(x)) * smooth(120, 150, z) + smooth(215, 180, z) * smooth(160, 230, z) * smooth(85, 60, Math.abs(x));   // entrance road + loop stay level
  h *= 1 - Math.min(1, road);
  heights[j * N + i] = Math.round(Math.max(0, h) * 100) / 100;
}
let seed = 7; const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const trees = [];
for (let tries = 0; tries < 20000 && trees.length < 900; tries++) {
  const x = (rnd() - 0.5) * 580, z = (rnd() - 0.5) * 580;
  if (inside(x, z, 1.09)) continue;                                     // keep the forest 15 m or so off the wall
  if (Math.abs(x) < 14 && z > 140) continue;                            // entrance road
  if (z > 178 && z < 212 && Math.abs(x) < 70) continue;                 // entrance loop
  if (trees.some(t => (t[0] - x) ** 2 + (t[1] - z) ** 2 < 36)) continue;
  trees.push([x, z]);
}
for (const [x, z] of trees) {
  const j = Math.round((z + SIZE / 2) / step), i = Math.round((x + SIZE / 2) / step);
  objects.push({ id: id(), type: 'tree', pos: [x, heights[j * N + i], z], rot: rnd() * 6.28, scale: [0.8 + rnd() * 0.8, 0.9 + rnd() * 0.9, 0.8 + rnd() * 0.8], color: '#17301c', grounded: true });
}

// ---------------------------------------------------------------- world
const world = {
  version: 1, name: 'Prison',
  terrain: { size: SIZE, seg: SEG, heights },
  objects,
  spawn: { pos: [0, 0, 120], yaw: 0 },                // on the spine just inside the gatehouse, facing north (-z)
  settings: { time: 0.08, fog: 0.004, groundMode: 'highest' },
};
const out = join(dirname(fileURLToPath(import.meta.url)), 'prison.json');
writeFileSync(out, JSON.stringify(world));
console.log(`wrote ${out}: ${objects.length} objects (${trees.length} trees), terrain ${SIZE} m / ${SEG} seg`);
