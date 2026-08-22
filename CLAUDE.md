# Night Shift — prison guard game + world editor

Browser FPS prototype (Three.js r170 via CDN import map, no build step, no assets — textures/sounds are generated in code). Owner: Matthew (GitHub `LostInEden`), works from both a Mac and a Windows PC via this repo. Goal: an MVP to demo to a friend, then grow it.

## Run
Any static server from this folder — `python -m http.server 8765` (Windows) / `python3 -m http.server 8765` (Mac) — then:
- http://localhost:8765 — the game
- http://localhost:8765/editor/ — the world editor

## Layout
- `index.html` + `main.js` — the hand-built game: menu → man-trap intro cinematic → entry hall / raised security room (motion-sensor map) → objective chain (office key → breaker → cell-block chase → yard). Tile grid with `GX0` offset (use `cellAt/setCell`), `rooms`/`doorDefs`, `makeKey/makeSwitch/makeDoor/makeButton`, `addLamp` zones, terrain `terrainH`, fast travel `travelSpots`.
- `editor/world.js` — world data model (terrain heightfield, objects: box/wall/ramp/cylinder/sphere/door/light/tree/path, spawn), scene builder, collision helpers. JSON in/out.
- `editor/app.js` — editor UI (tools, gizmo, undo, autosave/export/import) and play mode (same guard controls as the game).
- `README.md` — full controls and feature list.

## Conventions
- Keep things data-driven; interactables expose `prompt()` / `interact()`. New object types go in `world.js` DEFAULTS + `buildObject` + panel fields in `app.js`.
- Matthew prefers to build levels himself in the editor rather than describe them — extend the editor over hand-placing geometry in `main.js`. Exported worlds go in `worlds/` and get committed.
- Testing without pointer lock: `window.__game` (game) / `window.__editor` (editor) expose `frame()`; set `controls.isLocked = true` (game) or `plc.isLocked = true` (editor) and tick frames manually. Hidden tabs can report a 0x0 window — set `camera.aspect` by hand if raycasts return NaN.
- Always `git pull` before editing; commit + push when done.
