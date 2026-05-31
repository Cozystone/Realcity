# Traffic And Mobility Research Notes

This note tracks the traffic-rule pass for RealCity.

## Sources Reviewed

- Eclipse SUMO traffic lights:
  https://eclipse.dev/sumo/docs/Simulation/Traffic_Lights.html
  - Adopted: static `tlLogic`-style phase sequence, explicit yellow phases, and
    optional all-red clearance before the next green phase.
  - Adopted: signal states as whole-intersection phases, not isolated lamp
    toggles.
  - Adopted: detector-ready controllers. Each main intersection now exposes
    induction-loop-style detector records and pressure fields so static timing
    can later become actuated without changing the data contract.
- Eclipse SUMO pedestrians:
  https://eclipse.dev/sumo/docs/Simulation/Pedestrians.html
  - Adopted: sidewalks, walking areas, and crossings are distinct routing
    surfaces; pedestrians should not treat the drive lane as normal walking
    space.
  - Adopted: a crossing should be considered unavailable when vehicles block
    the crossing path.
  - Adopted: three crossing controls: traffic-light, priority zebra, and
    uncontrolled gap. Non-signalized crossings use conservative time-gap
    acceptance before pedestrians enter the lane.
- MobilityData GBFS:
  https://gbfs.org/specification
  - Adopted as future data-model shape for shared micromobility: station or
    vehicle status should be near-realtime and separated from static system
    metadata.
- smart-data-models/SmartCities:
  https://github.com/smart-data-models/SmartCities
  - Adopted as a model direction: traffic, parking, building, and mobility rules
    should be represented as explicit city data, not hidden constants.
  - Adopted Transportation `TrafficFlowObserved` fields for live traffic
    pressure: lane id/direction, intensity, occupancy, headway, gap distance,
    average speed, and queue estimate.
- qiliuchn/GATSim:
  https://github.com/qiliuchn/gatsim
  - Adopted: traffic agents should perceive traffic conditions, remember
    experiences, adapt schedules, re-route, and combine human-like decisions
    with transport simulation state.

## RealCity Application

- Vehicle signals now use a SUMO-inspired static cycle:
  - X-axis protected green
  - X-axis yellow clearance
  - all-red clearance
  - Z-axis protected green
  - Z-axis yellow clearance
  - all-red clearance
- Vehicles stop against stop bars, not the center of the intersection.
- Yellow means far vehicles decelerate, while close vehicles clear the
  intersection.
- All-red is treated as clearance; vehicles stop and pedestrians do not start a
  new crossing.
- Pedestrian WALK now requires a protected phase: the crossed vehicle axis must
  be red while the orthogonal vehicle axis has protected green.
- Runtime metadata exposes phase names, SUMO-like four-character states, stop
  rules, vehicle stop-bar samples, and pedestrian signal coupling for automated
  verification.
- The runtime now exposes the full six-phase `SUMO_TL_LOGIC` array, explicit
  vehicle links, separate `ped_cross_x` and `ped_cross_z` crossing links, and a
  controller record for every main-road intersection. Pedestrian route samples
  carry no-start, countdown, and source-program telemetry while they wait.
- Roads now carry lane and pedestrian policies: right-hand lane direction,
  sidewalk permissions, crossing control type, and gap-acceptance seconds.
- Main intersection controllers now include four SUMO-style detector records
  and an actuation-ready policy keyed to `TrafficFlowObserved` pressure.
- NPC pedestrian samples now expose `crosswalkControl`, priority/gap rule,
  gap-clear status, and nearest approaching vehicle when a conservative gap
  wait is triggered.
- A GBFS-shaped shared mobility layer now exists in `city.mobilitySystem.gbfs`:
  system information, vehicle types, station information, station status, and
  geofencing zones are generated near meaningful landmarks.
- A SmartCities-shaped policy layer now exists in `city.mobilitySystem.smartCity`:
  curb zones, parking/loading/taxi/bus purposes, TrafficFlowObserved segments,
  and parking enforcement rules are data rather than hidden constants.
- A GATSim-shaped transport policy layer now exists in `city.mobilitySystem.gatsim`:
  disruption events such as school release, station peak, and depot loading
  publish the decision signals and adaptive behaviors NPC mobility planners
  can use in later LLM prompts.
- NPC local-LLM autonomy now receives a live mobility context from those same
  layers: nearest GBFS dock availability, nearest legal curb zone, observed
  traffic flow, active geofence, and active GATSim event. The executable action
  set includes `use_shared_bike` and `use_shared_scooter`, and those choices
  become simulator routes with `shared-bike` or `shared-scooter` telemetry
  instead of staying as prompt-only flavor text.
- GBFS stations and SmartCities curb zones now render as physical street
  objects: painted dock pads, racks, bike/scooter props, kiosks, and colored
  curb-zone markings. NPC shared-bike/shared-scooter routes also attach visible
  ride props to the digital-human rig while the trip is active.
- Shared mobility trips now reserve and mutate GBFS station status at runtime:
  pickup inventory is decremented, a destination return slot is reserved, NPCs
  walk to the dock, unlock the bike/scooter, ride with a visible prop, return it
  into the reserved dock, and then continue on foot to the final destination.

## Next Traffic Targets

- Add explicit turn lanes and turn intentions.
- Use the new detector-like pressure to actually extend/shorten green splits
  in high-traffic areas.
- Add visible dock lock/hand pose animation and conflict handling when another
  NPC takes a reserved return slot.
