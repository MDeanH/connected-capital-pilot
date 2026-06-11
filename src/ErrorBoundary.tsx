import { Component } from 'react'
import type { ReactNode } from 'react'

// Suspense does NOT catch a rejected lazy import — without a boundary, a failed
// chunk fetch (flaky network, or a stale tab whose hashed chunk URLs 404 after a
// redeploy) unmounts the whole React tree to a blank page. This catches it and
// offers a reload, which fetches the current deploy's chunks.
interface Props {
  children: ReactNode
  minHeight?: number
}

export default class ErrorBoundary extends Component<Props, { error: Error | null }> {
  state = { error: null as Error | null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  render() {
    if (this.state.error) {
      return (
        <div className="card" style={{ minHeight: this.props.minHeight, textAlign: 'center', padding: '2rem' }}>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>This section failed to load</div>
          <div style={{ color: 'var(--muted)', fontSize: '0.85rem', marginBottom: 12 }}>
            Usually a connection hiccup, or the app was updated while this page was open.
          </div>
          <button onClick={() => window.location.reload()}>Reload</button>
        </div>
      )
    }
    return this.props.children
  }
}
