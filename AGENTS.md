# Metaverse Hub

The plaza that links the games, with accounts, tickets and Relics. The game repos and their ids are
listed in `README.md`, and milestone and server notes are in `docs/`.

- `apps/hub/` is the Three.js plaza, `packages/hub-sdk/` is the client the games import, `server/` is
  Nakama, Postgres and Caddy, and `deploy/` is production infrastructure.
- `packages/hub-sdk` is the contract with the games, which each keep a vendored copy. When it changes,
  say which game repos need to re-sync.
- Don't run deploys or change production unless the owner asks. Never commit real keys.

## Checks

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

`npm run test:dup` also runs in CI and needs Nakama running from `server/docker-compose.yml`.

## Art generation

Follow `docs/higgsfield-workflow-guide.md`. This repo uses both the **sprite sheet** and **rigged 3D character** workflows. If the owner says to skip approvals, follow that section of the guide.

## Working with other agents

Claude Code, Codex, Cursor and Grok Bot all work on this repo.

- Start each task on its own branch from the latest `main`, named `<agent>/<slug>`. Never push to
  `main`; open a pull request.
- On the owner's machine, `agent-task new metaverse-hub <slug> --agent <name>` creates that branch in
  its own worktree.
- Don't edit files that another active task is changing.
- Before choosing a migration number, check `docs/migration-allocations.md` and open PRs; unmerged reservations also count.
- Run the checks before opening a pull request, and report any you could not run.
- A different agent reviews the work: `agent-task review <path>`, or `/codex:adversarial-review` in
  Claude Code.
