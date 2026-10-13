// Run with: node scripts/check-threshold-grid.mjs
// Render the actual threshold screen and check its engine-backed presentation.
import assert from 'node:assert/strict'
import { renderToStaticMarkup } from 'react-dom/server'
import ThresholdConfig from '../src/ThresholdConfig'
import defaultConfig from '../netlify/functions/lib/gate1/default-config.json'
import { computeVote } from '../netlify/functions/lib/gate1/macro'
import type { Gate1Config, MacroSignalDef } from '../netlify/functions/lib/gate1/types'

const cfg = JSON.parse(JSON.stringify(defaultConfig)) as Gate1Config
const render = (config: Gate1Config, isAdmin: boolean = true) => renderToStaticMarkup(
  <ThresholdConfig active={{ version: 0, config }} draft={null}
    onDraftChange={() => { throw new Error('Rendering must not edit the config') }}
    onSave={async () => { throw new Error('Rendering must not save') }} isAdmin={isAdmin} />,
)
let passed = 0
function check(name: string, test: () => void) {
  test()
  passed++
  console.log(`PASS: ${name}`)
}
check('default rulebook is unchanged after rendering', () => {
  const before = JSON.stringify(cfg)
  render(cfg)
  assert.equal(JSON.stringify(cfg), before)
})
cfg.thresholds = [
  { key: 'qa_threshold', asset_class: '*', posture: 'green', value: 2 },
  { key: 'qa_threshold', asset_class: '*', posture: 'yellow', value: 3 },
  { key: 'qa_threshold', asset_class: '*', posture: 'red', value: 4 },
  { key: 'qa_threshold', asset_class: 'multifamily', posture: '*', value: 9 },
  { key: 'qa_threshold', asset_class: 'multifamily', posture: 'green', value: 1 },
]
const html = render(cfg)
check('all three posture columns are present', () => {
  for (const p of ['green', 'yellow', 'red']) assert.ok(html.includes(`${p} posture</th>`))
})
check('a shared wildcard value has one editor, never three independent editors', () => {
  assert.equal(html.split('aria-label="qa_threshold for multifamily / *"').length - 1, 1)
  assert.ok(html.includes('colSpan="3"') || html.includes('colspan="3"'))
})
check('specific posture values remain editable; global posture wins over class wildcard', () => {
  assert.ok(html.includes('aria-label="qa_threshold for multifamily / green"'))
  assert.ok(html.includes('Inherited: all classes / yellow'))
  assert.ok(html.includes('Inherited: all classes / red'))
  assert.ok(!html.includes('aria-label="qa_threshold for multifamily / yellow"'))
})
check('analysts retain draft editing but cannot publish versions', () => {
  const analyst = render(cfg, false)
  assert.ok(!analyst.includes('SAVE AS NEW VERSION'))
  assert.ok(analyst.includes('aria-label="qa_threshold for multifamily / green"'))
})
check('unavailable rulebook stays explicit', () => {
  const unavailable = renderToStaticMarkup(<ThresholdConfig active={null} draft={null}
    onDraftChange={() => {}} onSave={async () => ({ persisted: false })} isAdmin={true} />)
  assert.ok(unavailable.includes('Config unavailable'))
})
for (const direction of ['high_is_bad', 'high_is_good'] as const) {
  for (const [green, yellow] of [[1, 2], [2, 1], [2, 2]]) {
    const sig: MacroSignalDef = { id: 'qa', label: 'QA signal', fred: null,
      weight: 1, transform: 'level', direction, green, yellow }
    cfg.macro.signals = [sig]
    const bound = direction === 'high_is_bad' ? Math.max(green, yellow) : Math.min(green, yellow)
    check(`${direction} red boundary ${green}/${yellow} matches sequential engine checks`, () => {
      const screen = render(cfg)
      assert.ok(screen.includes(`${direction === 'high_is_bad' ? '&gt;' : '&lt;'} ${bound}.`))
      assert.notEqual(computeVote(sig, bound), 'red')
      assert.equal(computeVote(sig, bound + (direction === 'high_is_bad' ? .001 : -.001)), 'red')
      assert.equal(computeVote(sig, null), null)
      assert.ok(!screen.includes('aria-label="QA signal red band"'))
    })
  }
}
console.log(`RESULT: ${passed} passed, 0 failed`)
