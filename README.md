# Night Shift — prison guard MVP

First-person browser prototype built with [Three.js](https://threejs.org) (loaded from a CDN, no build step).

## Run

Browsers block ES modules from `file://`, so serve the folder with any static server:

```bash
cd prison-guard
python3 -m http.server 8765
```

then open http://localhost:8765 (or `npx serve .`).

## Controls

| Key | Action |
| --- | --- |
| W A S D / arrows | Move |
| Mouse | Look |
| Shift | Run |
| F | Interact (keys, doors, switches, breaker) |
| Hold right-click / Q | Aim the flashlight independently of your view (eases back to centre on release) |
| L | Toggle flashlight |
| M / Tab | Fast-travel map — click a numbered spot or anywhere walkable |
| Esc | Pause |

## Demo flow

0. Main menu (START / OPTIONS / EXIT) plays over a live view from the man trap. START slams the outer door, cuts to black, fades up facing the inner steel door, which slides open onto the lit entry hall.
1. Report to the **SECURITY ROOM** (up the ramp, first door on the left; glass window over the hall). Desks, CCTV wall, computer, cork boards, and the **motion sensor grid** — a wall map with a bulb per room. Press the buttons under it (or `F` on the computer for all rooms) to make the bulbs flash as if motion were detected. The Cell Block A bulb also flashes for real when the prisoner is loose.
2. Power is out in the main block. Take the **Utility Room Key** off the guard office desk.
3. Cross the hall, unlock **UTILITY**, reset the breaker → hall/cell-block lights come on (room light switches work now too).
4. Enter **CELL BLOCK A**. A silhouette runs into cell 8 and vanishes, dropping the **Yard Gate Key**.
5. Unlock the **YARD** gate at the east end of the hall → demo complete, free roam.
6. The **PERIMETER** gate at the back of the yard and the main entrance lead outside: access road, perimeter wall with guard towers, and forested hills all around (walkable).

## Tweaking

Everything lives in `main.js`:

- `rooms`, `cells`, `doorDefs` — the tile map (1 tile = 2 m). Walls are generated automatically around carved floor.
- `makeKey / makeSwitch / makeBreaker / makeDoor` — interactables. Anything with `userData.entity = { prompt(), interact() }` pushed into `interactables` works with `F`.
- `addLamp(x, z, zone)` — lights, grouped by zone so switches/breaker can toggle them.
- `onPowerRestored / onKeyPicked / updateFigure` — the objective chain.
- `PERIM`, `ROAD_Z`, the EXTERIOR block — grounds outside the building. `box(..., solid=true)` adds a world collider.
- `terrainH(x, z)` — the heightfield (flat inside the perimeter + road, hills beyond). Trees are placed on it; the player walks on it via `groundHeight`.
- `GX0` — the grid's first tile column; the entry wing (man trap, entry hall, security room) lives at negative x so the original rooms kept their coordinates.
- `motionRooms` / `bulbs` / `state.motion` — the security-room motion grid. `updateMotionBulbs` decides what flashes.
- `cine` + `updateCinematic` — menu → door close → black → fade-in → steel door → play.
- `travelSpots` — fast-travel presets (world metres + facing yaw); the map canvas is drawn from the same data.

## World editor (`editor/`)

Open http://localhost:8765/editor/ (same static server). It is a **space builder**: drop basic shapes into a 3D world, shape them, hollow them into rooms, cut doors and windows by drawing on walls, then walk through it. Press **?** in the editor for the full cheat sheet — it's written for someone seeing the tool for the first time.

- **Camera**: right-drag look · middle-drag pan · wheel zoom · WASD + E/C fly (Shift = fast) · F jumps to the selection. Orbit / look sensitivity sliders live in the EDITOR fold of the right panel (saved per browser).
- **Left bar** — *Shapes*: Box (B) · Cylinder · Sphere · Ramp · Wall. *Openings*: Opening (O) · Door · Light. *Outside*: Path (H) · Fence (N) · Tree · Tree brush · Terrain (T). *Play*: Spawn (S). Every button has a tooltip.
- **Placing**: pick a shape, click the ground or any surface (stacking on other shapes works). R / Shift+R turn the preview 15°, `,` / `.` 90°. Shift+click snaps to a 0.5 m grid. Esc back to Select.
- **Shaping**: click a shape; 1 move / 2 rotate / 3 resize gizmos (Shift snaps). The panel has exact size, rotation, colour and a **Corner radius** for boxes (rounded cubes — the rounding stays true when you resize). PgUp / PgDn lift, End sits it on the ground (highest point under its footprint — nothing sinks), Ctrl+D copies, Delete removes, Ctrl+Z undoes. Shift+click selects several; G hollows them as one.
- **Rooms**: tick **Hollow** on any box / cylinder / sphere — walls, floor and roof of adjustable thickness you can walk into; untick to get the solid back. Shift+click several shapes + **G** joins them into one building (push them into each other so the insides connect; SPLIT APART undoes). **X** hides all roofs for a cutaway view; a Wall placed on a room's floor sizes itself floor-to-ceiling. Resizing a hollow with the gizmo resizes the room.
- **Doors and windows**: **Opening (O)** — press on a wall, drag a rectangle, let go: it is cut straight through (on a solid shape, the shape is hollowed first). Drawn from the floor you get a door frame; higher up, a plain window hole (the panel's *Door frame* box switches either way). A plain click makes a door-sized opening. Openings stay linked: move / resize them and the hole follows, delete them and the wall heals. **Door** tool: click inside an opening to hang a door (the side you click is the hinge; opens inward). Doors elsewhere are free-standing and swing away from whoever opens them (Swing setting: away / in / out); locked doors need a pickup whose name matches the door's *Key name*.
- **Outside**: **Path** (road ribbon, rounded corners) and **Fence** (chain-link or rails, follows the terrain, blocks the player) — click points, double-click / Enter to finish. **Tree** / **Tree brush** ([ ] brush size). **Terrain** brush: raise / lower / smooth / flatten / **reset** (back to flat), plus RESET ALL TERRAIN. Objects re-snap to the ground after a stroke.
- **Map size**: drag the yellow edge handles (any tool) or pick a size in the WORLD fold. Growing keeps your terrain; shrinking clips.
- **World / Editor folds** (right panel, collapsed by default): time of day, fog, hide roofs, no-sinking, map size; sensitivities.
- **Saving**: autosaves to the browser every 30 s · SAVE (Ctrl+S) · EXPORT downloads a `.json` to keep or send · IMPORT loads one · SAMPLE is a starter hut · **PRISON** loads `worlds/prison.json`. Your work is only on this computer until you EXPORT it.
- **Play** (P / ▶ PLAY) starts at the spawn; PLAY HERE drops the guard where the camera is looking. WASD, Shift run, F interact, L torch, hold RMB/Q to aim the torch, Esc back. You walk on the terrain, up ramps, onto anything under ~0.5 m, through openings, and inside rooms.
- **Worlds**: `worlds/prison.json` is the compound built from the aerial reference, generated by `node worlds/gen-prison.mjs` (every building is a line in that script — tweak and regenerate), or load it with `editor/?load=../worlds/prison.json`. The JSON is the hand-off format to Unreal (metres, Y-up; see the Unreal project's CLAUDE.md for the conversion).

Files: `editor/world.js` (data model, scene builder, terrain, collision helpers) and `editor/app.js` (editor UI, tools, undo/save, play mode).
