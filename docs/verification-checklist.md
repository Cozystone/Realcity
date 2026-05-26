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
- Random avatar task: the harness chooses a random destination task, asks a
  nearby NPC to take the player there, waits for an escort mission, and verifies
  meaningful player travel plus arrival/completion text.
- Runtime cleanliness: browser console errors and page errors must be empty.
- Artifacts: `.verification/realcity-last-run.json` and
  `.verification/realcity-last-run.png` record the last local verification run.

## Manual Or Final-Audit Items

- NPC identity: sample at least 10 agents and confirm each has a distinct name,
  gender, age, job, personality, current activity, home/work/third-place loop,
  and visible movement state.
- NPC social life: observe NPC-to-NPC talks near social places and confirm the
  city pulse reports nearby conversations.
- Social reactions: pass close to standing NPCs and confirm they glance toward
  the avatar instead of behaving like static props.
- Traffic norms: step into a lane and confirm nearby drivers brake/yield; taxis
  must be visually distinguishable from private cars.
- Place meaning: confirm every landmark has a visible form, map point, gameplay
  role, and is reachable by NPC/player movement.
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
