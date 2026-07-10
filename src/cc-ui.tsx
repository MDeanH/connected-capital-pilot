import type { ReactNode } from 'react'
import { Info } from './Info'

// Connected Capital shared UI primitives. Self-contained: injects its CSS
// once (same guard pattern as Info.tsx), all classes prefixed cc-.

let injected = false
function ensureStyle() {
  if (injected || typeof document === 'undefined') return
  injected = true
  const el = document.createElement('style')
  el.id = 'cc-ui-style'
  el.textContent = CSS
  document.head.appendChild(el)
}

export type Verdict = 'PASS' | 'CONDITIONAL' | 'FAIL' | 'REVIEW'

export function VerdictBadge({ verdict, baseline }: { verdict: Verdict; baseline?: string }) {
  ensureStyle()
  const adjusted = baseline != null && baseline !== verdict
  return (
    <span className="cc-verdict-wrap">
      <span className={`cc-verdict cc-verdict-${verdict.toLowerCase()}`}>{verdict}</span>
      {adjusted && <span className="cc-verdict-baseline">adjusted · rulebook said {baseline}</span>}
    </span>
  )
}

export function PostureChip({ posture, asOf, source }: { posture: 'green' | 'yellow' | 'red'; asOf?: string; source?: string }) {
  ensureStyle()
  return (
    <span className="cc-posture" title={source}>
      <span className={`cc-posture-dot cc-posture-${posture}`} aria-hidden="true" />
      <span className="cc-posture-word">{posture.toUpperCase()}</span>
      {asOf && <span className="cc-posture-asof">as of {asOf}</span>}
    </span>
  )
}

export function ConfidenceTag({ level }: { level: 'high' | 'med' | 'low' | 'missing' }) {
  ensureStyle()
  return (
    <span className={`cc-conf cc-conf-${level}`}>
      {level === 'missing' ? 'MISSING' : level.toUpperCase()}
    </span>
  )
}

export function StatusDot({ status }: { status: 'pass' | 'flag' | 'fail' | 'missing' | 'na' }) {
  ensureStyle()
  return <span className={`cc-dot cc-dot-${status}`} role="img" aria-label={status} />
}

export function Kicker({ children }: { children: ReactNode }) {
  return <div className="cc-kicker">{children}</div>
}

export function SourceCite({ doc, page, quote }: { doc: string; page?: number | null; quote?: string }) {
  ensureStyle()
  const label = page != null ? `${doc} p.${page}` : doc
  return (
    <span className="cc-cite">
      {label}
      {quote && <Info width={280} below><i>“{quote}”</i></Info>}
    </span>
  )
}

const CSS = `
.cc-verdict-wrap{display:inline-flex;flex-direction:column;align-items:flex-start;gap:4px}
.cc-verdict{display:inline-block;font-size:16px;font-weight:500;letter-spacing:.1em;text-transform:uppercase;
  padding:8px 20px;border-radius:999px;border:2px solid currentColor;line-height:1.2}
.cc-verdict-pass{background:var(--accent-soft,#e4f5ee);color:var(--cc-deep,#3f7d69)}
.cc-verdict-conditional{background:#fbf3df;color:#8a6508}
.cc-verdict-fail{background:#fbecef;color:var(--danger,#c2384a)}
.cc-verdict-review{background:#f1f3f3;color:#5c6b67}
.cc-verdict-baseline{font-size:11.5px;color:var(--muted,#5c6b67)}
.cc-posture{display:inline-flex;align-items:center;gap:7px;font-size:13px;font-weight:500;letter-spacing:.06em}
.cc-posture-dot{width:11px;height:11px;border-radius:50%;flex-shrink:0}
.cc-posture-green{background:var(--posture-green,#3f7d69)}
.cc-posture-yellow{background:var(--posture-yellow,#b8860b)}
.cc-posture-red{background:var(--posture-red,#c2384a)}
.cc-posture-asof{font-size:11.5px;font-weight:400;letter-spacing:0;color:var(--muted,#5c6b67)}
.cc-conf{display:inline-block;font-size:10px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;
  padding:1px 7px;border-radius:4px;border:1px solid currentColor;line-height:1.6}
.cc-conf-high{color:var(--cc-deep,#3f7d69)}
.cc-conf-med{color:var(--warning,#b8860b)}
.cc-conf-low{color:var(--danger,#c2384a)}
.cc-conf-missing{background:var(--danger,#c2384a);border-color:var(--danger,#c2384a);color:#fff}
.cc-dot{display:inline-block;width:10px;height:10px;border-radius:50%;vertical-align:middle;box-sizing:border-box}
.cc-dot-pass{background:var(--posture-green,#3f7d69)}
.cc-dot-flag{background:var(--posture-yellow,#b8860b)}
.cc-dot-fail{background:var(--posture-red,#c2384a)}
.cc-dot-missing{background:transparent;border:2px solid var(--posture-red,#c2384a)}
.cc-dot-na{background:var(--cc-gray,#9c9c9c)}
.cc-cite{display:inline-flex;align-items:center;font-size:11px;font-weight:500;color:var(--muted,#5c6b67);
  background:var(--surface-2,#f5fbfa);border:1px solid var(--border,#dcebe7);border-radius:5px;padding:1px 7px;white-space:nowrap}
`
