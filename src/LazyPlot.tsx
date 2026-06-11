import { lazy, Suspense } from 'react'
import ErrorBoundary from './ErrorBoundary'

// plotly.js is the heaviest dependency in the app (~1.4 MB gzipped). Loading it
// eagerly would put it in the entry chunk every visitor downloads before first
// paint, but only two chart sites use it — so it loads on first chart render.
const PlotlyPlot = lazy(() => import('react-plotly.js'))

export default function Plot(props: Record<string, unknown>) {
  // Match the fallback to the chart's height so the page doesn't jump when
  // the chart pops in after the chunk lands.
  const height = Number((props.layout as { height?: number } | undefined)?.height) || 240
  return (
    <ErrorBoundary minHeight={height}>
      <Suspense
        fallback={
          <div
            style={{
              height,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--muted)',
              fontSize: '0.85rem',
            }}
          >
            Loading chart…
          </div>
        }
      >
        <PlotlyPlot {...props} />
      </Suspense>
    </ErrorBoundary>
  )
}
