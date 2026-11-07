# LITE-E2E-05 revocation evidence

- Environment: isolated disposable PostgreSQL `avanpost_v2_lite_test_20261107`; owner and editor used real Chromium sessions.
- Immediately before revocation, the editor committed a valid work-role command. The owner then read the shared world and observed the same committed world version and role change.
- Owner revoked that editor membership (HTTP 200). A later `/api/me` resolved to the editor's private owner world; `/api/worlds` omitted the shared world; selecting the revoked shared world returned 403.
- The editor then submitted a valid command while adding the formerly shared world ID as a query parameter. It returned 200 only for the editor's private world. PostgreSQL confirms the request ID exists once under the private world and not under the revoked shared world. The shared world retained the owner's accepted last commit.
- Reload on the editor session restored the private world, not the revoked shared world; browser console had no errors.
- Artifacts: `editor-fallback-after-revoke.jpeg`, `editor-revocation-reload-trace.json.gz`.

The V1 client/API scopes commands to the session's currently authorized world. After revocation the session falls back to its private world rather than returning 403 for ordinary commands; explicit shared-world selection is denied. No post-revocation write reached the shared world.
