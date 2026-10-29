# M3 hub visuals (unwired)

Placeholder meshes for orbit gems, living portals, the Hall of Champions, and the bar wall screen. Nothing here is imported by `scene.ts`. After PR #15 merges, add the calls below inside `createWorld` and tick them from `HubWorld.update`.

No Nakama calls. Leaderboard data goes through `LeaderboardProvider`. `createStubLeaderboardProvider()` is the stand-in.

## Wiring

```ts
import {
  addBarLeaderboardScreen,
  addHallOfChampions,
  addLivingPortals,
  addOrbitGems,
  createStubLeaderboardProvider,
  createStubOrbitAvatars,
  STUB_CHAMPIONS,
  STUB_PORTAL_PRESENCE,
} from './m3';

const gems = addOrbitGems(scene, { avatars: createStubOrbitAvatars() });
const portals = addLivingPortals(scene, { presence: STUB_PORTAL_PRESENCE });
const hall = addHallOfChampions(scene, { champions: STUB_CHAMPIONS, open: false });
const bar = addBarLeaderboardScreen(scene, {
  provider: createStubLeaderboardProvider(),
  onNewNumberOne: (event) => {
    if (!event.gameId) return;
    portals.pushFinisher({
      gameId: event.gameId,
      name: event.row.name,
      line: `New #1 · ${event.title}`,
    });
  },
});

// Inside HubWorld.update, `elapsed` is accumulated seconds:
gems.update(elapsed);
portals.update(elapsed, camera);
hall.update(elapsed);
bar.update(elapsed);
```

Live presence replaces the stubs. Pass the hub `rig` (or a remote avatar root with the same origin) as `anchor`. The hall door stays sealed until that player owns all four Relics. Walking into the open door is the follow-up's warp to `HALL_SPAWN`.

```ts
gems.setAvatars(avatars);
portals.setPresence(presence);
hall.setChampions(champions);
hall.setOpen(ownedRelics.length === 4);
portals.pushFinisher({ gameId: 'sproto', name: 'sproto', line: 'defeated Tinubu' });
```

`pushFinisher` is the shared finisher queue: one banner per portal per 10 seconds, whether the line is a clear or a New #1. The banner stays up 8 seconds. The firework lasts 5.

The bar screen pose is `BAR_SCREEN_POSE`, on the club's +X wall, 6 cm in front of the M2 `leaderboard_screen`. Hide that M2 mesh when wiring so the two canvases do not stack. `bar.root` is already in world space (interior root `(0, -300, 0)`). Set `bar.root.visible` from the same flag that shows the club interior.

Passing `camera` into `portals.update` hides labels and banners past 40 m, so a player draws at most one portal card. The table below is the upper bound, with every mesh visible.

## Draw calls and download

Instancing keeps gems, rings, beams, fireworks, and hall gems at one draw each. Ten avatars do not add draws.

| State | Draws |
| --- | --- |
| Steady: hall sealed, no finisher, no portal beam | 11 |
| Peak: hall open, sky beam, four banners, fireworks | 20 |

Steady is orbit gems + rings + 4 labels + hall arch + seal + plaque + bar bezel + bar screen. Peak adds the beam, 4 banners, fireworks, room shell, roster, hall gems, and the open-door beam, and hides the seal.

These modules load no images, fonts, or glTF. Canvases are painted at runtime. They are not on the plaza import graph yet, so the production bundle does not grow until the follow-up imports them. The hub budget that matters here is under 8 MB for first load and under 100 draws with 10 avatars. Twenty peak draws leaves the rest of the plaza inside that cap.

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
