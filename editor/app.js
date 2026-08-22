import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { World, DEFAULTS, TYPE_LABELS, HOLLOW_TYPES, LINE_TYPES, starterWorld, emptyWorld, uid } from './world.js';

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
renderer.localClippingEnabled = true;   // hollows clip their roofs off in the cutaway view
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
// editor preferences (per browser, not part of the world file)
const prefs = Object.assign({ orbitSpeed: 1, lookSpeed: 1 }, JSON.parse(localStorage.getItem('ns-editor-prefs') || '{}'));
function applyPrefs() { orbit.rotateSpeed = prefs.orbitSpeed; orbit.panSpeed = Math.max(0.5, prefs.orbitSpeed); localStorage.setItem('ns-editor-prefs', JSON.stringify(prefs)); }
applyPrefs();

const gizmo = new TransformControls(editCam, renderer.domElement);
gizmo.setSize(0.8);
scene.add(gizmo.getHelper());
// dragging the Y arrow (or a plane that includes Y) lifts a grounded object off the ground
const gizmoLifting = () => gizmo.mode === 'translate' && /Y/.test(gizmo.axis || '') && gizmo.axis !== 'XYZ';
gizmo.addEventListener('dragging-changed', (e) => { orbit.enabled = !e.value; if (!e.value && selected) { world.pullTransform(selected, gizmoLifting(), true); gizmo.attach(world.meshes.get(selected.id)); refreshSelectionBox(); pushUndo(); renderPanel(); } });
gizmo.addEventListener('objectChange', () => { if (selected) { world.pullTransform(selected, gizmoLifting()); refreshSelectionBox(); } });
function setGizmoMode(mode) {
  gizmo.setMode(mode);
  // only yaw is stored, so hide the X/Z rotation rings — they were easy to grab by mistake and did nothing useful
  gizmo.showX = gizmo.showZ = mode !== 'rotate';
}
function setGizmoSnap(on) { gizmo.setRotationSnap(on ? THREE.MathUtils.degToRad(15) : null); gizmo.setTranslationSnap(on ? 0.5 : null); gizmo.setScaleSnap(on ? 0.25 : null); }

const selBox = new THREE.BoxHelper(new THREE.Object3D(), 0xffd25a); selBox.visible = false; scene.add(selBox);
const brushRing = new THREE.Mesh(new THREE.RingGeometry(0.9, 1, 48), new THREE.MeshBasicMaterial({ color: 0xffd25a, side: THREE.DoubleSide, transparent: true, opacity: 0.8, depthTest: false }));
brushRing.rotation.x = -Math.PI / 2; brushRing.visible = false; brushRing.renderOrder = 10; scene.add(brushRing);
const pathPreview = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xffd25a, depthTest: false })); pathPreview.renderOrder = 10; scene.add(pathPreview);
const ghost = new THREE.Group(); scene.add(ghost);   // translucent preview of the thing about to be placed

// map border + four edge handles you can drag to grow/shrink the terrain (the map stays centred on the origin)
const mapEdge = new THREE.Group(); scene.add(mapEdge);
const edgeLine = new THREE.LineLoop(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xffd25a, transparent: true, opacity: 0.7 })); mapEdge.add(edgeLine);
const edgeHandles = [];
for (const [ax, sign] of [['x', 1], ['x', -1], ['z', 1], ['z', -1]]) {
  const h = new THREE.Mesh(new THREE.BoxGeometry(1, 0.35, 1), new THREE.MeshBasicMaterial({ color: 0xffd25a, transparent: true, opacity: 0.85 }));
  h.userData.edge = { ax, sign }; mapEdge.add(h); edgeHandles.push(h);
}
function updateMapEdge(size = world.data.terrain.size) {
  const half = size / 2, pts = [], n = 24;
  const hAt = (x, z) => world.sampleHeight(x, z) + 0.3;
  for (let i = 0; i < n; i++) pts.push(new THREE.Vector3(-half + (i / n) * size, 0, -half));
  for (let i = 0; i < n; i++) pts.push(new THREE.Vector3(half, 0, -half + (i / n) * size));
  for (let i = 0; i < n; i++) pts.push(new THREE.Vector3(half - (i / n) * size, 0, half));
  for (let i = 0; i < n; i++) pts.push(new THREE.Vector3(-half, 0, half - (i / n) * size));
  for (const p of pts) p.y = hAt(p.x, p.z);
  edgeLine.geometry.dispose(); edgeLine.geometry = new THREE.BufferGeometry().setFromPoints(pts);
  const s = clamp(size * 0.02, 1.5, 14);
  for (const h of edgeHandles) {
    const { ax, sign } = h.userData.edge;
    const x = ax === 'x' ? sign * half : 0, z = ax === 'z' ? sign * half : 0;
    h.position.set(x, hAt(x, z), z); h.scale.set(ax === 'x' ? s * 0.5 : s * 2, 1, ax === 'z' ? s * 0.5 : s * 2);
  }
}
function hitEdgeHandle(e) { if (!mapEdge.visible) return null; pointerRay(e); mapEdge.updateMatrixWorld(true); return raycaster.intersectObjects(edgeHandles)[0]?.object || null; }

// =====================================================================
//  EDITOR STATE
// =====================================================================
const ed = {
  tool: 'select', selectedId: null, brush: { radius: 8, strength: 0.35, mode: 'raise' }, treeBrush: { radius: 8, density: 0.5 },
  pathPoints: [], down: false, flattenTarget: 0, lastBrushAt: null, undo: [], redo: [], mode: 'edit',
  placeRot: 0,   // extra yaw applied to the placement ghost (R / Shift+R / , / . while a place tool is active)
  edgeDrag: null,   // { ax, size } while a map-edge handle is being dragged
};
let selected = null;
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();

function setTool(tool) {
  ed.tool = tool;
  if (tool !== 'select') select(null);
  ed.pathPoints = []; updatePathPreview(); ed.placeRot = 0;
  document.querySelectorAll('#tools button').forEach(b => b.classList.toggle('active', b.dataset.tool === tool));
  brushRing.visible = tool === 'terrain' || tool === 'treebrush';
  buildGhost();
  renderPanel(); updateHint();
}
// `selected` is the primary (the gizmo sits on it); extraSel holds the others added with Shift+click
const extraSel = new Set();
const extraBoxes = [];
function select(o, add = false) {
  if (add && o) {
    if (selected && selected.id === o.id) { const next = [...extraSel][0]; extraSel.delete(next); selected = next ? world.getObject(next) : null; }   // shift-click the primary: drop it
    else if (extraSel.has(o.id)) extraSel.delete(o.id);
    else { if (selected) extraSel.add(selected.id); selected = o; }
  } else { extraSel.clear(); selected = o; }
  ed.selectedId = selected?.id ?? null;
  if (selected) { gizmo.attach(world.meshes.get(selected.id)); selBox.visible = true; }
  else { gizmo.detach(); selBox.visible = false; }
  refreshSelectionBox();
  renderPanel();
}
const selectedObjects = () => [selected, ...[...extraSel].map(id => world.getObject(id))].filter(Boolean);
function refreshSelectionBox() {
  if (selected) selBox.setFromObject(world.meshes.get(selected.id));
  const ids = [...extraSel];
  while (extraBoxes.length < ids.length) { const b = new THREE.BoxHelper(new THREE.Object3D(), 0xffa03a); scene.add(b); extraBoxes.push(b); }
  extraBoxes.forEach((b, i) => { const g = ids[i] && world.meshes.get(ids[i]); b.visible = !!g; if (g) b.setFromObject(g); });
}

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
    if (o?.userData.id) {
      const obj = world.getObject(o.userData.id); if (obj?.type === 'path') continue;
      if (obj?.type === 'hollow' && world.hideRoofs && h.point.y > o.userData.roofCut) continue;   // clicks pass through the cut-away roof
      const normal = h.face ? h.face.normal.clone().transformDirection(h.object.matrixWorld) : null;
      return { point: h.point, object: obj, normal };
    }
  }
  return null;
}

// ---- ghost preview
function buildGhost() {
  ghost.clear();
  if (!isPlaceTool()) return;
  const tmp = new World(new THREE.Scene());
  const o = { id: 'ghost', type: ed.tool, pos: [0, 0, 0], rot: 0, ...structuredClone(DEFAULTS[ed.tool]) };
  const g = tmp.buildObject(o);
  g.traverse(m => { if (m.isMesh) { m.material = m.material.clone(); m.material.transparent = true; m.material.opacity = 0.45; m.castShadow = false; } if (m.isLight) m.intensity = 0; });
  g.position.y = o.grounded ? (o.offset || 0) : 0;
  ghost.add(g);
}
// doors and walls start square to the view; everything else starts at 0. placeRot is added on top.
const placeBaseRot = () => (ed.tool === 'door' || ed.tool === 'wall') ? Math.round(orbit.getAzimuthalAngle() / (Math.PI / 2)) * (Math.PI / 2) : 0;
const placeRot = () => placeBaseRot() + ed.placeRot;

// =====================================================================
//  INPUT (editor)
// =====================================================================
const canvas = renderer.domElement;
canvas.addEventListener('pointerdown', (e) => {
  if (ed.mode !== 'edit' || e.button !== 0) return;
  if (gizmo.axis) return;                       // clicking the gizmo
  const handle = hitEdgeHandle(e);              // map-edge handles win over everything (any tool)
  if (handle) { ed.down = true; ed.edgeDrag = { ax: handle.userData.edge.ax, size: world.data.terrain.size }; select(null); return; }
  const hit = hitWorld(e, ed.tool === 'select' || ed.tool === 'spawn' || isPlaceTool());
  ed.down = true;
  switch (ed.tool) {
    case 'select': {
      if (hit?.object) select(hit.object, e.shiftKey);
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
    case 'path': case 'fence': {
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
      placeObject(ed.tool, hit, e);
    }
  }
});
canvas.addEventListener('pointermove', (e) => {
  if (ed.mode !== 'edit') return;
  if (ed.edgeDrag) {
    // pull the edge: the map stays centred, so the new size is twice the cursor's distance from the middle
    pointerRay(e);
    const p = new THREE.Vector3();
    if (raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), p)) {
      ed.edgeDrag.size = Math.round(clamp(Math.abs(p[ed.edgeDrag.ax]) * 2, 40, 2000) / 10) * 10;
      updateMapEdge(ed.edgeDrag.size); $('hint').textContent = `Map size: ${ed.edgeDrag.size} × ${ed.edgeDrag.size} m — release to apply`;
    }
    return;
  }
  if (!ed.down) { const h = hitEdgeHandle(e); canvas.style.cursor = h ? (h.userData.edge.ax === 'x' ? 'ew-resize' : 'ns-resize') : ''; }
  if (ed.tool === 'terrain' || ed.tool === 'treebrush' || isPlaceTool() || ed.tool === 'spawn') {
    const hit = hitWorld(e, isPlaceTool());
    if (hit) {
      brushRing.position.set(hit.point.x, hit.point.y + 0.1, hit.point.z);
      const r = ed.tool === 'terrain' ? ed.brush.radius : ed.treeBrush.radius; brushRing.scale.set(r, r, r);
      ghost.position.copy(hit.point); ghost.rotation.y = placeRot(); ghost.visible = true;
      if (ed.down && ed.tool === 'terrain') sculptAt(hit.point);
      if (ed.down && ed.tool === 'treebrush') scatterTrees(hit.point);
    } else ghost.visible = false;
  }
});
window.addEventListener('pointerup', () => {
  if (!ed.down) return;
  ed.down = false;
  if (ed.edgeDrag) {
    const size = ed.edgeDrag.size; ed.edgeDrag = null;
    if (size !== world.data.terrain.size) { pushUndo(); world.resizeTerrain(size); toast(`Map is now ${size} × ${size} m`); }
    updateMapEdge(); refreshSelectionBox(); renderPanel(); updateHint();
    return;
  }
  if (ed.mode === 'edit' && (ed.tool === 'terrain')) { world.groundAll(); refreshSelectionBox(); updateMapEdge(); pushUndo(); }
  if (ed.mode === 'edit' && ed.tool === 'treebrush') pushUndo();
});
canvas.addEventListener('dblclick', () => { if (ed.mode === 'edit' && LINE_TYPES.includes(ed.tool)) finishPath(); });
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

const isPlaceTool = () => ['box', 'wall', 'ramp', 'cylinder', 'sphere', 'doorway', 'door', 'light', 'tree'].includes(ed.tool);

function placeObject(type, hit, e) {
  pushUndo();
  if (type === 'doorway') { const d = placeDoorway(hit); if (d) { ed.tool = 'select'; setTool('select'); select(d); } else ed.undo.pop(); return; }
  const def = { type, pos: [hit.point.x, hit.point.y, hit.point.z] };
  if (hit.terrain) def.grounded = true; else def.grounded = false;
  if (type === 'light') { def.grounded = hit.terrain; def.pos[1] = hit.point.y + (hit.terrain ? DEFAULTS.light.offset : 0.3); }
  if (type === 'tree') def.scale = [0.8 + Math.random() * 0.8, 0.8 + Math.random() * 0.8, 0.8 + Math.random() * 0.8];
  def.rot = placeRot();   // doors/walls square to the view, plus whatever you dialled in with R / , / .
  if (e?.shiftKey) { def.pos[0] = Math.round(def.pos[0] * 2) / 2; def.pos[2] = Math.round(def.pos[2] * 2) / 2; }   // Shift: 0.5 m grid
  let note = null;
  if (type === 'door' && hit.object?.type === 'doorway') note = fitDoorToDoorway(def, hit);
  else if (type === 'wall' && hit.object?.type === 'hollow' && hit.normal?.y > 0.7) {   // a wall on a hollow's floor: floor-to-ceiling
    const inside = world.hollowInteriorAt(hit.object, hit.point.x, hit.point.z);
    if (inside) { def.scale = [DEFAULTS.wall.scale[0], Math.max(0.5, inside.ceiling - hit.point.y), DEFAULTS.wall.scale[2]]; def.pos[1] = inside.floor; note = 'Wall sized floor to ceiling'; }
  }
  const o = world.addObject(def);
  if (o.grounded) { o.pos[1] = world.groundY(o) + (o.offset || 0); world.syncTransform(o); }
  ed.tool = 'select'; setTool('select'); select(o);
  if (note) toast(note);
}
// Doorway tool: an opening through the wall that was clicked. A solid shape gets hollowed first.
function placeDoorway(hit) {
  let h = hit.object;
  if (!h || !hit.normal) { toast('Click the wall of a building'); return null; }
  if (h.type !== 'hollow') {
    if (!HOLLOW_TYPES.includes(h.type)) { toast('Doorways go on boxes, walls, cylinders, spheres or hollows'); return null; }
    h = hollowObjects([h]); toast('Hollowed it out');
  }
  const n = hit.normal.clone(); n.y = 0;
  if (n.lengthSq() < 0.3) { toast('Click the side of a wall, not the roof or floor'); return null; }
  n.normalize();
  const t = h.thickness, cx = hit.point.x - n.x * t / 2, cz = hit.point.z - n.z * t / 2;   // middle of the wall
  const inside = world.hollowInteriorAt(h, cx - n.x * t, cz - n.z * t) || world.hollowInteriorAt(h, cx, cz);
  const floor = inside ? inside.floor : h.pos[1] + t;
  const height = inside ? Math.min(DEFAULTS.doorway.scale[1], inside.ceiling - floor - 0.05) : DEFAULTS.doorway.scale[1];
  return world.addObject({ type: 'doorway', pos: [cx, floor, cz], rot: Math.atan2(n.x, n.z), scale: [DEFAULTS.doorway.scale[0], height, t + 0.4], target: h.id, grounded: false });
}
// Door tool on a doorway: hang the door in the frame, hinged on the side that was clicked, opening inward
function fitDoorToDoorway(def, hit) {
  const d = hit.object, r = d.rot || 0, ux = Math.cos(r), uz = -Math.sin(r), [w, hgt] = d.scale;
  const post = 0.07 * w, right = (hit.point.x - d.pos[0]) * ux + (hit.point.z - d.pos[2]) * uz > 0;   // clicked nearer the +x post?
  const hx = (w / 2 - post) * (right ? 1 : -1);
  def.pos = [d.pos[0] + ux * hx, d.pos[1], d.pos[2] + uz * hx];
  def.rot = r + (right ? Math.PI : 0);           // hinge -> latch always runs across the opening
  def.scale = [w - 2 * post, hgt - 0.02, 0.08];
  def.swing = right ? 'out' : 'in';              // both mean "into the building" once the rotation flips
  def.grounded = false; def.inDoorway = d.id;
  return `Door hung on the ${right ? 'right' : 'left'} — opens inward`;
}
// sit every selected object on the highest ground under its footprint (never sinks in), and keep it snapped
function sitOnGround() {
  const objs = selectedObjects().filter(o => !LINE_TYPES.includes(o.type));
  if (!objs.length) { toast('Nothing selected'); return; }
  pushUndo();
  for (const o of objs) { o.grounded = true; o.pos[1] = world.groundY(o, o.pos[0], o.pos[2], 'highest') + (o.offset || 0); if (o.type === 'light') world.rebuildObject(o.id); else world.syncTransform(o); }
  if (selected) gizmo.attach(world.meshes.get(selected.id));
  refreshSelectionBox(); renderPanel(); toast(`${objs.length} object${objs.length > 1 ? 's' : ''} sat on the ground`);
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
    const type = ed.tool === 'fence' ? 'fence' : 'path';
    const o = world.addObject({ type, pos: [0, 0, 0], points: ed.pathPoints.slice() });
    ed.pathPoints = []; updatePathPreview(); toast(type === 'fence' ? 'Fence built' : 'Path created');
    setTool('select'); select(o);
  } else { ed.pathPoints = []; updatePathPreview(); }
}
function updatePathPreview() {
  const line = ed.tool === 'path' ? World.centerLine(ed.pathPoints, true) : ed.pathPoints;   // paths preview their smoothed route
  const pts = line.map(([x, z]) => new THREE.Vector3(x, world.sampleHeight(x, z) + 0.3, z));
  pathPreview.geometry.dispose(); pathPreview.geometry = new THREE.BufferGeometry().setFromPoints(pts);
  pathPreview.visible = pts.length > 0;
}

// keys
const keys = {};
window.addEventListener('keydown', (e) => {
  keys[e.code] = true;
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
  if (ed.mode === 'play') { onPlayKey(e); return; }
  if (e.key === 'Shift') setGizmoSnap(true);
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
    case 'KeyN': setTool('fence'); break;
    case 'End': e.preventDefault(); sitOnGround(); break;
    case 'Digit1': setGizmoMode('translate'); break;
    case 'Digit2': setGizmoMode('rotate'); break;
    case 'Digit3': setGizmoMode('scale'); break;
    case 'KeyR': rotateBy(e.shiftKey ? -15 : 15); break;
    case 'Comma': rotateBy(-90); break;
    case 'Period': rotateBy(90); break;
    case 'PageUp': e.preventDefault(); liftBy(e.shiftKey ? 1 : 0.25); break;
    case 'PageDown': e.preventDefault(); liftBy(e.shiftKey ? -1 : -0.25); break;
    case 'Delete': case 'Backspace': if (selected) deleteSelected(); break;
    case 'Escape': if (LINE_TYPES.includes(ed.tool) && ed.pathPoints.length) { ed.pathPoints = []; updatePathPreview(); } else { select(null); setTool('select'); } break;
    case 'Enter': if (LINE_TYPES.includes(ed.tool)) finishPath(); break;
    case 'KeyF': if (selected) focusOn(world.meshes.get(selected.id).position); break;
    case 'KeyP': startPlay(false); break;
    case 'KeyG': if (selected) hollowSelection(); break;
    case 'KeyO': setTool('doorway'); break;
    case 'KeyX': world.setHideRoofs(!world.hideRoofs); renderPanel(); toast(world.hideRoofs ? 'Roofs hidden' : 'Roofs shown'); break;
    case 'BracketLeft': adjustBrush(-1); break;
    case 'BracketRight': adjustBrush(1); break;
  }
});
window.addEventListener('keyup', (e) => { keys[e.code] = false; if (e.key === 'Shift') setGizmoSnap(false); if (ed.mode === 'play' && e.code === 'KeyQ') aim.active = false; });
// rotate the selection (or the placement ghost) by some degrees
function rotateBy(deg) {
  const rad = THREE.MathUtils.degToRad(deg);
  if (selected && selected.type !== 'path') { pushUndo(); selected.rot = (selected.rot || 0) + rad; world.syncTransform(selected); refreshSelectionBox(); renderPanel(); }
  else if (isPlaceTool()) { ed.placeRot += rad; ghost.rotation.y = placeRot(); toast(`Rotation ${Math.round(THREE.MathUtils.radToDeg(placeRot()))}°`); }
}
// nudge the selection up/down; any lift takes it off the ground (pole lights just change pole height)
function liftBy(m) {
  if (!selected || selected.type === 'path') return;
  pushUndo();
  if (selected.type === 'light' && selected.grounded) { selected.offset = Math.max(0, (selected.offset || 0) + m); selected.pos[1] = world.sampleHeight(selected.pos[0], selected.pos[2]) + selected.offset; world.rebuildObject(selected.id); gizmo.attach(world.meshes.get(selected.id)); }
  else { selected.grounded = false; selected.pos[1] += m; world.syncTransform(selected); }
  refreshSelectionBox(); renderPanel();
}
function adjustBrush(d) { const b = ed.tool === 'treebrush' ? ed.treeBrush : ed.brush; b.radius = clamp(b.radius + d * 1.5, 1, 60); renderPanel(); }
function focusOn(p) { const off = editCam.position.clone().sub(orbit.target); orbit.target.copy(p); editCam.position.copy(p).add(off.setLength(Math.min(off.length(), 25))); }
function deleteSelected() {
  pushUndo();
  const objs = selectedObjects();
  for (const o of objs) if (o.type === 'hollow') for (const d of world.data.objects.filter(d => d.type === 'doorway' && d.target === o.id)) world.removeObject(d.id);   // doorways go with their building
  for (const o of objs) world.removeObject(o.id);
  select(null);
}

// ---- hollow: turn shapes into one shell you can walk into
function hollowObjects(items) {
  const cx = items.reduce((a, o) => a + o.pos[0], 0) / items.length, cz = items.reduce((a, o) => a + o.pos[2], 0) / items.length, cy = Math.min(...items.map(o => o.pos[1]));
  const parts = items.map(o => ({ type: o.type, pos: [o.pos[0] - cx, o.pos[1] - cy, o.pos[2] - cz], rot: o.rot || 0, scale: [...o.scale], half: !!o.half }));
  for (const o of items) world.removeObject(o.id);
  return world.addObject({ type: 'hollow', pos: [cx, cy, cz], rot: 0, parts, cuts: [], color: items[0].color, name: items[0].name || '', grounded: items.length === 1 && items[0].grounded });
}
function hollowSelection() {
  const items = selectedObjects().filter(o => HOLLOW_TYPES.includes(o.type));
  if (!items.length) { toast('Select boxes, walls, cylinders or spheres first'); return; }
  pushUndo();
  const h = hollowObjects(items);
  select(h); toast(`Hollowed ${items.length} piece${items.length > 1 ? 's' : ''}`);
}
// subtract the selected boxes from the selected hollow (doorways, windows)
function carveSelection() {
  const objs = selectedObjects(), hollow = objs.find(o => o.type === 'hollow'), boxes = objs.filter(o => o.type === 'box' || o.type === 'wall');
  if (!hollow || !boxes.length) { toast('Select a hollow and at least one box'); return; }
  pushUndo();
  const r = hollow.rot || 0, c = Math.cos(r), s = Math.sin(r);
  for (const b of boxes) {
    const dx = b.pos[0] - hollow.pos[0], dz = b.pos[2] - hollow.pos[2];   // world -> hollow local
    hollow.cuts.push({ type: 'box', pos: [dx * c - dz * s, b.pos[1] - hollow.pos[1], dx * s + dz * c], rot: (b.rot || 0) - r, scale: [...b.scale] });
    world.removeObject(b.id);
  }
  world.rebuildObject(hollow.id); select(hollow); toast(`Carved ${boxes.length} opening${boxes.length > 1 ? 's' : ''}`);
}
// put the parts (and cutters) back as ordinary objects
function splitHollow(h) {
  pushUndo();
  const r = h.rot || 0, c = Math.cos(r), s = Math.sin(r);
  const toWorld = (p) => [h.pos[0] + p.pos[0] * c + p.pos[2] * s, h.pos[1] + p.pos[1], h.pos[2] - p.pos[0] * s + p.pos[2] * c];   // hollow local -> world
  const made = [];
  for (const p of h.parts) made.push(world.addObject({ type: p.type, pos: toWorld(p), rot: (p.rot || 0) + r, scale: [...p.scale], half: !!p.half, color: h.color, grounded: false }));
  for (const q of h.cuts || []) made.push(world.addObject({ type: 'box', pos: toWorld(q), rot: (q.rot || 0) + r, scale: [...q.scale], color: '#c0392b', grounded: false, solid: false, name: 'Opening cutter' }));
  world.removeObject(h.id);
  select(made[0]); for (const m of made.slice(1)) select(m, true);
  toast('Split into parts');
}
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
  world.load(JSON.parse(s)); applySettings(); updateMapEdge();
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
function loadWorld(data) { select(null); ed.undo = []; world.load(data); $('worldName').value = world.data.name || ''; applySettings(); updateMapEdge(); renderPanel(); }
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
    root.appendChild(el('div', { class: 'note', text: `Click points on the ground (${ed.pathPoints.length} so far). Double-click or Enter to finish, Esc to cancel. The path follows the terrain and rounds its corners; you can change width and smoothing after.` }));
  } else if (ed.tool === 'fence') {
    root.appendChild(el('h3', { text: 'FENCE' }));
    root.appendChild(el('div', { class: 'note', text: `Click the corner points (${ed.pathPoints.length} so far). Double-click or Enter to finish, Esc to cancel. Posts follow the terrain; height, style (chain-link / rails), post spacing and colour are editable after.` }));
  } else if (ed.tool === 'spawn') {
    root.appendChild(el('h3', { text: 'SPAWN POINT' }));
    root.appendChild(el('div', { class: 'note', text: 'Click on the ground to move where the guard starts. He faces away from the camera.' }));
    root.appendChild(range('Facing', world.data.spawn.yaw, -3.14, 3.14, 0.05, (v) => { world.data.spawn.yaw = v; world.updateSpawnMarker(); }, (v) => v.toFixed(2)));
  } else if (extraSel.size) renderMultiPanel(root);
  else if (selected) renderObjectPanel(root, selected);
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
  sec.appendChild(field('Hide roofs', el('input', { type: 'checkbox', ...(world.hideRoofs ? { checked: '' } : {}), onchange: (e) => { world.setHideRoofs(e.target.checked); } })));
  sec.appendChild(el('div', { class: 'note', text: 'X — cutaway view: roofs of hollow buildings are sliced off so you can see and build inside. Clicks go through to the floor.' }));
  sec.appendChild(field('No sinking', el('input', { type: 'checkbox', ...(s.groundMode === 'highest' ? { checked: '' } : {}), onchange: (e) => { pushUndo(); s.groundMode = e.target.checked ? 'highest' : 'center'; world.groundAll(); refreshSelectionBox(); toast(e.target.checked ? 'Objects sit on the highest ground under them' : 'Objects snap at their centre'); } })));
  sec.appendChild(el('div', { class: 'note', text: 'No sinking: anything snapped to the ground sits on the highest terrain under its whole footprint. End / SIT ON GROUND does that for the selection right now.' }));
  {
    const cur = world.data.terrain.size;
    const sizes = [100, 200, 300, 400, 600, 800, 1000, 1500];
    if (!sizes.includes(cur)) sizes.push(cur), sizes.sort((a, b) => a - b);
    const sel = el('select', { onchange: (e) => { const v = parseInt(e.target.value, 10); pushUndo(); world.resizeTerrain(v); updateMapEdge(); if (selected) { gizmo.attach(world.meshes.get(selected.id)); refreshSelectionBox(); } toast(`Map is now ${v} × ${v} m`); renderPanel(); } });
    for (const v of sizes) sel.appendChild(el('option', { value: v, text: `${v} × ${v} m`, ...(v === cur ? { selected: '' } : {}) }));
    sec.appendChild(field('Map size', sel));
    sec.appendChild(el('div', { class: 'note', text: 'Growing keeps your terrain and extends the edges; shrinking clips whatever is outside. Objects stay where they are.' }));
  }
  sec.appendChild(el('div', { class: 'note', text: 'Worlds autosave to this browser every 30 s. EXPORT downloads a .json you can keep or send; IMPORT loads one.' }));
  root.appendChild(sec);
  const pref = el('div', { class: 'sec' }, [el('h3', { text: 'EDITOR' })]);
  pref.appendChild(range('Orbit sensitivity', prefs.orbitSpeed, 0.2, 3, 0.1, (v) => { prefs.orbitSpeed = v; applyPrefs(); }, (v) => v.toFixed(1) + '×'));
  pref.appendChild(range('Look sensitivity (play)', prefs.lookSpeed, 0.2, 3, 0.1, (v) => { prefs.lookSpeed = v; applyPrefs(); }, (v) => v.toFixed(1) + '×'));
  pref.appendChild(el('div', { class: 'note', text: 'Right-drag orbit speed in the editor, and mouse-look speed in play mode. Saved in this browser.' }));
  root.appendChild(pref);
}
function renderMultiPanel(root) {
  const objs = selectedObjects();
  root.appendChild(el('h3', { text: `${objs.length} SELECTED` }));
  root.appendChild(el('div', { class: 'note', text: objs.map(o => o.name || TYPE_LABELS[o.type] || o.type).join(' · ') }));
  const hollow = objs.find(o => o.type === 'hollow'), shapes = objs.filter(o => HOLLOW_TYPES.includes(o.type));
  if (hollow && shapes.length && hollow === selected) {
    root.appendChild(el('button', { class: 'primary', style: 'width:100%;margin-top:8px', text: 'CARVE OPENINGS', onclick: carveSelection }));
    root.appendChild(el('div', { class: 'note', text: 'Cuts the other shapes out of the hollow — doorways, windows, hatches. Let the cutter poke right through the wall.' }));
  } else if (shapes.length === objs.length) {
    root.appendChild(el('button', { class: 'primary', style: 'width:100%;margin-top:8px', text: 'HOLLOW  (G)', onclick: hollowSelection }));
    root.appendChild(el('div', { class: 'note', text: 'Joins these into one shell with walls, floor and roof of the thickness you choose afterwards. Push pieces into each other by more than the wall thickness so their insides connect.' }));
  } else if (hollow) root.appendChild(el('div', { class: 'note', text: 'To carve: click the hollow last (so the gizmo is on it), with the cutter boxes also selected.' }));
  else root.appendChild(el('div', { class: 'note', text: 'Only boxes, walls, cylinders and spheres can be hollowed.' }));
  root.appendChild(el('div', { class: 'note', text: 'Shift+click adds or removes. The gizmo moves the last one clicked.' }));
  root.appendChild(el('div', { class: 'row2', style: 'margin-top:6px' }, [
    el('button', { text: 'SIT ON GROUND', title: 'End', onclick: sitOnGround }),
    el('button', { text: 'DELETE ALL', onclick: deleteSelected }),
  ]));
}
function renderObjectPanel(root, o) {
  const title = o.type === 'hollow' && o.parts.length === 1 ? `${TYPE_LABELS[o.parts[0].type] || 'shape'} · hollow` : (TYPE_LABELS[o.type] || o.type);
  root.appendChild(el('h3', { text: title.toUpperCase() }));
  if (HOLLOW_TYPES.includes(o.type) || o.type === 'hollow') {
    const isH = o.type === 'hollow';
    root.appendChild(field('Hollow', el('input', { type: 'checkbox', ...(isH ? { checked: '' } : {}), onchange: (e) => {
      if (e.target.checked) { pushUndo(); select(hollowObjects([o])); toast('Hollowed — walk in through a doorway (O)'); }
      else splitHollow(o);
    } })));
  }
  const apply = (rebuild = false) => { if (rebuild) world.rebuildObject(o.id); else world.syncTransform(o); if (o.grounded) { o.pos[1] = world.groundY(o) + (o.offset || 0); world.syncTransform(o); } gizmo.attach(world.meshes.get(o.id)); refreshSelectionBox(); pushUndo(); };
  root.appendChild(field('Name', el('input', { type: 'text', value: o.name || '', onchange: (e) => { o.name = e.target.value; } })));
  if (!LINE_TYPES.includes(o.type)) {
    const pos = el('div', { class: 'row3' }, [0, 1, 2].map(i => numInput(o.pos[i], (v) => { o.pos[i] = v; if (i === 1) o.grounded = false; apply(); })));
    root.appendChild(field('Position', pos));
    root.appendChild(field('Rotation °', numInput(THREE.MathUtils.radToDeg(o.rot || 0), (v) => { o.rot = THREE.MathUtils.degToRad(v); apply(); }, 5)));
    root.appendChild(field('', el('div', { class: 'row2', style: 'grid-template-columns:1fr 1fr 1fr 1fr' }, [[-90, '↺ 90'], [-15, '↺ 15'], [15, '↻ 15'], [90, '↻ 90']].map(([d, t]) => el('button', { text: t, title: `Rotate ${d}°`, onclick: () => rotateBy(d) })))));
    if (o.scale && o.type !== 'light') {
      const sc = el('div', { class: 'row3' }, [0, 1, 2].map(i => numInput(o.scale[i], (v) => { o.scale[i] = Math.max(0.05, v); apply(); })));
      root.appendChild(field(o.type === 'door' ? 'W / H / thick' : o.type === 'doorway' ? 'W / H / depth' : 'Size', sc));
    }
    root.appendChild(field('Snap to ground', el('div', { class: 'row2', style: 'grid-template-columns:auto 1fr;align-items:center' }, [
      el('input', { type: 'checkbox', ...(o.grounded ? { checked: '' } : {}), onchange: (e) => { o.grounded = e.target.checked; apply(o.type === 'light'); } }),
      el('button', { text: 'SIT ON GROUND', title: 'End — sit on the highest ground under it', onclick: sitOnGround }),
    ])));
    root.appendChild(el('div', { class: 'note', text: 'Drag the green gizmo arrow or press PgUp / PgDn (Shift = 1 m) to lift it into the air — that unticks snap. R / Shift+R rotate 15°, , and . rotate 90°. Hold Shift while dragging to snap.' }));
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
  if (o.type === 'cylinder') {
    root.appendChild(field('Half', el('input', { type: 'checkbox', ...(o.half ? { checked: '' } : {}), onchange: (e) => { o.half = e.target.checked; apply(true); } })));
    if (o.half) root.appendChild(el('div', { class: 'note', text: 'Half cylinder: the flat side sits on the object\'s origin and the curve bulges out the back. Size is that of the full cylinder it was cut from.' }));
  }
  if (HOLLOW_TYPES.includes(o.type)) root.appendChild(el('div', { class: 'note', text: 'Tick Hollow to turn it into a room. Shift+click more shapes and press G to hollow them as one building.' }));
  if (o.type === 'hollow') {
    root.appendChild(field('Wall thick.', numInput(o.thickness, (v) => { o.thickness = clamp(v, 0.05, 3); apply(true); }, 0.05)));
    const nDoors = world.data.objects.filter(d => d.type === 'doorway' && d.target === o.id).length, nCuts = (o.cuts || []).length;
    root.appendChild(el('div', { class: 'note', text: `${o.parts.length} part${o.parts.length === 1 ? '' : 's'} · ${nDoors} doorway${nDoors === 1 ? '' : 's'} · ${nCuts} carved opening${nCuts === 1 ? '' : 's'}. Doorway tool (O): click a wall. Windows: place a box through the wall, Shift+click this, CARVE. X hides roofs so you can build inside; walls placed on the floor size themselves floor-to-ceiling.` }));
    if (o.parts.length > 1) root.appendChild(el('button', { style: 'width:100%;margin-top:6px', text: 'SPLIT APART', onclick: () => splitHollow(o) }));
  }
  if (o.type === 'doorway') {
    const t = world.getObject(o.target);
    root.appendChild(el('div', { class: 'note', text: t ? `Opening in "${t.name || 'hollow'}". Move, turn or resize it and the hole follows; delete it and the wall heals. Door tool: click inside the frame (left or right half picks the hinge side) to hang a door.` : 'Not linked to a building — it does nothing on its own.' }));
  }
  if (o.type === 'door') {
    root.appendChild(field('Bars', el('input', { type: 'checkbox', ...(o.bars ? { checked: '' } : {}), onchange: (e) => { o.bars = e.target.checked; apply(true); } })));
    root.appendChild(field('Locked', el('input', { type: 'checkbox', ...(o.locked ? { checked: '' } : {}), onchange: (e) => { o.locked = e.target.checked; pushUndo(); } })));
    root.appendChild(field('Key name', el('input', { type: 'text', value: o.keyName || '', onchange: (e) => { o.keyName = e.target.value; } })));
    const sw = el('select', { onchange: (e) => { o.swing = e.target.value; pushUndo(); } });
    for (const [v, l] of [['auto', 'Away from whoever opens it'], ['in', 'Always inward (−z side)'], ['out', 'Always outward (+z side)']]) sw.appendChild(el('option', { value: v, text: l, ...((o.swing || 'auto') === v ? { selected: '' } : {}) }));
    root.appendChild(field('Swing', sw));
    root.appendChild(el('div', { class: 'note', text: o.inDoorway ? 'Hung in a doorway. Its origin is the hinge; the leaf swings from there.' : 'To put a door in a building: Doorway tool (O) on the wall first, then click inside the frame with the Door tool.' }));
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
    root.appendChild(field('Smooth corners', el('input', { type: 'checkbox', ...(o.smooth !== false ? { checked: '' } : {}), onchange: (e) => { o.smooth = e.target.checked; apply(true); } })));
    root.appendChild(el('div', { class: 'note', text: `${o.points.length} points. Delete and redraw to change the route.` }));
  }
  if (o.type === 'fence') {
    root.appendChild(range('Height', o.height, 0.5, 6, 0.1, (v) => { o.height = v; world.rebuildObject(o.id); refreshSelectionBox(); }, (v) => v.toFixed(1) + ' m'));
    root.appendChild(range('Post spacing', o.spacing, 1, 8, 0.5, (v) => { o.spacing = v; world.rebuildObject(o.id); }, (v) => v + ' m'));
    const st = el('select', { onchange: (e) => { o.style = e.target.value; apply(true); } });
    for (const [v, l] of [['chainlink', 'Chain-link'], ['rails', 'Rails']]) st.appendChild(el('option', { value: v, text: l, ...(o.style === v ? { selected: '' } : {}) }));
    root.appendChild(field('Style', st));
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
    select: 'Click to select · Shift+click multi-select · G hollow · End sit on ground · 1/2/3 move/rotate/scale · R , . rotate · PgUp/PgDn lift · Del · Ctrl+D duplicate · F frame · Ctrl+Z undo · P play',
    terrain: 'Click-drag to sculpt · [ ] brush size · release to re-snap objects',
    path: 'Click points · double-click / Enter to finish · Esc cancel',
    fence: 'Click corner points · double-click / Enter to finish · Esc cancel',
    treebrush: 'Click-drag to scatter trees · [ ] brush size',
    spawn: 'Click the ground to place the spawn point',
    doorway: 'Click the wall of a building (a solid box gets hollowed first) · Esc back to select',
    door: 'Click inside a doorway to hang the door (left/right half = hinge side) · or anywhere to place a free door · R , . rotate',
  }[ed.tool] || 'Click the ground or any object to place it there · Shift snaps to 0.5 m · R / Shift+R , . rotate the preview · Esc back to select';
  $('hint').textContent = h + '  ·  drag a yellow edge handle to resize the map  ·  right-drag orbit · middle-drag pan · wheel zoom · WASD E/C fly';
}

// =====================================================================
//  PLAY MODE — the guard
// =====================================================================
const plc = new PointerLockControls(playCam, renderer.domElement);
Object.defineProperty(plc, 'pointerSpeed', { get: () => prefs.lookSpeed, set: () => {} });   // play-mode look speed follows the EDITOR preference
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
  select(null); world.spawnMarker.visible = false; brushRing.visible = false; ghost.visible = false; pathPreview.visible = false; mapEdge.visible = false; orbit.enabled = false;
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
  world.spawnMarker.visible = true; mapEdge.visible = true; orbit.enabled = true; flashlight.intensity = 0; aim.active = false;
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
  // world -> collider local (inverse of a rotation about Y by c.rot)
  const cos = Math.cos(c.rot), sin = Math.sin(c.rot);
  const dx = pos.x - c.cx, dz = pos.z - c.cz;
  const lx = dx * cos - dz * sin, lz = dx * sin + dz * cos;
  const nx = clamp(lx, -c.hx, c.hx), nz = clamp(lz, -c.hz, c.hz);
  let ox = lx - nx, oz = lz - nz; const d = Math.hypot(ox, oz);
  if (d >= r) return;
  if (d < 1e-5) { const px = c.hx - Math.abs(lx), pz = c.hz - Math.abs(lz); if (px < pz) ox = Math.sign(lx || 1) * (px + r); else oz = Math.sign(lz || 1) * (pz + r); }
  else { ox *= (r - d) / d; oz *= (r - d) / d; }
  pos.x += ox * cos + oz * sin; pos.z += -ox * sin + oz * cos;   // local -> world
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
    if (obj.type === 'doorway') continue;   // its invisible click box must not hide the door hung in it
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
    const d = world.doorState(o.id);
    let dir = 1;   // +1 swings towards the door's local -z
    if (o.swing === 'out') dir = -1;
    else if (o.swing !== 'in') { const r = o.rot || 0, dx = player.pos.x - o.pos[0], dz = player.pos.z - o.pos[2]; dir = (dx * Math.sin(r) + dz * Math.cos(r)) > 0 ? 1 : -1; }   // away from the player
    world.setDoor(o.id, !d.open, dir);
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
  if (!gizmo.dragging) world.flushDirty();   // re-cut hollows whose doorways moved (after the drag, not during)
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
