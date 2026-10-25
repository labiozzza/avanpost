# Peace V2 security boundaries

Status: loopback pairing, explicit private-IPv4 binding and direct-peer checks are implemented; physical-device verification remains outstanding, and there is no production security/authentication claim.

## Database boundary

- V2 configuration loads only root `.env.v2`; it never searches upward for `.env` and has no V1 URL fallback.
- Before connection, require the operation-specific exact database (`avanpost_v2_dev` for development/migration, `avanpost_v2_test` for tests), PostgreSQL scheme, loopback host/5434 or explicit compose service/5432, and no URL query/host overrides.
- After connection, verify `current_database()`, PostgreSQL server address/port and actual socket peer. Only then may migration or reset code run. Reject `avanpost`, `avanpost_test`, aliases, mismatches and unapproved addresses.
- Tests use only the V2 test target; no test command may invoke V1 migration or truncate unknown databases.

## Session and pairing

- G2 issues a cryptographically random 128-bit one-time code, expires it after five minutes, limits attempts to five per source per five-minute window, consumes it once and creates an owner-scoped session. LAN bind requires an explicit opt-in, an assigned RFC1918 IPv4 address, exact Host/Origin and an actual private socket peer. These are implementation defaults, not accepted GDD balance values; real-device verification remains outstanding.
- Before pairing, permit only a launcher-scoped read-only world preview with a minimal visual snapshot; omit owner/session identifiers and keep every mutation disabled. All private state and commands require the owner session.
- Pairing code handoff runs on a separate loopback-only port and checks the actual loopback socket peer, loopback Host and configured UI Origin. Session POST checks the API's actual socket peer (loopback or RFC1918 only when explicit LAN bind is active), API Host and exact UI Origin/Referer. The localhost-only Vite listener proxies `/api` to the private API bind to keep its cookie first-party; the API trusts no forwarded client-IP headers. The code stays memory-only and is reachable only from the launching computer.
- Never put the code in stdout/tool output, chat, URL/referrer, logs, evidence or persistent client storage. Clear transient input after successful pairing or page exit. Fail closed before pairing on every mutating route.
- Return reason-specific, safe recovery without code echo, remaining-attempt counts or internal validator details.

## Mutation and logging

Validate ownership, revision, coordinates, payload size and request ID before effect. Serialize conflicting world transitions and commit effect/result atomically. Logs use stable error codes and request IDs; redact cookies, credentials, URLs containing secrets and pairing codes.
