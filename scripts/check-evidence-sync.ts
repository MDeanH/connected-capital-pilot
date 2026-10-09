// Evidence-map sync gate. The evidence map has one source of truth —
// reference/market-predictability-evidence/{families.json, evidence.csv} — and
// four derived copies: the reference viz, the viz served by the app (public/),
// the standalone Netlify site (sites/evidence-map/index.html), and the EVIDENCE
// tab's JSON. bake_evidence_network.py writes all four; this gate fails the
// build if any of them drifted, so a data correction can never ship with a
// stale deployed visualization.
//
// Deliberately Node-only (no Python in the Netlify build): it re-derives
// nothing, it compares bytes and checks the inputs fingerprint that the bake
// stamps into the payload.
//
// Run: npm run gate:evidence
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const ROOT = new URL('../', import.meta.url);
const EV = 'reference/market-predictability-evidence/';
const FAMILIES = `${EV}financial-market-predictability-families.json`;
const CSV = `${EV}financial-market-predictability-evidence.csv`;
const REF_HTML = `${EV}evidence-network.html`;
const PUBLIC_HTML = 'public/evidence-network.html';
const STANDALONE_HTML = 'sites/evidence-map/public/index.html';
const APP_FAMILIES = 'src/data/evidence-families.json';

const START = '/*==GRAPH-DATA-START==*/';
const END = '/*==GRAPH-DATA-END==*/';
const REBAKE = `python3 ${EV}bake_evidence_network.py`;

const read = (rel: string) => readFileSync(new URL(rel, ROOT));

let pass = 0, fail = 0;
const check = (name: string, ok: boolean, detail = '') => {
  (ok ? pass++ : fail++);
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ` ${detail}` : ''}`);
};

console.log('EVIDENCE MAP SYNC:');

// 1. Every published copy must be the baked viz, byte for byte.
const refHtml = read(REF_HTML);
const publicHtml = read(PUBLIC_HTML);
check('app-served viz == baked viz', refHtml.equals(publicHtml),
  `(${PUBLIC_HTML} vs ${REF_HTML})`);
check('standalone site == baked viz', refHtml.equals(read(STANDALONE_HTML)),
  `(${STANDALONE_HTML})`);

// 2. The EVIDENCE tab's JSON must be the synced families file, byte for byte.
const familiesBytes = read(FAMILIES);
check('EVIDENCE tab JSON == families.json', familiesBytes.equals(read(APP_FAMILIES)),
  `(${APP_FAMILIES})`);

// 3. The payload baked into the served viz must come from the CURRENT sources.
// Same length-prefixed digest bake_evidence_network.py stamps into meta.
const want = createHash('sha256');
for (const [name, blob] of [
  ['financial-market-predictability-families.json', familiesBytes],
  ['financial-market-predictability-evidence.csv', read(CSV)],
] as Array<[string, Buffer]>) {
  want.update(`${name}:${blob.length}:`);
  want.update(blob);
}
const wantHash = want.digest('hex');

const html = publicHtml.toString('utf8');
const start = html.indexOf(START), end = html.indexOf(END);
if (start === -1 || end === -1 || end < start) {
  check('graph payload present', false, `(GRAPH-DATA markers missing in ${PUBLIC_HTML})`);
} else {
  const meta = JSON.parse(html.slice(start + START.length, end)).meta ?? {};
  check('baked payload matches current source data', meta.inputs_sha256 === wantHash,
    `(baked ${String(meta.inputs_sha256).slice(0, 12)}… vs sources ${wantHash.slice(0, 12)}…)`);
  console.log(`  baked graph: ${meta.families} families · ${meta.studies} studies · ${meta.links} evidence links`);
}

console.log(`RESULT: ${pass} passed, ${fail} failed`);
if (fail) console.log(`\nThe evidence map is stale. Re-bake and commit:\n  ${REBAKE}`);
process.exit(fail ? 1 : 0);
