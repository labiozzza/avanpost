import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceMapPath = path.join(projectRoot, 'docs/v2/SOURCE_MAP.md');
const testMatrixPath = path.join(projectRoot, 'docs/v2/TEST_MATRIX.md');
const sourceMap = readFileSync(sourceMapPath, 'utf8');
const testMatrix = readFileSync(testMatrixPath, 'utf8');
const failures = [];

const canonicalSources = [
  {
    path: 'AVANPOST_V2_MASTER_SPEC.md',
    sha256: '74e6207249ebbc0c45117f484525ac731a4f9a330f71536b9b56474525ced052'
  },
  {
    path: 'Avanpost_GDD_v0.9.md',
    sha256: '61bd13f8212409cfa8a253da6f56ed542ded0efef3b08289638619498678e671'
  },
  {
    path: 'docs/reference/peace-sideview-migration_ARCHIVE.md',
    sha256: 'e617e83118b40a6bffadee5fe61d59bd700be04c0aa400e8f920dec6171bd732'
  }
];
for (const source of canonicalSources) {
  const sourcePath = path.join(projectRoot, source.path);
  if (!existsSync(sourcePath)) {
    failures.push(`missing canonical source ${source.path}`);
    continue;
  }
  const digest = createHash('sha256').update(readFileSync(sourcePath)).digest('hex');
  if (digest !== source.sha256 || !sourceMap.includes(source.sha256)) {
    failures.push(`canonical source changed or receipt is stale: ${source.path}`);
  }
}

const requiredAnchors = [
  'Master §0.1–0.7', 'GDD §0.1–0.5', 'Master §1.1–1.3', 'Master §2.1–2.4',
  'Master §3.1–3.4', 'GDD §1.1', 'GDD §1.2', 'GDD §1.3', 'Master §4.4, §4.6', 'Master §4.5',
  'GDD §2.1', 'GDD §2.2', 'GDD §2.3', 'GDD §3.1', 'GDD §3.2', 'GDD §3.3',
  'GDD §3.4', 'GDD §3.5', 'GDD §4.1–4.2', 'Master §7.2–7.4', 'GDD §5.1–5.5',
  'GDD §6.1–6.2', 'GDD §13.3', 'GDD §15.1–15.2', 'GDD §15.4–15.5',
  'GDD §16.1–16.3', 'GDD §17.1–17.3', 'GDD §19.1–19.3', 'GDD §20.1–20.4',
  'GDD §20.5', 'GDD §20.6', 'Master §11.1–11.3', 'Master §12 G0–G11',
  'GDD §21.1', 'GDD §21.2', 'GDD §21.3', 'Master §13.1–13.3', 'GDD §23',
  'Master §14–15', 'GDD §24.1–24.4', 'Master §16–18'
];

for (const anchor of requiredAnchors) {
  if (!sourceMap.includes(anchor)) failures.push(`missing canonical anchor: ${anchor}`);
}

const requirementSection = sourceMap.split('## Requirement rows')[1]?.split('## Requirement-to-test links')[0] ?? '';
const requirementLines = requirementSection.split(/\r?\n/).filter((line) => /^\| REQ-\d{4} \|/.test(line));
const ids = [];
const statusById = new Map();
const statuses = new Set(['NOT_STARTED', 'IN_PROGRESS', 'PASS', 'FAIL', 'BLOCKED', 'NOT_APPLICABLE']);

for (const [index, line] of requirementLines.entries()) {
  const cells = line.split('|').slice(1, -1).map((cell) => cell.trim());
  const [id, anchors, contract, gate, owner, assertion, recovery, evidence, status] = cells;
  if (cells.length !== 9) {
    failures.push(`row ${index + 1} must have 9 populated columns, got ${cells.length}`);
    continue;
  }
  ids.push(id);
  statusById.set(id, status);
  if (id !== `REQ-${String(index + 1).padStart(4, '0')}`) failures.push(`non-contiguous/unstable requirement ID: ${id}`);
  const evidencePathCell = (evidence ?? '').replace(/^`|`$/g, '');
  for (const [field, value] of Object.entries({ anchors, contract, gate, owner, assertion, recovery, evidence: evidencePathCell, status })) {
    if (!value || /\b(TBD|TODO|FIXME)\b/i.test(value)) failures.push(`${id} has an empty/unresolved ${field} field`);
  }
  const contractReferences = [...(contract ?? '').matchAll(/`([^`]+)`/g)]
    .map((match) => match[1])
    .filter((reference) => reference.includes('/') || /\.(md|ts|json|yaml|yml|sql)$/.test(reference));
  if (contractReferences.length === 0) failures.push(`${id} must link a concrete V2 contract/artifact path`);
  for (const reference of contractReferences) {
    const rootReference = path.join(projectRoot, reference);
    const referencePath = existsSync(rootReference) ? rootReference : path.join(projectRoot, 'docs/v2', reference);
    if (!existsSync(referencePath)) failures.push(`${id} links a missing contract/artifact: ${reference}`);
  }
  if (!/^OpenCode$/.test(owner ?? '')) failures.push(`${id} owner must be OpenCode`);
  if (!/^docs\/v2\/evidence\/(G0|G1|G2|G3|G4|G5|G6|G7|G8|G9|G10|G11)\/REQ-\d{4}\/$/.test(evidencePathCell)) {
    failures.push(`${id} evidence path must be gate-scoped`);
  }
  if (!statuses.has(status ?? '')) failures.push(`${id} has unsupported status ${status}`);
  if (status === 'PASS') {
    const absoluteEvidencePath = path.join(projectRoot, evidencePathCell);
    if (!existsSync(absoluteEvidencePath) || readdirSync(absoluteEvidencePath).length === 0) {
      failures.push(`${id} is PASS but its requirement evidence directory is absent or empty`);
    }
  }
}

if (requirementLines.length === 0) failures.push('no REQ rows found');
if (new Set(ids).size !== ids.length) failures.push('duplicate REQ IDs found');

const rationaleSection = sourceMap.split('## Status rationale')[1]?.split('\n## ')[0] ?? '';
const rationaleLines = rationaleSection.split(/\r?\n/).filter((line) => /^\| REQ-\d{4} \|/.test(line));
const rationaleIds = [];
for (const line of rationaleLines) {
  const [id, rationale] = line.split('|').slice(1, -1).map((cell) => cell.trim());
  rationaleIds.push(id);
  if (!rationale || /\b(TBD|TODO|FIXME)\b/i.test(rationale)) failures.push(`${id} has no status rationale`);
  if (!statusById.has(id)) failures.push(`status rationale references unknown requirement ${id}`);
  if (statusById.get(id) === 'PASS' && !rationale?.toLowerCase().includes('evidence')) {
    failures.push(`${id} is PASS without an evidence rationale`);
  }
}
if (JSON.stringify(rationaleIds) !== JSON.stringify(ids)) {
  failures.push('status rationale rows must match every REQ ID in order');
}

const scenarioIds = [...testMatrix.matchAll(/^\| (I-E2E-\d{2}) \|/gm)].map((match) => match[1]);
const expectedScenarioIds = Array.from({ length: 30 }, (_, index) => `I-E2E-${String(index + 1).padStart(2, '0')}`);
if (JSON.stringify(scenarioIds) !== JSON.stringify(expectedScenarioIds)) {
  failures.push('TEST_MATRIX.md must preserve the ordered I-E2E-01..30 scenario IDs');
}

for (const id of ['V2-BASELINE-01', 'V2-DBSAFE-01', 'V2-PAIR-01', 'V2-PV-01', 'V2-G2-SLICE-01']) {
  if (!testMatrix.includes(id)) failures.push(`missing supplemental regression row ${id}`);
}

const excludedRows = [
  'GDD §§7–12 and 18',
  'GDD §§13.1–13.2 and 13.4–13.11',
  'GDD §14'
];
for (const exclusion of excludedRows) {
  if (!sourceMap.includes(exclusion)) failures.push(`missing explicit scope exclusion: ${exclusion}`);
}

const matrixRows = testMatrix.split(/\r?\n/).filter((line) => /^\| (I-E2E-\d{2}|V2-[A-Z0-9-]+) \|/.test(line));
const availableTestIds = new Set(
  matrixRows.map((line) => line.split('|')[1].trim().replace(/^`|`$/g, ''))
);
const mappingSection = sourceMap.split('## Requirement-to-test links')[1]?.split('## Status rationale')[0] ?? '';
const mappingLines = mappingSection.split(/\r?\n/).filter((line) => /^\| REQ-\d{4} \|/.test(line));
const mappedRequirementIds = [];
for (const line of mappingLines) {
  const [id, rawTestIds] = line.split('|').slice(1, -1).map((cell) => cell.trim());
  mappedRequirementIds.push(id);
  const linkText = (rawTestIds ?? '').replaceAll('`', '');
  const linkedIds = new Set([...linkText.matchAll(/\b(?:I-E2E-\d{2}|V2-[A-Z0-9-]+)\b/g)].map((match) => match[0]));
  const range = /I-E2E-(\d{2})\s*[–-]\s*I-E2E-(\d{2})/.exec(linkText);
  if (range) {
    for (let scenario = Number(range[1]); scenario <= Number(range[2]); scenario += 1) {
      linkedIds.add(`I-E2E-${String(scenario).padStart(2, '0')}`);
    }
  }
  if (linkedIds.size === 0) failures.push(`${id} has no linked executable test/evidence ID`);
  for (const linkedId of linkedIds) {
    if (!availableTestIds.has(linkedId)) failures.push(`${id} links an absent test ID ${linkedId}`);
  }
}
if (JSON.stringify(mappedRequirementIds) !== JSON.stringify(ids)) {
  failures.push('requirement-to-test links must contain every REQ ID in order');
}

for (const line of matrixRows) {
  const cells = line.split('|').slice(1, -1).map((cell) => cell.trim());
  const [id, , , , , rawEvidence, status] = cells;
  if (status !== 'PASS') continue;
  const evidencePath = (rawEvidence ?? '').replace(/^`|`$/g, '');
  const absolutePath = path.join(projectRoot, 'docs/v2', evidencePath);
  if (!existsSync(absolutePath) || readdirSync(absolutePath).length === 0) {
    failures.push(`${id} is PASS but its evidence directory is absent or empty`);
  }
}

const contractFiles = [
  'DECISIONS.md', 'BASELINE.md', 'AGENT_RUNBOOK.md', 'PLAY_NOW.md', 'API.md',
  'SCHEMA.md', 'SIMULATION.md', 'ECONOMY.md', 'BUILDINGS.md', 'SECURITY.md',
  'ERROR_REGISTRY.md', 'CONTENT.md', 'UI.md'
];
for (const file of contractFiles) {
  if (!existsSync(path.join(projectRoot, 'docs/v2', file))) failures.push(`missing contract artifact docs/v2/${file}`);
}

for (const workspace of [
  'apps/client-v2/package.json',
  'apps/server-v2/package.json',
  'packages/peace-v2-shared/package.json',
  'packages/peace-v2-sim/package.json'
]) {
  if (!existsSync(path.join(projectRoot, workspace))) failures.push(`missing isolated V2 workspace ${workspace}`);
}

const packageJson = JSON.parse(readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
for (const script of [
  'check:peace:v2:source-map', 'check:peace:v2:contracts', 'check:peace:v2:status', 'test:peace:v2', 'e2e:peace:v2', 'build:peace:v2',
  'doctor:peace:v2', 'dev:peace:v2', 'dev:peace:v2:stop', 'db:peace:v2:up',
  'db:peace:v2:stop', 'db:peace:v2:migrate', 'db:peace:v2:test:migrate', 'reset:peace:v2:test-world',
  'db:peace:v2:manual:create', 'db:peace:v2:manual:migrate', 'prepare:peace:v2:manual',
  'dev:peace:v2:manual', 'dev:peace:v2:manual:stop'
]) {
  if (!packageJson.scripts?.[script]) failures.push(`missing root command ${script}`);
}

for (const file of ['.env.v2.example', 'docker-compose.v2.yml', 'vitest.peace-v2.config.ts', 'playwright.peace-v2.config.ts']) {
  if (!existsSync(path.join(projectRoot, file))) failures.push(`missing V2-only infrastructure/config file ${file}`);
}

if (failures.length) {
  console.error(`SOURCE_MAP_CHECK: FAIL failures=${failures.length}`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log(
    `SOURCE_MAP_CHECK: PASS_STRUCTURE requirements=${requirementLines.length} scenarios=${scenarioIds.length} required_supplemental=4 baseline=1 evidence-bearing-PASS-rows=${matrixRows.filter((line) => line.split('|').slice(1, -1).at(-1)?.trim() === 'PASS').length}; unimplemented gate rows remain independently gated`
  );
}
