import type { ReactNode } from 'react'
import { Info } from './Info'
import { GLOSSARY } from './glossary'

// Glossary-backed tooltip term. Wraps its children (or the entry's term text)
// with an <Info> popover containing the glossary definition:
//   <Term k="dscr">1.32x</Term>
export function Term({ k, children, width = 270, below, extra }: {
  k: string
  children?: ReactNode
  width?: number
  below?: boolean
  extra?: ReactNode
}) {
  const entry = GLOSSARY[k]
  if (!entry) {
    if (import.meta.env.DEV) console.warn(`GlossaryTip: unknown glossary key "${k}"`)
    return <span>{children ?? k}</span>
  }
  return (
    <span>
      {children ?? entry.term}
      <Info width={width} below={below}>
        <b>{entry.term}</b> — {entry.short}
        {entry.long && <><br />{entry.long}</>}
        {entry.formula && <div className="cc-formula">{entry.formula}</div>}
        {extra}
      </Info>
    </span>
  )
}
