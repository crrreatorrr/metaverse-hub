# M3 hub visuals

Orbit gems, living portals, the Hall of Champions, and the bar wall screen are created in `createWorld`. `scene.ts` ticks them from `HubWorld.update`.

Stub names, counts, and champion rows load only when `import.meta.env.DEV` is true. That branch is stripped from the production build, and `./m3/stub` is not on the prod import graph. Production renders the empty state: the local avatar's real Relics (from `setRelics`), portals at 0 players, an empty Hall roster, and no bar screen. Nothing here calls Nakama or adds a schema.

The bar screen stays on `createStubLeaderboardProvider()` in dev until leaderboards land. It is hidden in production so the existing verse board stays. While the dev screen is up, `leaderboard-wall-screen` is hidden so the two canvases do not stack. Dev copy is watermarked `DEV PLACEHOLDER`.

Walking into the Hall is not wired. The door sits on the pedestal, and `main.ts` (open PR #25) clamps the camera and the floor to the plaza or the bar. A warp to `HALL_SPAWN` needs that file.

```ts
const devPreview = import.meta.env.DEV;
const living = addLivingPortals(outdoor, { placeholder: devPreview });
const hall = addHallOfChampions(scene, { placeholder: devPreview, open: false });
outdoor.add(hall.door);
const gems = addOrbitGems(scene, { avatars: [{ id: 'local', anchor: rig, relics: [] }] });
let provider = createEmptyLeaderboardProvider();
if (devPreview) {
  const stubs = await import('./m3/stub');
  gems.setAvatars([{ id: 'local', anchor: rig, relics: [] }, ...stubs.createStubOrbitAvatars()]);
  living.setPresence(stubs.STUB_PORTAL_PRESENCE);
  hall.setChampions(stubs.STUB_CHAMPIONS);
  hall.setOpen(true);
  provider = stubs.createStubLeaderboardProvider();
}
const bar = addBarLeaderboardScreen(scene, {
  provider,
  placeholder: devPreview,
  onNewNumberOne: (event) => {
    if (!devPreview || !event.gameId) return;
    living.pushFinisher({
      gameId: event.gameId,
      name: event.row.name,
      line: `New #1 · ${event.title}`,
    });
  },
});
```

`setRelics` keeps the local orbit gems in both builds. In production it also opens the Hall door once that player owns all four Relics. The roster stays empty until a live list exists.

`pushFinisher` is the shared finisher queue: one banner per portal per 10 seconds. The banner stays up 8 seconds. The firework lasts 5. Dev New #1 rows use that same gate.

## Draw calls and download

Instancing keeps gems, rings, beams, fireworks, and hall gems at one draw each. Ten avatars do not add draws.

| State | Draws |
| --- | --- |
| Steady: hall sealed, no finisher, no portal beam | 11 |
| Peak: hall open, sky beam, four banners, fireworks | 20 |

Steady is orbit gems + rings + 4 labels + hall arch + seal + plaque + bar bezel + bar screen. Peak adds the beam, 4 banners, fireworks, room shell, roster, hall gems, and the open-door beam, and hides the seal.

These modules load no images, fonts, or glTF. Canvases are painted at runtime. Production does not include `stub.ts`. The hub budget is under 8 MB for first load and under 100 draws with 10 avatars. Twenty peak draws leaves the rest of the plaza inside that cap. Passing `camera` into `living.update` hides labels and banners past 40 m.

## Placeholder art

Swap these meshes when final art lands. Names are on the objects.

| Object | Stand-in | Replace with |
| --- | --- | --- |
| `m3-orbit-gems` | One `OctahedronGeometry`, `MeshBasicMaterial`, instance colors `#ff2ea6` `gem_hpos`, `#f5b942` `gem_pb`, `#3ec6ff` `gem_nobu`, `#8d6bff` `gem_duel` | Four relic gem meshes. Sockets in the architecture are `socket_orbit`, `socket_back`, `socket_shoulder_R`, `socket_head`. M3 orbits them around the rig. |
| `m3-portal-rings` | Instanced `TorusGeometry`, flat color per portal (`#39ff6a`, `#ff8a1f`, `#ffc233`, `#7b5cff`) | Glow shell on the existing portal gate. Brightness is the tier (0, 1–2, 3–5, 6+). |
| `m3-portal-beams` | Instanced open `CylinderGeometry`, additive | Short column at 1–5 players, sky beam at 6+. Hidden at 0. |
| `m3-portal-label-*` | `PlaneGeometry` + `CanvasTexture`, system sans-serif | Holo label (count, up to three names, that game's top 10). Fades from 25 m to 40 m. One canvas per portal, one draw each. |
| `m3-portal-banner-*` | `PlaneGeometry` + `CanvasTexture` | 8-second finisher / New #1 banner. |
| `m3-portal-fireworks` | Instanced `IcosahedronGeometry`, additive | Firework sprites, 5 seconds. |
| `m3-hall-shell` | Merged boxes, vertex colors (floor `#1a1030`, walls `#241538`, plinths `#3a2d55`, trim `#00e5ff` / `#ff3bd4`) | Hall of Champions room. |
| `m3-hall-roster` | `PlaneGeometry` + `CanvasTexture` | Ordered list of players who own all four Relics. |
| `m3-hall-gems` | Instanced octahedrons in the four relic colors | Relic markers on the plinths. |
| `m3-hall-arch` | `TorusGeometry`, `#6d4eb5` sealed / `#ffd21f` open | Monument portal frame. |
| `m3-hall-seal` | `CircleGeometry` `#140a22` | Sealed central portal. Hidden once the local player owns all four. |
| `m3-hall-plaque` | `PlaneGeometry` + `CanvasTexture` | Door title. |
| `m3-hall-beam` | Additive `CylinderGeometry` `#ffd21f` | Column shown only while the door is open. |
| `m3-bar-bezel` | `BoxGeometry` `#ff3bd4` | Screen frame on the bar wall. |
| `m3-bar-screen` | `PlaneGeometry` + one `CanvasTexture` | Cycling wall screen. |

Boards on that screen, in order: `hpos10i_act_time`, `nobu_trial_time`, `pb_total_xp`, `sproto_wins`, `verse_by_game_hpos10i`, `verse_by_game_nobu`, `verse_by_game_peoples-bitcoin`, `verse_by_game_sproto`, `verse_total`. Eight seconds each. Time boards sort low to high and the stub stores seconds. The screen refetches a board after 45 seconds.

There is no troika-three-text and no signed font in these placeholders. Text is `sans-serif` on the canvas.
