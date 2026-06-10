import type { ReactNode } from 'react'

// Self-contained hover/focus info tooltip. Injects its CSS once. Use anywhere:
//   <Info>Explanation of this number and how to read it.</Info>
let injected = false
function ensureStyle() {
  if (injected || typeof document === 'undefined') return
  injected = true
  const el = document.createElement('style')
  el.id = 'info-tip-style'
  el.textContent = CSS
  document.head.appendChild(el)
}

export function Info({ children, width = 250, below = false }: { children: ReactNode; width?: number; below?: boolean }) {
  ensureStyle()
  return (
    <span className="infotip" tabIndex={0} role="note">
      <span className="infotip-i">i</span>
      <span className={`infotip-pop ${below ? 'below' : ''}`} style={{ width }}>{children}</span>
    </span>
  )
}

const CSS = `
.infotip{position:relative;display:inline-block;margin-left:5px;vertical-align:middle;cursor:help;outline:none}
.infotip-i{display:inline-flex;align-items:center;justify-content:center;width:14px;height:14px;border-radius:50%;
  background:#6b7280;color:#fff;font-size:10px;font-style:italic;font-weight:700;font-family:Georgia,'Times New Roman',serif;line-height:1}
.infotip:hover .infotip-i,.infotip:focus .infotip-i{background:#3b5bdb}
.infotip-pop{position:absolute;z-index:60;left:50%;transform:translateX(-50%);bottom:calc(100% + 9px);max-width:calc(100vw - 32px);
  background:#11161f;color:#eef1f6;font-size:11.5px;font-weight:400;line-height:1.5;letter-spacing:normal;text-transform:none;
  padding:10px 12px;border-radius:9px;box-shadow:0 8px 26px rgba(8,12,20,.32);opacity:0;visibility:hidden;
  transition:opacity .12s ease;pointer-events:none;text-align:left;white-space:normal}
.infotip-pop.below{bottom:auto;top:calc(100% + 9px)}
.infotip-pop b{color:#fff}
.infotip:hover .infotip-pop,.infotip:focus .infotip-pop{opacity:1;visibility:visible}
.infotip-pop:after{content:"";position:absolute;top:100%;left:50%;transform:translateX(-50%);border:5px solid transparent;border-top-color:#11161f}
.infotip-pop.below:after{top:auto;bottom:100%;border-top-color:transparent;border-bottom-color:#11161f}
`
