# Ridgeline 4x4

A lightweight, phone-friendly **co-op off-road exploration game** for the browser, inspired by
*over the hill*. Drive a little 4x4 through procedurally generated wilderness with up to 3 friends:
hunt fallen meteorites to power ancient portals, climb to viewpoints, stop at cabins to customise
your truck, photograph wildlife, and use **planks** and the **winch** to get each other over the hill.

> This is a driving game, not a racing game. Take your time.

## Features

- **4 regions** that cycle as the team travels through portals: Willow Valley, Pine Lakes,
  Rust Canyon (terraced mesas) and Frostpeak Ridge (snow). Each world is generated from the room seed,
  so every player sees the identical map without downloading any assets.
- **Co-op multiplayer** for up to 4 drivers per expedition. Share a 5-letter room code or invite link.
  Discoveries, meteorites, upgrades, planks and the wildlife compendium are shared by the team.
- **Off-road physics**: custom raycast-suspension 4x4 with tyre grip per surface (grass, dirt, rock,
  sand, snow, wet weather), water fording, engine flooding (the snorkel helps) and recoveries.
- **Tools**: lay planks to bridge streams or make ramps, and winch to trees, rocks or a teammate.
- **Exploration**: cabins (garage: paint and accessories, rest until morning), viewpoints (reveal the map),
  landmarks, supply crates (team upgrades), meteorites with light beams and portals.
- **Wildlife and photo mode**: 14 low-poly species, a shared compendium and a photo gallery with save/share.
- **Dynamic day/night and weather**: rain, fog, snow and dust storms, all synced across players.
- **Phone friendly**: touch steering pad, pedals and big buttons, landscape and portrait layouts,
  auto "Low" graphics on phones, adaptive resolution, fullscreen and installable (PWA manifest).
  Keyboard and gamepad are supported too.
- **Light**: about 180 KB gzipped in total (three.js included), no textures, models or audio files.
  Everything is generated or synthesised at runtime.

## Tech

| Part | Tech |
| --- | --- |
| Rendering | [three.js](https://threejs.org) r186 (WebGL2), vertex-coloured low-poly meshes, one draw call per terrain chunk |
| Build | [Vite](https://vite.dev) 8 (Rolldown), modern ES modules |
| Physics | Custom 120 Hz rigid-body + raycast wheels (`src/client/vehicle/physics.js`); no physics engine to download |
| Audio | WebAudio synthesis (`src/client/audio/audio.js`) |
| Server | Node.js 24 + [`ws`](https://github.com/websockets/ws); serves the client and relays rooms |
| Shared logic | `src/shared/room.js` runs on the server *and* in the browser for offline play |

## Play locally (development)

```bash
npm install
npm run dev        # game server on :8080 + Vite on http://localhost:5173 (hot reload)
```

Or run the production build:

```bash
npm run build
PORT=8088 npm start   # http://localhost:8088
npm test              # room logic, world determinism and vehicle physics tests
```

To test multiplayer alone, open the game in two browser tabs (each tab is its own driver),
or start a bot driver that circles you: `node scripts/bot.mjs <ROOM> ws://localhost:8088/ws`.

## Deploy with Docker Compose

```bash
git clone <your-repo-url> ridgeline && cd ridgeline
cp .env.example .env          # optional: change HOST_PORT, update interval, branch
docker compose up -d --build
```

The game is served on `http://<host>:8088`. Put it behind your usual reverse proxy for HTTPS.
WebSockets use the same origin at `/ws`, so `wss://` works automatically. Room progress is stored in
the `gamedata` volume and survives restarts and updates. On first start, the updater rebuilds once
(from cache, quick) to stamp the current commit into the image. Stop everything with `docker compose down`.

### Auto-update on every git commit

The compose file includes an **`updater`** service. It watches the git checkout and redeploys the game
whenever a new commit appears:

1. Every `UPDATE_INTERVAL` seconds (default 30) it runs `git fetch` on the tracked remote/branch and
   fast-forwards the checkout when you have pushed new commits. Local commits made directly in the
   checkout are picked up too.
2. When `HEAD` differs from the commit baked into the running container, it runs
   `docker compose up -d --build game` with the commit hash as the image version.
3. The server saves rooms and closes connections with "restarting". Browsers reconnect, notice the
   new version, and reload in place: same room, same spot on the map.

```bash
git commit -am "Tune winch" && git push    # the server updates itself within ~30 s
docker compose logs -f updater             # watch it happen
curl http://<host>:8088/version            # {"version":"<commit>","uptime":...}
```

Notes:

- The updater needs the Docker socket (`/var/run/docker.sock`), which gives it root-equivalent
  control of Docker on that host. Only run it on a host you trust.
- **Private repositories:** the updater runs `git fetch` inside its container, so the checkout's remote
  must be reachable from there. Use an HTTPS remote with a token
  (`git remote set-url origin https://<token>@github.com/you/repo.git`) or mount a read-only deploy key
  into the updater (`- ~/.ssh:/root/.ssh:ro`).
- A failed build is logged and retried on the next commit. The previous version keeps running.
- Disable auto-update with `UPDATE_INTERVAL=0`, or run only the game: `docker compose up -d game`.
- After changing `deploy/updater.sh`, the updater reloads itself automatically.

## Controls

| Action | Keyboard | Touch | Gamepad |
| --- | --- | --- | --- |
| Drive / reverse | W/S or ↑/↓ | GAS / BRAKE pedals | RT / LT |
| Steer | A/D or ←/→ | drag the steer pad | left stick |
| Handbrake | Space | 🅿️ | A |
| Winch (toggle) | Q / F | 🪝 | X |
| Plank (place / pick up) | E | 🪵 | Y |
| Recover truck | R | 🔄 | B |
| Photo mode / shutter | P / Enter | 📷 | D-pad up |
| Horn, emotes | H, T or 1-8 | 📯, 😀 | LB |
| Camera view, look around | C, drag mouse / wheel | 🎥, drag / pinch | RB, right stick |
| Map, journal, garage, menu | M, J, G, Esc | minimap, 📔, 🔧, ☰ | Back, D-pad, Start |

## Project layout

```
server/index.js          HTTP + WebSocket server (static files, rooms, persistence, /healthz, /version)
src/shared/              room logic + constants shared by server and client
src/client/world/        terrain, biomes, generation (POIs, A* trails, vegetation), sky/weather, wildlife
src/client/vehicle/      4x4 physics and low-poly model
src/client/game/         game loop, camera
src/client/net/          WebSocket/offline transports, remote player interpolation
src/client/ui/, input/, audio/
deploy/updater.sh        git-watching auto-deploy loop used by docker compose
```
