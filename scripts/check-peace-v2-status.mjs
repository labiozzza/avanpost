import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const status = readFileSync(path.join(projectRoot, 'docs/v2/STATUS.md'), 'utf8');
const nextAction = readFileSync(path.join(projectRoot, 'docs/v2/NEXT_ACTION.md'), 'utf8');
const playNow = readFileSync(path.join(projectRoot, 'docs/v2/PLAY_NOW.md'), 'utf8');
const failures = [];

const fields = [
  'Branch', 'HEAD', 'Current gate', 'Playable V2', 'Computer URL', 'Phone URL',
  'V2 API health', 'V1 safety', 'V2 database', 'Tests', 'Gstack', 'Inputs',
  'Known blockers', 'Next action'
];
for (const field of fields) {
  if (!status.includes(`| ${field} |`)) failures.push(`STATUS.md omits field: ${field}`);
}

const livePlaytest = /\| Playable V2 \| RUNNING for owner playtest/.test(status);
if (livePlaytest) {
  const computerUrl = status.match(/\| Computer URL \| `(https?:\/\/localhost:\d+\/)` — HTTP 200 in headed Chromium/);
  const phoneUrl = status.match(/\| Phone URL \| `(http:\/\/(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}):\d+\/)` — HTTP 200/);
  if (!computerUrl) failures.push('STATUS.md computer URL must be localhost and browser-verified');
  if (!phoneUrl) failures.push('STATUS.md phone URL must be a private IPv4 and browser-verified');
  if (computerUrl && !playNow.includes(`<${computerUrl[1]}>`)) failures.push('PLAY_NOW.md must carry the exact verified computer URL');
  if (phoneUrl && !playNow.includes(`<${phoneUrl[1]}>`)) failures.push('PLAY_NOW.md must carry the exact verified private URL');
  if (!status.includes('physical phone pending')) failures.push('STATUS.md must distinguish mobile emulation from physical-phone verification');
  if (!playNow.includes('SHA-256: `')) failures.push('PLAY_NOW.md must record the actual client bundle SHA-256');
} else {
  if (!/\| Playable V2 \| NO current URL/.test(status)) failures.push('STATUS.md must not claim an active owner-play URL without live browser verification');
  if (!/\| Computer URL \| N\/A/.test(status)) failures.push('STATUS.md must not publish an unverified computer URL');
  if (!/\| Phone URL \| N\/A/.test(status)) failures.push('STATUS.md must not publish an unverified phone URL');
}
if (!/\| Current gate \|[^\n]*G1 `PASS` by user D7-A[^\n]*G2 `IN_PROGRESS`/.test(status)) {
  failures.push('STATUS.md must record the D7-A G1 disposition and active G2 implementation');
}
if (!status.includes('NOT_STARTED')) failures.push('STATUS.md must preserve unrun scenario statuses');
if (/STAGE_I_AUTO_QA:\s*PASS/.test(status)) failures.push('STATUS.md cannot claim final Stage I QA PASS');
if (!nextAction.includes('Next operation: continue G2 persistent playable slice') &&
    !nextAction.includes('Next operation: owner acceptance for G2.1 live settlement')) {
  failures.push('NEXT_ACTION.md must name the active G2/G2.1 continuation');
}
if (!nextAction.includes('G1 is `PASS` by user D7-A') || !nextAction.includes('no independent reread is claimed')) {
  failures.push('NEXT_ACTION.md must preserve the D7-A disposition and CEO review concern');
}

if (failures.length) {
  console.error(`STATUS_CHECK: FAIL failures=${failures.length}`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`STATUS_CHECK: PASS fields=14 playable=${livePlaytest ? 'live-G2-slice' : 'no-current-url'} urls=${livePlaytest ? 'headed-local/private-lan-verified' : 'unverified'} gate=G0-pass/G1-user-disposition-pass/G2-in-progress`);
}
