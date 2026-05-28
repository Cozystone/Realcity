# RealCity Verification Checklist

This checklist tracks the full playable-city target. The automated harness is
`npm run verify:realcity`; manual items remain here so the final completion
audit has a clear finish line.

## Automated Now

- Build: `npm run build` must complete without Vite or Rollup errors.
- Browser render: the main WebGL canvas must appear at desktop size and pass a
  canvas pixel/data check.
- Full map: clicking the circular minimap must open a city-wide map with the
  current player marker and landmark labels.
- Control model: `A` rotates avatar heading without translating the avatar.
- Free-look model: arrow keys change only temporary camera view, and the view
  returns behind the avatar after release.
- Movement: `W` moves the avatar forward in the avatar-facing direction.
- NPC access: `E` opens a nearby NPC interaction panel.
- Local LLM route: NPC request planning uses the configured local provider
  label, currently `ollama:dolphin3:latest`.
- RealPhone UI: the lower-right phone opens, exposes message/contact/social/music
  apps, shows callable NPC contacts, and has a music app entry point.
- Phone social layer: the harness sends a message, places a call, and sends a
  route-like request through a contact; the request must open an NPC interaction
  and produce a mission owned by that contacted NPC.
- Street norms: every road has a name, landmarks/buildings have road-name
  addresses, trees do not overlap road reserves, and social norm metadata exists
  for pedestrian/traffic/address rules.
- Address routing: the city exposes a routable address book, and the harness
  asks an NPC for a taxi ride to a far procedural road-name address.
- Building variety: the city data must expose many massing profiles, multiple
  house profiles, multiple house roof types, and visible house accessories such
  as porches, garages, chimneys, and wings.
- Random avatar task: the harness chooses a random destination task, asks a
  nearby NPC to take the player there, waits for an escort mission, and verifies
  meaningful player travel plus arrival/completion text.
- Runtime cleanliness: browser console errors and page errors must be empty.
- Automatic doors: landmark/procedural building entries expose two sliding
  glass panels; the harness moves the avatar near an entrance, confirms the
  panels open, moves away, and confirms that doorway closes again.
- Interior state and floors: the harness places the actual avatar rig inside a
  multi-floor building, confirms the HUD switches to that building interior,
  tests PageUp/PageDown floor movement, then restores the avatar.
- Artifacts: `.verification/realcity-last-run.json` and
  `.verification/realcity-last-run.png` record the last local verification run.

## Manual Or Final-Audit Items

- NPC identity: sample at least 10 agents and confirm each has a distinct name,
  gender, age, job, personality, current activity, home/work/third-place loop,
  and visible movement state.
- Human model readability: confirm player and NPCs have visible front-facing
  face cues, hair/back cues, clothing detail, hands/feet, and readable walking
  direction at street-camera distance.
- NPC social life: observe NPC-to-NPC talks near social places and confirm the
  city pulse reports nearby conversations.
- Phone social breadth: sample several different contacts and confirm their
  replies, call text, and resulting action plans stay distinct to their persona.
- Social reactions: pass close to standing NPCs and confirm they glance toward
  the avatar instead of behaving like static props.
- Traffic norms: step into a lane and confirm nearby drivers brake/yield; taxis
  must be visually distinguishable from private cars.
- Pedestrian norms: observe NPCs near roads and confirm they favor sidewalks,
  plazas, entrances, and crosswalks instead of walking down the middle of a lane.
- Address layer: open the full map and verify landmarks show road-name
  addresses; ask for several taxi routes by landmark name, road-name address,
  and contact location.
- Place meaning: confirm every landmark has a visible form, map point, gameplay
  role, and is reachable by NPC/player movement.
- Landmark interiors: confirm named buildings have solid wall shells, visible
  door openings, a lobby/readable interior, and elevator/stair/escalator props.
- Entry rules: verify the player cannot walk through landmark side/back walls
  and can enter/exit through the front door opening.
- Automatic doors visual pass: confirm the animated glass panels are readable
  from street-camera distance and do not obscure the door opening.
- Interior visual pass: enter several landmark/procedural lobbies and confirm
  floor labels, vertical cores, and interior props read clearly in normal play.
- Entrance routing: request taxi or walking escorts to solid landmarks and
  confirm arrival happens at the entrance apron, not through the side wall or
  building center.
- Daily routine: accelerate or observe city time across morning, work, third
  place, and night slots; agents should change destinations by schedule.
- Taxi route: request taxi escorts to at least three distant landmarks and
  confirm boarding, ride, arrival, and mission completion.
- Walking route: request a nearby walking escort and confirm the NPC leads while
  the player can follow.
- Physics feel: verify jumping, gravity, terrain height, and building collision
  stay stable without clipping through major buildings.
- Performance: test desktop and mobile-like viewports for stable frame pacing,
  readable HUD, and no overlapping UI.
- Deployment: Vercel preview must be READY, load the city, show the minimap, and
  avoid local-only Ollama network calls on `*.vercel.app`.
- Local resources: after verification, no leftover Vite dev server, browser, or
  local LLM process should keep consuming noticeable resources.

## Completion Gate

The overall goal should be considered complete only after:

1. All automated checks pass on a clean local run.
2. The Vercel preview is redeployed from the latest commit and opens correctly.
3. The manual/final-audit items above are sampled and any major gaps are either
   fixed or explicitly documented as future scope.
