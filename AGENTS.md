# AVANPOST project guardrails

- Work only on the checked-out branch; preserve the current GDD and project status.
- Treat `docs/v2/STATUS.md`, `docs/v2/NEXT_ACTION.md`, `docs/v2/PLAY_NOW.md`, and `docs/v2/MANUAL_TEST_WORLDS.md` as the current operational references. Some historical status text may mention another branch; never switch branches because of it.
- Keep Peace V2 commands and databases isolated. Never run V1 commands, reset `avanpost_v2_dev`, or target any database until its identity has been checked.
- Use `npm ci` and the committed lockfile. Run the relevant typecheck, contracts, source-map, status, tests, build, and browser checks before claiming success.
- Do not change gameplay mechanics or accepted GDD requirements to make environment setup or tests pass. Diagnose and document failures first.
- Do not force-push, merge, deploy, rewrite history, delete Docker volumes, or expose secrets. Ask before destructive actions or changes outside the requested task.
- Keep credentials in ignored local files or environment variables. Never print, commit, or transmit secrets.
- Keep agent work in its own Git worktree and branch. Michael integrates changes; other agents do not commit or push unless explicitly authorized.
- The Artist may generate and process art only when a real image-generation tool is available. Never claim a text model created an image. Use the isolated Pillow environment at `~/.local/share/avanpost/art-venv`.
- QA independently checks behavior against the GDD, separates automated evidence from owner acceptance, and never modifies implementation code.
