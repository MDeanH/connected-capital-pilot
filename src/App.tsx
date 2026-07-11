import { lazy, Suspense } from 'react'
import ErrorBoundary from './ErrorBoundary'

// The app IS the deal-intake product. The pane ships as its own chunk with
// chunk-failure recovery via the ErrorBoundary (pattern kept from the pilot).
const DealIntake = lazy(() => import('./DealIntake'))

export default function App() {
  return (
    <div className="app cc-theme">
      <header>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '1rem', flexWrap: 'wrap' }}>
          <div>
            <h1 style={{ fontSize: '1.6rem' }}>
              Connected Capital{' '}
              <span
                style={{
                  fontSize: '0.6rem',
                  fontWeight: 700,
                  verticalAlign: 'middle',
                  background: '#e4f5ee',
                  color: '#3f7d69',
                  border: '1px solid #bcded3',
                  borderRadius: 6,
                  padding: '2px 8px',
                  letterSpacing: '0.06em',
                }}
              >
                INSTITUTIONAL PILOT
              </span>
            </h1>
            <div style={{ fontSize: '0.72rem', color: 'var(--muted)', letterSpacing: '0.12em', textTransform: 'uppercase', fontWeight: 500 }}>
              Deal diligence — Gate 1 screening · macro-aware thresholds · auditable decisions
            </div>
          </div>
          <a
            href="/how-it-works.html"
            style={{
              fontSize: '0.72rem',
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
              fontWeight: 500,
              color: 'var(--accent)',
              textDecoration: 'none',
              border: '1px solid var(--border)',
              borderRadius: 6,
              padding: '6px 12px',
              whiteSpace: 'nowrap',
            }}
          >
            How it works
          </a>
        </div>
      </header>

      <div className="main">
        <ErrorBoundary>
          <Suspense fallback={<div className="card" style={{ color: 'var(--muted)' }}>Loading…</div>}>
            <DealIntake />
          </Suspense>
        </ErrorBoundary>
      </div>
    </div>
  )
}
