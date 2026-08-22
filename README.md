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

Open http://localhost:8765/editor/ (same static server). Build a space, drop the guard in, iterate.

- **Camera**: right-drag orbit · middle-drag pan · wheel zoom · WASD + E/C fly · F frames the selection.
- **Tools** (left bar): Select (Q) · Terrain (T) raise/lower/smooth/flatten brush, `[`/`]` resize · Path (H) click points, double-click/Enter to finish — a road ribbon that follows the terrain · Box / Wall / Ramp / Cylinder / Sphere / Door / Light / Tree · Tree brush (drag to scatter) · Spawn (S) click to place the guard's start.
- **Selection**: gizmo modes 1 move / 2 rotate (yaw ring only) / 3 scale · hold Shift while dragging to snap (0.5 m / 15° / 0.25×) · Delete · Ctrl+D duplicate · Ctrl+Z undo. The right panel edits size, colour, solid, "snap to ground", and interactions: pick up (inventory; a door whose *Key name* matches unlocks with it), light switch (toggles lights in a *group*), or show a message. Doors can be bars or solid, locked or not.
- **Rotating**: R / Shift+R turn the selection ±15°, `,` / `.` turn it ±90°; the panel has the same four buttons plus a degrees box. The same keys spin the translucent preview while a place tool is active, so you can line a wall up before you click.
- **Height / floating objects**: drag the gizmo's green (Y) arrow or press PgUp / PgDn (Shift = 1 m) and the object comes off the ground and stays where you put it — "snap to ground" unticks itself. Tick it again to drop it back onto the terrain. Clicking on an existing object with a place tool puts the new one right there (on top, on the side, wherever you pointed). Pole lights move the same way; lifting one makes the pole taller instead.
- **Multi-select**: Shift+click adds or removes objects; the gizmo stays on the last one clicked, Delete removes them all.
- **Hollow (buildings)**: every box / wall / cylinder / sphere has a **Hollow** checkbox — tick it and it becomes a room: a shell with walls, floor and roof of adjustable thickness (default 0.3 m) that you can walk into in play mode; untick to get the solid back. To make one building from several shapes, Shift+click them and press **G**; push overlapping pieces into each other by more than the wall thickness so their insides join (SPLIT APART undoes that). Cylinders have a **Half** option (flat side on the origin, curve bulging out the back) for rounded ends. Windows: place a box poking through the wall, Shift+click the hollow, **CARVE OPENINGS**. Hollows are stored as a recipe (parts + thickness + cuts + linked doorways) and rebuilt on load; the CSG comes from `three-bvh-csg` on the CDN.
- **Doorway (O)**: click any wall of a hollow (a solid shape gets hollowed first) — a frame appears with its origin at the centre of the opening, and the hole is cut. Move, rotate or resize the doorway with the gizmo and the hole follows; delete it and the wall heals. **Door** tool: click inside a doorway to hang a door in it — the half you click picks the hinge side, and it opens inward. Doors placed anywhere else are free-standing and swing *away from whoever opens them* (each door has a Swing setting: away / always in / always out).
- **Building inside**: **X** / *Hide roofs* slices the roofs off all hollows (cutaway view); clicks pass through to the floor, so you can drop things inside from above. A **Wall** placed on a hollow's floor sizes itself floor-to-ceiling. Anything placed on the floor sits at floor height. **Shift+click** while placing snaps to a 0.5 m grid.
- **No sinking / sit on ground**: the WORLD panel's **No sinking** toggle (on for new worlds) makes ground-snapped objects sit on the *highest* terrain under their whole footprint instead of the height at their centre, so a building on a slope never clips into the hill. **End** / **SIT ON GROUND** does that for the current selection right now (hollows included) and keeps them snapped.
- **Fence (N)**: click corner points, double-click / Enter to finish. Posts every few metres follow the terrain with chain-link (or rail) panels between them; height, post spacing, style and colour are editable after. Fences block the player.
- **Path corners**: paths run through a Catmull-Rom spline sampled every metre, so corners are rounded instead of mitred; the preview shows the smoothed route while you click. "Smooth corners" can be turned off per path.
- **Map size**: the map is outlined in yellow with a handle on each edge — drag one outward or inward (any tool) and release to resize; the hint bar shows the size while you drag. The WORLD panel also has a size dropdown (100 m – 1500 m) for exact values. Growing keeps your sculpted terrain and extends the edges; shrinking clips what's outside. The map stays centred on the origin.
- **World**: time of day and fog sliders. Autosaves to the browser every 30 s; SAVE (Ctrl+S) saves now; EXPORT downloads a `.json`, IMPORT loads one; SAMPLE loads the starter hut.
- **Play** (P / ▶ PLAY) starts at the spawn; PLAY HERE drops the guard where the camera is looking. Same controls as the game: WASD, Shift run, F interact, L flashlight, hold RMB/Q to aim the light. You walk on the sculpted terrain, up ramps, and onto anything under ~0.5 m tall. Esc returns to the editor and resets doors/lights/pickups.

Files: `editor/world.js` (data model, scene builder, terrain, collision helpers) and `editor/app.js` (editor UI, tools, undo/save, play mode).
