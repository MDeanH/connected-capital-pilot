// UX fixtures only. Never feed these values to scoring, thresholds or persistence.
export type PerformanceMetric = 'noi' | 'occupancy' | 'expenses'
export type PerformanceScenario = 'on-plan' | 'slipping' | 'recovering'
export interface PerformancePoint {
  month: string
  plan: Record<PerformanceMetric, number>
  observed: Record<PerformanceMetric, number>
}
export const PERFORMANCE_METRICS = {
  noi: { label: 'Monthly NOI', unit: '$000', higherIsBetter: true },
  occupancy: { label: 'Occupancy', unit: '%', higherIsBetter: true },
  expenses: { label: 'Operating expenses', unit: '$000', higherIsBetter: false },
} as const
export const PERFORMANCE_SCENARIOS: Record<PerformanceScenario, { label: string; context: string; review: string }> = {
  'on-plan': {
    label: 'On plan', context: 'Leasing and operating costs are tracking the illustrative plan.',
    review: 'Continue monitoring leasing and costs. Use the next reporting period to confirm that progress holds.',
  },
  slipping: {
    label: 'Falling behind', context: 'Slower leasing and rising costs are widening the gap to the illustrative plan.',
    review: 'Review leasing assumptions and the operating cost drivers. Compare possible responses before changing strategy.',
  },
  recovering: {
    label: 'Recovering', context: 'The sample shows an early setback followed by improving leasing and cost control.',
    review: 'Review whether the recovery is sustained. Compare remaining gaps with the plan before deciding whether further changes are needed.',
  },
}
const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun']
const plans = [
  [80, 88, 45], [84, 89, 46], [88, 90, 46],
  [92, 91, 47], [96, 92, 47], [100, 93, 48],
]
const observations: Record<PerformanceScenario, number[][]> = {
  'on-plan': [[80, 88, 45], [85, 90, 46], [88, 90, 45], [93, 92, 47], [96, 92, 47], [101, 94, 48]],
  slipping: [[80, 88, 45], [82, 88, 47], [81, 87, 49], [80, 86, 51], [78, 85, 54], [76, 84, 57]],
  recovering: [[80, 88, 45], [77, 86, 49], [75, 85, 52], [82, 88, 50], [90, 91, 49], [98, 93, 48]],
}
export function samplePerformance(scenario: PerformanceScenario): PerformancePoint[] {
  return months.map((month, i) => ({
    month: `${month} 2026`,
    plan: { noi: plans[i][0], occupancy: plans[i][1], expenses: plans[i][2] },
    observed: { noi: observations[scenario][i][0], occupancy: observations[scenario][i][1], expenses: observations[scenario][i][2] },
  }))
}
/** Display comparison only; it does not assign a Gate verdict or recommend a trade. */
export function performanceSummary(points: PerformancePoint[], metric: PerformanceMetric) {
  if (!points.length) return null
  const first = points[0], latest = points[points.length - 1]
  const gap = latest.observed[metric] - latest.plan[metric]
  return {
    latest: latest.observed[metric], plan: latest.plan[metric], gap,
    change: latest.observed[metric] - first.observed[metric],
    favorable: PERFORMANCE_METRICS[metric].higherIsBetter ? gap >= 0 : gap <= 0,
  }
}
