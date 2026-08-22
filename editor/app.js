import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { World, DEFAULTS, TYPE_LABELS, starterWorld, emptyWorld, uid } from './world.js';

const $ = (id) => document.getElementById(id);
const clamp = THREE.MathUtils.clamp;

// =====================================================================
//  RENDERER / SCENE / SKY
// =====================================================================
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x0a0f1c, 0.006);
const hemi = new THREE.HemisphereLight(0x2f3c5c, 0x0c0f0c, 0.3); scene.add(hemi);
const sun = new THREE.DirectionalLight(0x93a8dc, 0.6); sun.position.set(-60, 90, -70); scene.add(sun);
const workLight = new THREE.HemisphereLight(0xdde6ff, 0x223322, 0.9); scene.add(workLight);   // editor-only so you can see what you build at night

const sky = new THREE.Group(); scene.add(sky);
let domeGeo, stars, moon;
{
  domeGeo = new THREE.SphereGeometry(620, 32, 16);
  domeGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(domeGeo.attributes.position.count * 3), 3));
  sky.add(new THREE.Mesh(domeGeo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false })));
  const n = 2000, pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { const th = Math.PI * 2 * Math.random(), ph = Math.acos(1 - Math.random()), r = 560; pos[i * 3] = r * Math.sin(ph) * Math.cos(th); pos[i * 3 + 1] = Math.max(8, r * Math.cos(ph)); pos[i * 3 + 2] = r * Math.sin(ph) * Math.sin(th); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  stars = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xcfd8ff, size: 1.6, sizeAttenuation: false, fog: false, transparent: true, opacity: 0.85, depthWrite: false })); sky.add(stars);
  moon = new THREE.Mesh(new THREE.SphereGeometry(14, 24, 24), new THREE.MeshBasicMaterial({ color: 0xe8ecf8, fog: false })); moon.position.set(-230, 360, -290); sky.add(moon);
}
const smooth01 = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
function applyTime(t) {   // 0 = midnight, 1 = noon
  const nightH = new THREE.Color(0x1b2440), nightZ = new THREE.Color(0x04060c), dayH = new THREE.Color(0xcfe0f5), dayZ = new THREE.Color(0x4f8fd8);
  const hz = nightH.clone().lerp(dayH, t), zn = nightZ.clone().lerp(dayZ, t);
  const col = domeGeo.attributes.color, p = domeGeo.attributes.position, c = new THREE.Color();
  for (let i = 0; i < p.count; i++) { c.copy(hz).lerp(zn, smooth01(-0.05, 0.5, p.getY(i) / 620)); col.setXYZ(i, c.r, c.g, c.b); }
  col.needsUpdate = true;
  stars.material.opacity = 0.85 * (1 - smooth01(0.05, 0.4, t));
  moon.visible = t < 0.5;
  hemi.intensity = 0.3 + t * 1.2; hemi.color.set(new THREE.Color(0x2f3c5c).lerp(new THREE.Color(0xbcd4ff), t));
  sun.intensity = 0.6 + t * 2.2; sun.color.set(new THREE.Color(0x93a8dc).lerp(new THREE.Color(0xfff2d6), t));
  scene.fog.color.set(new THREE.Color(0x0a0f1c).lerp(new THREE.Color(0xb9cbe0), t));
  scene.background = scene.fog.color;
}

// =====================================================================
//  WORLD + CAMERAS
// =====================================================================
const world = new World(scene);
const editCam = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 2000);
editCam.position.set(18, 14, 22);
const playCam = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.08, 1500);
scene.add(playCam);
let camera = editCam;

const orbit = new OrbitControls(editCam, renderer.domElement);
orbit.enableDamping = true; orbit.dampingFactor = 0.12;
orbit.mouseButtons = { LEFT: null, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.ROTATE };
orbit.maxPolarAngle = Math.PI * 0.495;
orbit.target.set(0, 0, 0);

const gizmo = new TransformControls(editCam, renderer.domElement);
gizmo.setSize(0.8);
scene.add(gizmo.getHelper());
gizmo.addEventListener('dragging-changed', (e) => { orbit.enabled = !e.value; if (!e.value && selected) { world.pullTransform(selected); refreshSelectionBox(); pushUndo(); renderPanel(); } });
gizmo.addEventListener('objectChange', () => { if (selected) { world.pullTransform(selected); refreshSelectionBox(); } });

const selBox = new THREE.BoxHelper(new THREE.Object3D(), 0xffd25a); selBox.visible = false; scene.add(selBox);
const brushRing = new THREE.Mesh(new THREE.RingGeometry(0.9, 1, 48), new THREE.MeshBasicMaterial({ color: 0xffd25a, side: THREE.DoubleSide, transparent: true, opacity: 0.8, depthTest: false }));
brushRing.rotation.x = -Math.PI / 2; brushRing.visible = false; brushRing.renderOrder = 10; scene.add(brushRing);
const pathPreview = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xffd25a, depthTest: false })); pathPreview.renderOrder = 10; scene.add(pathPreview);
const ghost = new THREE.Group(); scene.add(ghost);   // translucent preview of the thing about to be placed

// =====================================================================
//  EDITOR STATE
// =====================================================================
const ed = {
  tool: 'select', selectedId: null, brush: { radius: 8, strength: 0.35, mode: 'raise' }, treeBrush: { radius: 8, density: 0.5 },
  pathPoints: [], down: false, flattenTarget: 0, lastBrushAt: null, undo: [], redo: [], mode: 'edit',
};
let selected = null;
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();

function setTool(tool) {
  ed.tool = tool;
  if (tool !== 'select') select(null);
  ed.pathPoints = []; updatePathPreview();
  document.querySelectorAll('#tools button').forEach(b => b.classList.toggle('active', b.dataset.tool === tool));
  brushRing.visible = tool === 'terrain' || tool === 'treebrush';
  buildGhost();
  renderPanel(); updateHint();
}
function select(o) {
  selected = o; ed.selectedId = o?.id ?? null;
  if (o) { gizmo.attach(world.meshes.get(o.id)); selBox.visible = true; refreshSelectionBox(); }
  else { gizmo.detach(); selBox.visible = false; }
  renderPanel();
}
function refreshSelectionBox() { if (selected) { selBox.setFromObject(world.meshes.get(selected.id)); } }

function pointerRay(e) {
  const r = renderer.domElement.getBoundingClientRect();
  ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  raycaster.setFromCamera(ndc, editCam);
}
function hitWorld(e, includeObjects = true) {
  pointerRay(e);
  const targets = includeObjects ? world.group.children : [world.terrain];
  const hits = raycaster.intersectObjects(targets, true);
  for (const h of hits) {
    if (h.object === world.terrain) return { point: h.point, terrain: true };
    let o = h.object; while (o && !o.userData.id && !o.userData.spawn) o = o.parent;
    if (o?.userData.spawn) return { point: h.point, spawn: true };
    if (o?.userData.id) { const obj = world.getObject(o.userData.id); if (obj?.type === 'path') continue; return { point: h.point, object: obj }; }
  }
  return null;
}

// ---- ghost preview
function buildGhost() {
  ghost.clear();
  const placeTypes = ['box', 'wall', 'ramp', 'cylinder', 'sphere', 'door', 'light', 'tree'];
  if (!placeTypes.includes(ed.tool)) return;
  const tmp = new World(new THREE.Scene());
  const o = { id: 'ghost', type: ed.tool, pos: [0, 0, 0], rot: 0, ...structuredClone(DEFAULTS[ed.tool]) };
  const g = tmp.buildObject(o);
  g.traverse(m => { if (m.isMesh) { m.material = m.material.clone(); m.material.transparent = true; m.material.opacity = 0.45; m.castShadow = false; } if (m.isLight) m.intensity = 0; });
  g.position.y = o.grounded ? (o.offset || 0) : 0;
  ghost.add(g);
}

// =====================================================================
//  INPUT (editor)
// =====================================================================
const canvas = renderer.domElement;
canvas.addEventListener('pointerdown', (e) => {
  if (ed.mode !== 'edit' || e.button !== 0) return;
  if (gizmo.axis) return;                       // clicking the gizmo
  const hit = hitWorld(e, ed.tool === 'select' || ed.tool === 'spawn' || isPlaceTool());
  ed.down = true;
  switch (ed.tool) {
    case 'select': {
      if (hit?.object) select(hit.object);
      else if (hit?.spawn) { select(null); ed.tool = 'spawn'; setTool('spawn'); }
      else select(null);
      break;
    }
    case 'terrain': {
      if (!hit) break;
      ed.flattenTarget = world.sampleHeight(hit.point.x, hit.point.z);
      ed.lastBrushAt = null;
      sculptAt(hit.point);
      break;
    }
    case 'treebrush': { if (hit) scatterTrees(hit.point); break; }
    case 'path': {
      if (!hit) break;
      ed.pathPoints.push([hit.point.x, hit.point.z]); updatePathPreview();
      break;
    }
    case 'spawn': {
      if (!hit) break;
      pushUndo();
      world.data.spawn.pos = [hit.point.x, 0, hit.point.z];
      world.data.spawn.yaw = Math.atan2(editCam.position.x - hit.point.x, editCam.position.z - hit.point.z) + Math.PI; // face away from camera
      world.updateSpawnMarker(); toast('Spawn moved');
      break;
    }
    default: {
      if (!isPlaceTool() || !hit) break;
      placeObject(ed.tool, hit);
    }
  }
});
canvas.addEventListener('pointermove', (e) => {
  if (ed.mode !== 'edit') return;
  if (ed.tool === 'terrain' || ed.tool === 'treebrush' || isPlaceTool() || ed.tool === 'spawn') {
    const hit = hitWorld(e, isPlaceTool());
    if (hit) {
      brushRing.position.set(hit.point.x, hit.point.y + 0.1, hit.point.z);
      const r = ed.tool === 'terrain' ? ed.brush.radius : ed.treeBrush.radius; brushRing.scale.set(r, r, r);
      ghost.position.copy(hit.point); ghost.visible = true;
      if (ed.down && ed.tool === 'terrain') sculptAt(hit.point);
      if (ed.down && ed.tool === 'treebrush') scatterTrees(hit.point);
    } else ghost.visible = false;
  }
});
window.addEventListener('pointerup', () => {
  if (!ed.down) return;
  ed.down = false;
  if (ed.mode === 'edit' && (ed.tool === 'terrain')) { world.groundAll(); refreshSelectionBox(); pushUndo(); }
  if (ed.mode === 'edit' && ed.tool === 'treebrush') pushUndo();
});
canvas.addEventListener('dblclick', () => { if (ed.mode === 'edit' && ed.tool === 'path') finishPath(); });
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

const isPlaceTool = () => ['box', 'wall', 'ramp', 'cylinder', 'sphere', 'door', 'light', 'tree'].includes(ed.tool);

function placeObject(type, hit) {
  pushUndo();
  const def = { type, pos: [hit.point.x, hit.point.y, hit.point.z] };
  if (hit.terrain) def.grounded = true; else def.grounded = false;
  if (type === 'light') { def.grounded = hit.terrain; def.pos[1] = hit.point.y + (hit.terrain ? DEFAULTS.light.offset : 0.3); }
  if (type === 'tree') def.scale = [0.8 + Math.random() * 0.8, 0.8 + Math.random() * 0.8, 0.8 + Math.random() * 0.8];
  if (type === 'door' || type === 'wall') def.rot = Math.round(orbit.getAzimuthalAngle() / (Math.PI / 2)) * (Math.PI / 2);   // square to the view
  const o = world.addObject(def);
  if (o.grounded) { o.pos[1] = world.sampleHeight(o.pos[0], o.pos[2]) + (o.offset || 0); world.syncTransform(o); }
  ed.tool = 'select'; setTool('select'); select(o);
}
function sculptAt(p) {
  const b = ed.brush;
  if (ed.lastBrushAt && ed.lastBrushAt.distanceTo(p) < b.radius * 0.08) return;
  ed.lastBrushAt = p.clone();
  world.sculpt(p.x, p.z, b.radius, b.strength, b.mode, ed.flattenTarget);
}
function scatterTrees(p) {
  const tb = ed.treeBrush;
  if (ed.lastBrushAt && ed.lastBrushAt.distanceTo(p) < tb.radius * 0.5) return;
  ed.lastBrushAt = p.clone();
  const n = Math.max(1, Math.round(tb.density * tb.radius * 0.6));
  const trees = world.data.objects.filter(o => o.type === 'tree');
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * tb.radius;
    const x = p.x + Math.cos(a) * r, z = p.z + Math.sin(a) * r;
    if (trees.some(t => (t.pos[0] - x) ** 2 + (t.pos[2] - z) ** 2 < 4)) continue;
    const o = world.addObject({ type: 'tree', pos: [x, world.sampleHeight(x, z), z], rot: Math.random() * 6.28, scale: [0.8 + Math.random() * 0.8, 0.8 + Math.random() * 0.8, 0.8 + Math.random() * 0.8] });
    trees.push(o);
  }
}
function finishPath() {
  if (ed.pathPoints.length >= 2) {
    pushUndo();
    const o = world.addObject({ type: 'path', pos: [0, 0, 0], points: ed.pathPoints.slice() });
    ed.pathPoints = []; updatePathPreview(); toast('Path created');
    setTool('select'); select(o);
  } else { ed.pathPoints = []; updatePathPreview(); }
}
function updatePathPreview() {
  const pts = ed.pathPoints.map(([x, z]) => new THREE.Vector3(x, world.sampleHeight(x, z) + 0.3, z));
  pathPreview.geometry.dispose(); pathPreview.geometry = new THREE.BufferGeometry().setFromPoints(pts);
  pathPreview.visible = pts.length > 0;
}

// keys
const keys = {};
window.addEventListener('keydown', (e) => {
  keys[e.code] = true;
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
  if (ed.mode === 'play') { onPlayKey(e); return; }
  if (e.ctrlKey || e.metaKey) {
    if (e.code === 'KeyZ') { e.preventDefault(); undo(); }
    if (e.code === 'KeyS') { e.preventDefault(); saveLocal(); }
    if (e.code === 'KeyD' && selected) { e.preventDefault(); duplicateSelected(); }
    return;
  }
  switch (e.code) {
    case 'KeyQ': setTool('select'); break;
    case 'KeyT': setTool('terrain'); break;
    case 'KeyH': setTool('path'); break;
    case 'Digit1': gizmo.setMode('translate'); break;
    case 'Digit2': gizmo.setMode('rotate'); break;
    case 'Digit3': gizmo.setMode('scale'); break;
    case 'Delete': case 'Backspace': if (selected) deleteSelected(); break;
    case 'Escape': if (ed.tool === 'path' && ed.pathPoints.length) { ed.pathPoints = []; updatePathPreview(); } else { select(null); setTool('select'); } break;
    case 'Enter': if (ed.tool === 'path') finishPath(); break;
    case 'KeyF': if (selected) focusOn(world.meshes.get(selected.id).position); break;
    case 'KeyP': startPlay(false); break;
    case 'BracketLeft': adjustBrush(-1); break;
    case 'BracketRight': adjustBrush(1); break;
  }
});
window.addEventListener('keyup', (e) => { keys[e.code] = false; if (ed.mode === 'play' && e.code === 'KeyQ') aim.active = false; });
function adjustBrush(d) { const b = ed.tool === 'treebrush' ? ed.treeBrush : ed.brush; b.radius = clamp(b.radius + d * 1.5, 1, 60); renderPanel(); }
function focusOn(p) { const off = editCam.position.clone().sub(orbit.target); orbit.target.copy(p); editCam.position.copy(p).add(off.setLength(Math.min(off.length(), 25))); }
function deleteSelected() { pushUndo(); world.removeObject(selected.id); select(null); }
function duplicateSelected() {
  pushUndo();
  const copy = structuredClone(selected); copy.id = uid(); copy.pos = [copy.pos[0] + 1.5, copy.pos[1], copy.pos[2] + 1.5];
  if (copy.points) copy.points = copy.points.map(([x, z]) => [x + 3, z + 3]);
  world.data.objects.push(copy); world.buildObject(copy); select(copy);
}
// WASD fly for the editor camera
function flyCamera(dt) {
  if (ed.mode !== 'edit') return;
  const sp = (keys.ShiftLeft ? 40 : 16) * dt;
  const fwd = new THREE.Vector3(); editCam.getWorldDirection(fwd); fwd.y = 0; fwd.normalize();
  const right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0));
  const mv = new THREE.Vector3();
  if (keys.KeyW) mv.add(fwd); if (keys.KeyS) mv.sub(fwd); if (keys.KeyD) mv.add(right); if (keys.KeyA) mv.sub(right);
  if (keys.KeyE) mv.y += 1; if (keys.KeyC) mv.y -= 1;
  if (mv.lengthSq() === 0) return;
  mv.normalize().multiplyScalar(sp);
  editCam.position.add(mv); orbit.target.add(mv);
}

// =====================================================================
//  UNDO / SAVE / LOAD
// =====================================================================
function pushUndo() { ed.undo.push(JSON.stringify(world.serialize())); if (ed.undo.length > 40) ed.undo.shift(); }
function undo() {
  const s = ed.undo.pop(); if (!s) { toast('Nothing to undo'); return; }
  const id = ed.selectedId; select(null);
  world.load(JSON.parse(s)); applySettings();
  const o = world.getObject(id); if (o) select(o);
  toast('Undo');
}
function saveLocal() { world.data.name = $('worldName').value || 'Untitled'; localStorage.setItem('ns-world', JSON.stringify(world.serialize())); toast('Saved to browser'); }
function exportWorld() {
  world.data.name = $('worldName').value || 'Untitled';
  const blob = new Blob([JSON.stringify(world.serialize(), null, 1)], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${world.data.name.replace(/[^a-z0-9_-]+/gi, '_') || 'world'}.json`; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
function loadWorld(data) { select(null); ed.undo = []; world.load(data); $('worldName').value = world.data.name || ''; applySettings(); renderPanel(); }
function applySettings() { const s = world.data.settings; applyTime(s.time); scene.fog.density = s.fog; }
$('btnNew').addEventListener('click', () => { if (confirm('Start a new blank world? (unsaved changes are lost)')) loadWorld(emptyWorld()); });
$('btnStarter').addEventListener('click', () => { if (confirm('Load the sample world? (unsaved changes are lost)')) loadWorld(starterWorld()); });
$('btnSave').addEventListener('click', saveLocal);
$('btnExport').addEventListener('click', exportWorld);
$('btnImport').addEventListener('click', () => $('fileImport').click());
$('fileImport').addEventListener('change', async (e) => {
  const f = e.target.files[0]; if (!f) return;
  try { loadWorld(JSON.parse(await f.text())); toast(`Imported ${f.name}`); } catch (err) { alert('Could not read that file: ' + err.message); }
  e.target.value = '';
});
$('btnUndo').addEventListener('click', undo);
$('btnPlay').addEventListener('click', () => startPlay(false));
$('btnPlayHere').addEventListener('click', () => startPlay(true));
$('worldName').addEventListener('change', () => { world.data.name = $('worldName').value; });
document.querySelectorAll('#tools button').forEach(b => b.addEventListener('click', () => setTool(b.dataset.tool)));
let toastTimer;
function toast(t) { const el = $('toast'); el.textContent = t; el.style.opacity = 1; clearTimeout(toastTimer); toastTimer = setTimeout(() => el.style.opacity = 0, 1400); }

// =====================================================================
//  PROPERTIES PANEL
// =====================================================================
function el(tag, attrs = {}, children = []) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) { if (k === 'text') n.textContent = v; else if (k.startsWith('on')) n.addEventListener(k.slice(2), v); else n.setAttribute(k, v); }
  for (const c of children) n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  return n;
}
const field = (label, input) => el('div', { class: 'field' }, [el('label', { text: label }), input]);
function numInput(value, onChange, step = 0.1) { return el('input', { type: 'number', value: (+value).toFixed(2), step, onchange: (e) => onChange(parseFloat(e.target.value) || 0) }); }
function range(label, value, min, max, step, onInput, fmt = (v) => v) {
  const out = el('span', { class: 'val', text: fmt(value) });
  const inp = el('input', { type: 'range', min, max, step, value, oninput: (e) => { const v = parseFloat(e.target.value); out.textContent = fmt(v); onInput(v); } });
  return el('div', {}, [el('label', { text: label, style: 'color:#9aa;font-size:11px' }, [out]), inp]);
}
function renderPanel() {
  const root = $('panelContent'); root.innerHTML = '';
  if (ed.tool === 'terrain') {
    root.appendChild(el('h3', { text: 'TERRAIN BRUSH' }));
    const modes = el('div', { class: 'row2' });
    for (const m of ['raise', 'lower', 'smooth', 'flatten']) modes.appendChild(el('button', { text: m.toUpperCase(), class: ed.brush.mode === m ? 'active' : '', onclick: () => { ed.brush.mode = m; renderPanel(); } }));
    root.appendChild(modes);
    root.appendChild(range('Radius', ed.brush.radius, 1, 60, 0.5, (v) => ed.brush.radius = v, (v) => v + ' m'));
    root.appendChild(range('Strength', ed.brush.strength, 0.05, 2, 0.05, (v) => ed.brush.strength = v));
    root.appendChild(el('div', { class: 'note', text: 'Click-drag on the ground. [ ] changes radius. Flatten levels to the height where you started the stroke. Objects and paths re-snap to the new ground when you release.' }));
  } else if (ed.tool === 'treebrush') {
    root.appendChild(el('h3', { text: 'TREE BRUSH' }));
    root.appendChild(range('Radius', ed.treeBrush.radius, 2, 40, 0.5, (v) => ed.treeBrush.radius = v, (v) => v + ' m'));
    root.appendChild(range('Density', ed.treeBrush.density, 0.1, 2, 0.1, (v) => ed.treeBrush.density = v));
    root.appendChild(el('div', { class: 'note', text: 'Click-drag to scatter trees. Select + Delete removes one; select and Ctrl+D duplicates.' }));
  } else if (ed.tool === 'path') {
    root.appendChild(el('h3', { text: 'PATH' }));
    root.appendChild(el('div', { class: 'note', text: `Click points on the ground (${ed.pathPoints.length} so far). Double-click or Enter to finish, Esc to cancel. The path follows the terrain; you can change its width after.` }));
  } else if (ed.tool === 'spawn') {
    root.appendChild(el('h3', { text: 'SPAWN POINT' }));
    root.appendChild(el('div', { class: 'note', text: 'Click on the ground to move where the guard starts. He faces away from the camera.' }));
    root.appendChild(range('Facing', world.data.spawn.yaw, -3.14, 3.14, 0.05, (v) => { world.data.spawn.yaw = v; world.updateSpawnMarker(); }, (v) => v.toFixed(2)));
  } else if (selected) renderObjectPanel(root, selected);
  else {
    root.appendChild(el('h3', { text: 'SELECT' }));
    root.appendChild(el('div', { class: 'note', text: 'Click an object to select it. 1/2/3 = move / rotate / scale gizmo. Delete removes, Ctrl+D duplicates, F frames it. Right-drag orbits, middle-drag pans, wheel zooms, WASD + E/C fly.' }));
    root.appendChild(el('div', { class: 'note', text: `${world.data.objects.length} objects in this world.` }));
  }
  // world settings
  const s = world.data.settings;
  const sec = el('div', { class: 'sec' }, [el('h3', { text: 'WORLD' })]);
  sec.appendChild(range('Time of day', s.time, 0, 1, 0.01, (v) => { s.time = v; applyTime(v); }, (v) => v < 0.15 ? 'night' : v < 0.5 ? 'dusk' : 'day'));
  sec.appendChild(range('Fog', s.fog, 0, 0.03, 0.0005, (v) => { s.fog = v; scene.fog.density = v; }, (v) => v.toFixed(4)));
  sec.appendChild(el('div', { class: 'note', text: 'Worlds autosave to this browser every 30 s. EXPORT downloads a .json you can keep or send; IMPORT loads one.' }));
  root.appendChild(sec);
}
function renderObjectPanel(root, o) {
  root.appendChild(el('h3', { text: (TYPE_LABELS[o.type] || o.type).toUpperCase() }));
  const apply = (rebuild = false) => { if (rebuild) world.rebuildObject(o.id); else world.syncTransform(o); if (o.grounded) { o.pos[1] = world.sampleHeight(o.pos[0], o.pos[2]) + (o.offset || 0); world.syncTransform(o); } gizmo.attach(world.meshes.get(o.id)); refreshSelectionBox(); pushUndo(); };
  root.appendChild(field('Name', el('input', { type: 'text', value: o.name || '', onchange: (e) => { o.name = e.target.value; } })));
  if (o.type !== 'path') {
    const pos = el('div', { class: 'row3' }, [0, 1, 2].map(i => numInput(o.pos[i], (v) => { o.pos[i] = v; if (i === 1) o.grounded = false; apply(); })));
    root.appendChild(field('Position', pos));
    root.appendChild(field('Rotation °', numInput(THREE.MathUtils.radToDeg(o.rot || 0), (v) => { o.rot = THREE.MathUtils.degToRad(v); apply(); }, 5)));
    if (o.scale && o.type !== 'light') {
      const sc = el('div', { class: 'row3' }, [0, 1, 2].map(i => numInput(o.scale[i], (v) => { o.scale[i] = Math.max(0.05, v); apply(); })));
      root.appendChild(field(o.type === 'door' ? 'W / H / thick' : 'Size', sc));
    }
    root.appendChild(field('On ground', el('input', { type: 'checkbox', ...(o.grounded ? { checked: '' } : {}), onchange: (e) => { o.grounded = e.target.checked; apply(o.type === 'light'); } })));
  }
  if (o.color !== undefined) root.appendChild(field('Color', el('input', { type: 'color', value: o.color, oninput: (e) => { o.color = e.target.value; }, onchange: () => apply(true) })));
  if (o.solid !== undefined) root.appendChild(field('Solid', el('input', { type: 'checkbox', ...(o.solid ? { checked: '' } : {}), onchange: (e) => { o.solid = e.target.checked; pushUndo(); } })));
  if (o.interact !== undefined) {
    const sel = el('select', { onchange: (e) => { o.interact = e.target.value; pushUndo(); renderPanel(); } });
    for (const [v, l] of [['none', 'None'], ['pickup', 'Pick up (goes to inventory)'], ['switch', 'Light switch (toggles group)'], ['note', 'Show a message']]) sel.appendChild(el('option', { value: v, text: l, ...(o.interact === v ? { selected: '' } : {}) }));
    root.appendChild(field('Interact', sel));
    if (o.interact === 'switch') root.appendChild(field('Light group', el('input', { type: 'text', value: o.group || '', onchange: (e) => { o.group = e.target.value; } })));
    if (o.interact === 'note') root.appendChild(field('Message', el('input', { type: 'text', value: o.text || '', onchange: (e) => { o.text = e.target.value; } })));
    if (o.interact === 'pickup') root.appendChild(el('div', { class: 'note', text: 'Name above is what shows in the inventory; a door with the same Key name unlocks with it.' }));
  }
  if (o.type === 'door') {
    root.appendChild(field('Bars', el('input', { type: 'checkbox', ...(o.bars ? { checked: '' } : {}), onchange: (e) => { o.bars = e.target.checked; apply(true); } })));
    root.appendChild(field('Locked', el('input', { type: 'checkbox', ...(o.locked ? { checked: '' } : {}), onchange: (e) => { o.locked = e.target.checked; pushUndo(); } })));
    root.appendChild(field('Key name', el('input', { type: 'text', value: o.keyName || '', onchange: (e) => { o.keyName = e.target.value; } })));
  }
  if (o.type === 'light') {
    root.appendChild(range('Intensity', o.intensity, 0, 120, 1, (v) => { o.intensity = v; world.rebuildObject(o.id); gizmo.attach(world.meshes.get(o.id)); }));
    root.appendChild(range('Range', o.distance, 2, 80, 1, (v) => { o.distance = v; world.rebuildObject(o.id); gizmo.attach(world.meshes.get(o.id)); }, (v) => v + ' m'));
    root.appendChild(range('Height', o.offset, 0, 12, 0.1, (v) => { o.offset = v; if (o.grounded) o.pos[1] = world.sampleHeight(o.pos[0], o.pos[2]) + v; world.rebuildObject(o.id); gizmo.attach(world.meshes.get(o.id)); refreshSelectionBox(); }, (v) => v + ' m'));
    root.appendChild(field('On', el('input', { type: 'checkbox', ...(o.on ? { checked: '' } : {}), onchange: (e) => { world.setLight(o.id, e.target.checked); pushUndo(); } })));
    root.appendChild(field('Group', el('input', { type: 'text', value: o.group || '', onchange: (e) => { o.group = e.target.value; } })));
    root.appendChild(el('div', { class: 'note', text: 'A switch with the same group name toggles this light in play mode.' }));
  }
  if (o.type === 'path') {
    root.appendChild(range('Width', o.width, 0.5, 12, 0.25, (v) => { o.width = v; world.rebuildObject(o.id); refreshSelectionBox(); }, (v) => v + ' m'));
    root.appendChild(el('div', { class: 'note', text: `${o.points.length} points. Delete and redraw to change the route.` }));
  }
  const actions = el('div', { class: 'row2', style: 'margin-top:10px' }, [
    el('button', { text: 'DUPLICATE', onclick: duplicateSelected }),
    el('button', { text: 'DELETE', onclick: deleteSelected }),
  ]);
  root.appendChild(actions);
}
function updateHint() {
  const h = {
    select: 'Click to select · 1/2/3 gizmo mode · Del delete · Ctrl+D duplicate · F frame · Ctrl+Z undo · P play',
    terrain: 'Click-drag to sculpt · [ ] brush size · release to re-snap objects',
    path: 'Click points · double-click / Enter to finish · Esc cancel',
    treebrush: 'Click-drag to scatter trees · [ ] brush size',
    spawn: 'Click the ground to place the spawn point',
  }[ed.tool] || 'Click on the ground (or on an object) to place · Esc back to select';
  $('hint').textContent = h + '  ·  right-drag orbit · middle-drag pan · wheel zoom · WASD E/C fly';
}

// =====================================================================
//  PLAY MODE — the guard
// =====================================================================
const plc = new PointerLockControls(playCam, renderer.domElement);
const player = { pos: new THREE.Vector3(), vel: new THREE.Vector3(), radius: 0.38, height: 1.62, feet: 0, bob: 0, inventory: [] };
const flashPivot = new THREE.Group(); playCam.add(flashPivot);
const flashlight = new THREE.SpotLight(0xfff3d9, 0, 38, 0.58, 0.75, 1.7);
flashlight.target.position.set(0, 0, -1); flashlight.castShadow = true; flashlight.shadow.mapSize.set(1024, 1024); flashlight.shadow.camera.far = 38; flashlight.shadow.bias = -0.0025;
flashPivot.add(flashlight, flashlight.target);
const aim = { active: false, yaw: 0, pitch: 0, limit: 1.1 };
let flashOn = true, focused = null, msgTimer = 0, colliders = [];
window.addEventListener('mousedown', (e) => { if (ed.mode === 'play' && e.button === 2 && plc.isLocked) aim.active = true; });
window.addEventListener('mouseup', (e) => { if (e.button === 2) aim.active = false; });
window.addEventListener('mousemove', (e) => {
  if (ed.mode !== 'play' || !plc.isLocked || !aim.active) return;
  aim.yaw = clamp(aim.yaw - (e.movementX || 0) * 0.0022, -aim.limit, aim.limit);
  aim.pitch = clamp(aim.pitch - (e.movementY || 0) * 0.0022, -aim.limit * 0.8, aim.limit * 0.8);
  e.stopImmediatePropagation();
}, true);
function onPlayKey(e) {
  if (e.code === 'KeyF') tryInteract();
  if (e.code === 'KeyL') { flashOn = !flashOn; flashlight.intensity = flashOn ? 70 : 0; }
  if (e.code === 'KeyQ') aim.active = true;
}
function startPlay(here) {
  if (ed.mode === 'play') return;
  const s = world.data.spawn;
  let x = s.pos[0], z = s.pos[2], yaw = s.yaw;
  if (here) { x = orbit.target.x; z = orbit.target.z; const d = new THREE.Vector3(); editCam.getWorldDirection(d); yaw = Math.atan2(-d.x, -d.z); }
  player.pos.set(x, 0, z); player.vel.set(0, 0, 0); player.inventory = []; renderInventory();
  player.feet = world.standHeight(x, z, world.sampleHeight(x, z));
  playCam.rotation.set(0, yaw, 0, 'YXZ');
  playCam.position.set(x, player.feet + player.height, z);
  ed.mode = 'play'; camera = playCam; workLight.visible = false;
  select(null); world.spawnMarker.visible = false; brushRing.visible = false; ghost.visible = false; pathPreview.visible = false; orbit.enabled = false;
  flashlight.intensity = flashOn ? 70 : 0;
  colliders = world.colliders();
  document.body.classList.add('playing');
  $('clickToPlay').classList.add('show');
  plc.lock();
}
function stopPlay() {
  if (ed.mode !== 'play') return;
  ed.mode = 'edit'; camera = editCam; workLight.visible = true;
  document.body.classList.remove('playing'); $('clickToPlay').classList.remove('show');
  world.spawnMarker.visible = true; orbit.enabled = true; flashlight.intensity = 0; aim.active = false;
  setTool(ed.tool);
  // reset runtime state so the next play starts fresh
  for (const o of world.data.objects) { if (o.type === 'door') world.setDoor(o.id, false); }
  for (const o of world.data.objects) if (o.type === 'light' && o._wasOn !== undefined) { world.setLight(o.id, o._wasOn); delete o._wasOn; }
  for (const id of [...world.meshes.keys()]) if (!world.getObject(id)) world.removeObject(id, false);
  for (const o of world.data.objects) if (o._hidden) { delete o._hidden; world.buildObject(o); }
}
$('clickToPlay').addEventListener('click', () => plc.lock());
plc.addEventListener('lock', () => $('clickToPlay').classList.remove('show'));
plc.addEventListener('unlock', () => { if (ed.mode === 'play') stopPlay(); });

function pushOutOBB(pos, c, r) {
  const cos = Math.cos(-c.rot), sin = Math.sin(-c.rot);
  const dx = pos.x - c.cx, dz = pos.z - c.cz;
  const lx = dx * cos - dz * sin, lz = dx * sin + dz * cos;
  const nx = clamp(lx, -c.hx, c.hx), nz = clamp(lz, -c.hz, c.hz);
  let ox = lx - nx, oz = lz - nz; const d = Math.hypot(ox, oz);
  if (d >= r) return;
  if (d < 1e-5) { const px = c.hx - Math.abs(lx), pz = c.hz - Math.abs(lz); if (px < pz) ox = Math.sign(lx || 1) * (px + r); else oz = Math.sign(lz || 1) * (pz + r); }
  else { ox *= (r - d) / d; oz *= (r - d) / d; }
  const wc = Math.cos(c.rot), ws = Math.sin(c.rot);
  pos.x += ox * wc - oz * ws; pos.z += ox * ws + oz * wc;
}
function updatePlayer(dt) {
  const fwd = new THREE.Vector3(); playCam.getWorldDirection(fwd); fwd.y = 0; fwd.normalize();
  const right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0));
  const wish = new THREE.Vector3();
  if (plc.isLocked) { if (keys.KeyW) wish.add(fwd); if (keys.KeyS) wish.sub(fwd); if (keys.KeyD) wish.add(right); if (keys.KeyA) wish.sub(right); }
  const running = keys.ShiftLeft || keys.ShiftRight;
  if (wish.lengthSq() > 0) wish.normalize().multiplyScalar(running ? 6.4 : 3.8);
  player.vel.lerp(wish, 1 - Math.exp(-dt * 10));
  const before = player.pos.clone();
  player.pos.addScaledVector(player.vel, dt);
  // doors change, so refresh colliders each frame (cheap for editor-sized worlds)
  colliders = world.colliders();
  for (let i = 0; i < 2; i++) for (const c of colliders) {
    if (Math.abs(c.cx - player.pos.x) > c.hx + c.hz + 3 || Math.abs(c.cz - player.pos.z) > c.hx + c.hz + 3) continue;
    if (c.top <= player.feet + 0.55 || c.bottom > player.feet + player.height) continue;   // step onto low things / walk under high things
    pushOutOBB(player.pos, c, player.radius);
  }
  const moved = player.pos.distanceTo(before), speed = moved / Math.max(dt, 1e-4);
  const target = world.standHeight(player.pos.x, player.pos.z, player.feet);
  player.feet += (target - player.feet) * Math.min(1, dt * 12);
  player.bob += dt * (running ? 11 : 8) * Math.min(1, speed / 3);
  playCam.position.set(player.pos.x, player.feet + player.height + Math.sin(player.bob) * 0.035 * Math.min(1, speed / 3), player.pos.z);
  sky.position.set(player.pos.x, 0, player.pos.z);
  if (!aim.active) { const k = 1 - Math.exp(-dt * 7); aim.yaw -= aim.yaw * k; aim.pitch -= aim.pitch * k; }
  flashPivot.rotation.set(aim.pitch, aim.yaw, 0, 'YXZ');
}
const pr = new THREE.Raycaster(); pr.far = 3.2;
function findFocus() {
  pr.setFromCamera(new THREE.Vector2(0, 0), playCam);
  const hits = pr.intersectObjects(world.group.children, true);
  for (const h of hits) {
    if (h.object === world.terrain) return null;
    let o = h.object; while (o && !o.userData.id) o = o.parent;
    const obj = o && world.getObject(o.userData.id); if (!obj) continue;
    if (obj.type === 'door' || obj.type === 'light' || (obj.interact && obj.interact !== 'none')) return obj;
    return null;   // something solid but inert is in the way
  }
  return null;
}
function promptFor(o) {
  if (o.type === 'door') { const d = world.doorState(o.id); if (o.locked) return player.inventory.includes(o.keyName) ? `Unlock ${o.name || 'door'}` : `${o.name || 'Door'} (locked — needs ${o.keyName})`; return `${d.open ? 'Close' : 'Open'} ${o.name || 'door'}`; }
  if (o.type === 'light') return `Turn ${o.on ? 'off' : 'on'} ${o.name || 'light'}`;
  if (o.interact === 'pickup') return `Pick up ${o.name || 'item'}`;
  if (o.interact === 'switch') return `Flip switch${o.group ? ` (${o.group})` : ''}`;
  if (o.interact === 'note') return `Look at ${o.name || 'it'}`;
  return 'Interact';
}
function tryInteract() {
  if (!focused) return;
  const o = focused;
  if (o.type === 'door') {
    if (o.locked) { if (player.inventory.includes(o.keyName)) { o.locked = false; o._unlockedInPlay = true; message(`Unlocked with the ${o.keyName}.`); } else { message(`Locked. You need the ${o.keyName}.`); return; } }
    const d = world.doorState(o.id); world.setDoor(o.id, !d.open);
  } else if (o.type === 'light') { if (o._wasOn === undefined) o._wasOn = o.on; world.setLight(o.id, !o.on); }
  else if (o.interact === 'pickup') { player.inventory.push(o.name || 'item'); renderInventory(); message(`Picked up ${o.name || 'item'}.`); o._hidden = true; world.removeObject(o.id, false); }
  else if (o.interact === 'switch') { const ls = world.data.objects.filter(l => l.type === 'light' && (l.group || '') === (o.group || '')); const on = !ls.some(l => l.on); for (const l of ls) { if (l._wasOn === undefined) l._wasOn = l.on; world.setLight(l.id, on); } message(ls.length ? `Lights ${on ? 'on' : 'off'}.` : 'Click. Nothing is wired to this switch.'); }
  else if (o.interact === 'note') message(o.text || '…');
  focused = null;
}
function message(t, s = 3) { $('message').textContent = t; $('message').style.opacity = 1; msgTimer = s; }
function renderInventory() { $('inventoryText').innerHTML = player.inventory.length ? player.inventory.map(k => `<span>▪ ${k}</span>`).join('') : '— empty —'; }

// =====================================================================
//  BOOT + LOOP
// =====================================================================
{
  const saved = localStorage.getItem('ns-world');
  let data = null;
  if (saved) { try { data = JSON.parse(saved); } catch { data = null; } }
  loadWorld(data || starterWorld());
  setTool('select');
  setInterval(() => { if (ed.mode === 'edit') { world.data.name = $('worldName').value || world.data.name; localStorage.setItem('ns-world', JSON.stringify(world.serialize())); } }, 30000);
}
window.addEventListener('resize', () => {
  if (!innerWidth || !innerHeight) return;
  for (const c of [editCam, playCam]) { c.aspect = innerWidth / innerHeight; c.updateProjectionMatrix(); }
  renderer.setSize(innerWidth, innerHeight);
});
window.__editor = { world, ed, select, setTool, startPlay, stopPlay, player, playCam, editCam, orbit, plc, gizmo, frame: () => frame(), pushUndo, undo, loadWorld, starterWorld };

const clock = new THREE.Clock();
function animate() { requestAnimationFrame(animate); frame(); }
function frame() {
  const dt = Math.min(clock.getDelta(), 0.05);
  world.updateDoors(dt);
  if (ed.mode === 'play') {
    updatePlayer(dt);
    focused = plc.isLocked ? findFocus() : null;
    const p = $('prompt');
    if (focused) { p.innerHTML = `<b>[F]</b> ${promptFor(focused)}`; p.style.opacity = 1; } else p.style.opacity = 0;
    if (msgTimer > 0) { msgTimer -= dt; if (msgTimer <= 0) $('message').style.opacity = 0; }
  } else {
    flyCamera(dt);
    orbit.update();
    sky.position.set(editCam.position.x, 0, editCam.position.z);
    if (selected) refreshSelectionBox();
  }
  renderer.render(scene, camera);
}
animate();
