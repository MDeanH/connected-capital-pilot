import type { ReactNode } from 'react'

// Demo-clarity badge: every data-bearing tab states up front whether what's
// on screen is placeholder sample data, the client's own framework, or live
// public data — so nobody has to ask "are these numbers real?" mid-demo.
const KINDS = {
  sample: { label: 'SAMPLE DATA', color: '#9a6700', bg: '#fff8e6', border: '#eddfae' },
  client: { label: 'FROM YOUR MATERIALS', color: '#3b5bdb', bg: '#eef2ff', border: '#c9d4f6' },
  live: { label: 'REAL DATA', color: '#157f3c', bg: '#ebf7ef', border: '#bfe3cb' },
} as const

export default function Provenance({ kind, children }: { kind: keyof typeof KINDS; children: ReactNode }) {
  const k = KINDS[kind]
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'baseline',
        gap: 10,
        padding: '7px 12px',
        borderRadius: 8,
        background: k.bg,
        border: `1px solid ${k.border}`,
        margin: '0 0 0.9rem',
        fontSize: '0.78rem',
        lineHeight: 1.45,
      }}
    >
      <span style={{ fontWeight: 700, letterSpacing: '0.07em', color: k.color, fontSize: '0.66rem', whiteSpace: 'nowrap' }}>
        {k.label}
      </span>
      <span style={{ color: '#4d5663' }}>{children}</span>
    </div>
  )
}
