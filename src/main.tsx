import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import './index.css'

// After a redeploy, an open tab still references the previous deploy's hashed
// chunk URLs, which 404 (Netlify deploys are atomic). Vite surfaces failed
// dynamic imports as this event — reload once to pick up the new deploy.
window.addEventListener('vite:preloadError', (event) => {
  const KEY = 'chunk-reload-attempted'
  if (sessionStorage.getItem(KEY)) return // already retried — let the ErrorBoundary show
  sessionStorage.setItem(KEY, '1')
  event.preventDefault()
  window.location.reload()
})
window.addEventListener('load', () => {
  // a successful load means the new deploy's entry is in — re-arm the retry
  setTimeout(() => sessionStorage.removeItem('chunk-reload-attempted'), 10_000)
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
