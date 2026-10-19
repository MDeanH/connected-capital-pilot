// Run: node --import tsx scripts/check-macro-trends.ts
import assert from 'node:assert/strict'
import { SIGNALS, normalize, groupScore, groupTrend, scoreBand, easingConfirmed, projectPosture, snapshotAt, analyzeTrend, estimateLabel } from '../src/macro-trends/model'
import { macroSample, SAMPLE_SCENARIOS, type SampleScenarioId } from '../src/macro-trends/sample'
let passed = 0
function test(name: string, fn: () => void) { fn(); passed++; console.log(`PASS: ${name}`) }
const close = (a: number | null, b: number) => { assert.notEqual(a,null); assert.ok(Math.abs(a! - b) < 1e-10, `${a} != ${b}`) }
const trend = (score: number, speed: number) => groupTrend(score, score - 13 * speed)
const calm = trend(-.2,0)

test('exact seven client parameters and no market-return inputs', () => {
  assert.deepEqual(SIGNALS.map(s => [s.id,s.weight,s.yellow,s.red]), [
    ['sahm',2,.2,.45],['gdp',1.5,.02,.005],['hy',1.5,400,550],
    ['unemployment',1,.45,.55],['claims',1,5,25],['ism',.5,52,48],['pce',1.5,2.5,3.5],
  ])
})
for (const s of SIGNALS) test(`${s.id}: exact boundaries, reversed direction, clamping and missing data`, () => {
  close(normalize(s.yellow,s.yellow,s.red),0)
  close(normalize(s.red,s.yellow,s.red),1)
  close(normalize(s.yellow + 99 * (s.red-s.yellow),s.yellow,s.red),2)
  close(normalize(s.yellow - 99 * (s.red-s.yellow),s.yellow,s.red),-1)
  assert.equal(normalize(null,s.yellow,s.red),null)
  assert.equal(normalize(NaN,s.yellow,s.red),null)
})
test('Core PCE examples use the formula, not inconsistent scores', () => {
  close(normalize(2.70,2.5,3.5),.20); close(normalize(2.95,2.5,3.5),.45)
})
test('GDP and ISM lower values are worse', () => {
  assert.ok(normalize(.01,.02,.005)! > normalize(.03,.02,.005)!)
  assert.ok(normalize(48,52,48)! > normalize(53,52,48)!)
})
test('0 is Yellow; 1 is Red; exact-zero speed holds', () => {
  assert.equal(scoreBand(0),'Yellow'); assert.equal(scoreBand(1),'Red')
  assert.equal(groupTrend(.4,.4).status,'Holding'); assert.equal(groupTrend(.4,.4).weeks,null)
})
for (const [score,speed,next] of [[-.2,.02,0],[0,.02,1],[.5,.02,1],[1,.02,null],[1.1,-.02,1],[1,-.02,0],[.5,-.02,0],[0,-.02,null],[-.1,-.02,null]] as const) {
  test(`next threshold: score ${score}, speed ${speed}`, () => assert.equal(trend(score,speed).next,next))
}
test('room and ETA are distance divided by absolute 13-week speed', () => {
  const g=groupTrend(.8,.28); close(g.speed,.04); close(g.room,.2); close(g.weeks,5)
})
test('near-zero speed stays deterministic without an invented cutoff', () => {
  const g=groupTrend(.5,.5-1e-12); assert.ok(g.weeks! > 1e10)
  assert.equal(estimateLabel(g.weeks),'More than 1,000 weeks at this pace')
})
test('no ETA beyond Red worsening or Green improving', () => {
  assert.equal(trend(1.2,.1).status,'Red, worsening'); assert.equal(trend(1.2,.1).weeks,null)
  assert.equal(trend(-.2,-.1).status,'Green, improving'); assert.equal(trend(-.2,-.1).weeks,null)
})
test('weighted slowdown is separate from PCE', () => {
  const s=macroSample('inflation').snapshots.at(-1)!
  const scores=SIGNALS.filter(d=>d.group==='slowdown').map(d=>normalize(s.readings[d.id],d.yellow,d.red)!*d.weight)
  close(groupScore(s,'slowdown'),scores.reduce((a,b)=>a+b,0)/7.5)
  const before=groupScore(s,'slowdown'); s.readings.pce=100
  assert.equal(groupScore(s,'slowdown'),before); close(groupScore(s,'inflation'),2)
})
test('missing indicator does not silently reweight', () => {
  const s=macroSample('inflation').snapshots.at(-1)!; s.readings.hy=null
  assert.equal(groupScore(s,'slowdown'),null); assert.notEqual(groupScore(s,'inflation'),null)
})
test('GDP and PCE are carried forward only after publication', () => {
  const r=macroSample('inflation').releases
  assert.equal(snapshotAt(r,'2026-01-08').readings.gdp,null)
  assert.equal(snapshotAt(r,'2026-04-08').published.gdp,'2026-01-09')
  assert.equal(snapshotAt(r,'2026-04-09').published.gdp,'2026-04-09')
  assert.equal(snapshotAt(r,'2026-04-09').published.pce,'2026-03-09')
  assert.equal(snapshotAt(r,'2026-04-10').published.pce,'2026-04-10')
})
test('three eased monthly releases require four consecutive monthly readings', () => {
  const r=macroSample('recovery').releases.pce
  assert.equal(easingConfirmed(r,'2026-04-13'),true)
  assert.equal(easingConfirmed(r.slice(1),'2026-04-13'),false)
  assert.equal(easingConfirmed(r.filter(x=>x.date!=='2026-02-09'),'2026-04-13'),false)
  assert.equal(easingConfirmed(macroSample('early').releases.pce,'2026-04-13'),false)
  assert.equal(easingConfirmed(r,'2026-03-09'),false)
})
test('only valid worsening transition can lead', () => {
  assert.equal(projectPosture('soft_landing',trend(-.4,.02),trend(-.1,.04),false).leader,'inflation')
  assert.equal(projectPosture('stagflation',calm,trend(.8,.1),false).target,null)
  assert.equal(projectPosture('stagflation',trend(.8,.04),calm,false).target,'recession')
})
test('Stagflation recovery waits for both groups, using the later crossing', () => {
  const p=projectPosture('stagflation',trend(.6,-.1),trend(.2,-.1),true)
  assert.equal(p.target,'soft_landing'); close(p.weeks,6); assert.equal(p.leader,'both')
  assert.equal(projectPosture('stagflation',trend(.6,-.1),trend(.2,0),true).target,null)
})
test('improving headline requires confirmation; recession recovery proceeds through Stagflation', () => {
  const a=projectPosture('recession',trend(1.2,-.1),calm,false)
  assert.equal(a.target,null); assert.ok(a.text.includes('not confirmed'))
  assert.equal(projectPosture('recession',trend(1.2,-.1),calm,true).target,'stagflation')
  assert.equal(projectPosture('recession',trend(.2,-.1),calm,true).target,'stagflation')
})
test('recovery needs at least five of six improving signals', () => {
  const s=macroSample('recovery'), last=s.snapshots.at(-1)!, first=s.snapshots[0]
  last.readings.ism=first.readings.ism
  assert.equal(analyzeTrend(s.posture,s.snapshots,s.asOf,s.releases.pce).recoveryConfirmed,true)
  last.readings.hy=first.readings.hy
  const r=analyzeTrend(s.posture,s.snapshots,s.asOf,s.releases.pce)
  assert.equal(r.improving,4); assert.equal(r.recoveryConfirmed,false); assert.equal(r.projection.target,null)
})
test('direction counts remain visible when scores are clamped', () => {
  const s=macroSample('recovery'), first=s.snapshots[0], last=s.snapshots.at(-1)!
  first.readings.hy=1000; last.readings.hy=900
  const r=analyzeTrend(s.posture,s.snapshots,s.asOf,s.releases.pce)
  assert.equal(r.improving,6)
})
test('an exact dated 13-week snapshot is required', () => {
  const s=macroSample('missing'), r=analyzeTrend(s.posture,s.snapshots,s.asOf,s.releases.pce)
  assert.equal(r.slowdown.prior,null); assert.equal(r.projection.weeks,null); assert.ok(r.projection.text.includes('unavailable'))
})
test('no threshold ahead holds at the current posture', () => {
  assert.equal(projectPosture('soft_landing',calm,calm,false).text,'Holding at Soft Landing')
  assert.equal(projectPosture('stagflation',trend(1.2,.1),trend(1.2,.1),false).text,'Holding at Stagflation')
})
test('current posture and fixtures never mutate; all scenarios replay exactly', () => {
  for (const id of Object.keys(SAMPLE_SCENARIOS) as SampleScenarioId[]) {
    const s=macroSample(id), before=JSON.stringify(s)
    const a=analyzeTrend(s.posture,s.snapshots,s.asOf,s.releases.pce)
    assert.equal(JSON.stringify(a),JSON.stringify(analyzeTrend(s.posture,s.snapshots,s.asOf,s.releases.pce)))
    assert.equal(JSON.stringify(s),before)
    for(const g of [a.slowdown,a.inflation]) for(const v of [g.score,g.prior,g.speed,g.room,g.weeks]) assert.ok(v===null||Number.isFinite(v))
  }
})
test('missing/current history and invalid normalization are explicit', () => {
  assert.equal(normalize(1,2,2),null)
  assert.equal(groupTrend(null,.2).direction,'unavailable')
  assert.equal(groupTrend(.2,null).weeks,null)
})
test('display estimates do not invent an uncertainty interval', () => {
  assert.equal(estimateLabel(2.5),'About 2–3 weeks'); assert.equal(estimateLabel(2),'About 2 weeks')
  assert.ok(estimateLabel(0).includes('weekly evaluation pending'))
})
console.log(`RESULT: ${passed} passed, 0 failed`)
