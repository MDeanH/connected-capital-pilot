// Run with: node --import tsx scripts/check-performance-samples.ts
import assert from 'node:assert/strict'
import { samplePerformance, performanceSummary, PERFORMANCE_SCENARIOS, PERFORMANCE_METRICS } from '../src/sample-performance'
import type { PerformanceScenario, PerformanceMetric } from '../src/sample-performance'

let passed = 0
for (const scenario of Object.keys(PERFORMANCE_SCENARIOS) as PerformanceScenario[]) {
  const points = samplePerformance(scenario)
  assert.equal(points.length, 6)
  assert.equal(new Set(points.map(p => p.month)).size, 6)
  for (const metric of Object.keys(PERFORMANCE_METRICS) as PerformanceMetric[]) {
    for (const window of [3, 6]) {
      const selected = points.slice(-window)
      const before = JSON.stringify(selected)
      const summary = performanceSummary(selected, metric)!
      const first = selected[0].observed[metric]
      const last = selected[selected.length - 1]
      assert.equal(summary.gap, last.observed[metric] - last.plan[metric])
      assert.equal(summary.change, last.observed[metric] - first)
      assert.equal(summary.favorable, metric === 'expenses' ? summary.gap <= 0 : summary.gap >= 0)
      assert.ok(Object.values(summary).every(v => typeof v === 'boolean' || Number.isFinite(v)))
      assert.equal(JSON.stringify(selected), before)
      passed++
    }
  }
  // Calls return independent fixtures; demo interaction cannot contaminate another run.
  points[0].observed.noi = -1
  assert.equal(samplePerformance(scenario)[0].observed.noi, 80)
  passed++
}
assert.equal(performanceSummary([], 'noi'), null)
passed++
assert.equal(performanceSummary(samplePerformance('slipping'), 'expenses')!.favorable, false)
assert.equal(performanceSummary(samplePerformance('on-plan'), 'occupancy')!.favorable, true)
passed += 2
console.log(`RESULT: ${passed} passed, 0 failed (sample comparisons, windows, units/direction and isolation)`)
