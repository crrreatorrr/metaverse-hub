# Tidebreaker Belt item assets

The Tidebreaker Belt (Sproto Fighter, Story World 1) unlocks one item in each of the four other
games. Gameplay and placeholder visuals are already in each game's `claude/sweet-newton-l4tjnh`
branch. The approved art below was generated on Higgsfield and still needs to be downloaded into
each repo. The cloud session that made it could not reach Higgsfield's CDN
(`d8j0ntlcm91z4.cloudfront.net`), so nothing here is in a repo yet.

Each game falls back to its code-built placeholder until its file exists. No code change is needed
to switch over, except where noted.

| Item | Game | Approved concept (job) | 3D model (job) | Goes to |
| --- | --- | --- | --- | --- |
| Fighter's Might (staff) | Sproto Duel | `ded336fa-4c1d-4e5f-9c6f-fcae8d6e2745` | `221226f5-0a0c-4062-99ae-b6324832bad6` (Tripo H3.1, 8000 faces, PBR) | `public/assets/models/staffs/staff_fighters_might.glb` and the `-lod1.glb` the game loads. Name the gauntlet glow material `staff_fighters_might_gauntlet_glow_mat`. Hub avatar copy: `apps/hub/public/world/v2/staffs/staff_fighters_might.glb`, icon `apps/hub/public/world/v2/staffs/icons/fighters_might.webp` (from the concept). |
| Champion's Crown (head) | NOBU | `de7080a0-486f-4a43-9e57-00c3800e4d23` (crown alone: `5d55748c-1b5b-4d3f-908a-fd3df87578d1`) | `1fe5159c-b1a3-4b41-b0c8-17653ee22b1a` (Tripo H3.1, 6000 faces, PBR) | `public/assets/models/nobu_champions_crown.glb`, asset id `model_nobu_champions_crown`. Fill the pending entry in `tools/asset_list_extra.json`, then `python3 tools/process_assets.py model_nobu_champions_crown`. |
| Champion Sproto (summon) | People's Bitcoin | sprite `e3df2047-ed60-4e7e-a4d5-d07c7bba31a9`, low-poly concept `50a8e4f5-5f15-471f-8271-a0347517298a` | `4f6813da-c5fc-4c0c-bba8-9fc34bed33aa` (Tripo H3.1, 3000 faces, no PBR), not rigged yet | Sprite: crop and downscale to `src/assets/sprites/sp_champion.png` (ART_GUIDE.md). Model: `python3 tools/turn_glb.py`, Meshy rigging at Sproto height, then `tools/shrink_glb.py` to `src/assets/models/sp_champion.glb`. |
| Tidebreaker skin (body) | HPOS10I | `c94642bc-098e-4762-891d-8b72e2f21cc9` | none: the player is drawn in code | Optional future frames: `res://assets/sprites/common/sproto/tidebreaker_sproto_frames.tres`. |

Job ids open in the Higgsfield library. Their result files are under
`https://d8j0ntlcm91z4.cloudfront.net/user_.../hf_<date>_<time>_<job id>.<png|glb>`.
