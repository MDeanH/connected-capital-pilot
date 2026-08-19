// Compact sign-in card + signed-in chip for the inner auth layer. Rendered
// only when the Supabase client exists (auth configured at build time) — the
// public demo build never sees it. Sign-in only: there is no self-signup;
// admins create accounts on the Users page and hand over the credentials.
import { useState, type FormEvent } from 'react'
import { signIn, signOut, type IdentityState } from './auth'

export default function LoginCard({ identity }: { identity: IdentityState }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  // Session restore is fast — render nothing meanwhile rather than flash the
  // sign-in form at someone who is already signed in.
  if (!identity.ready && !identity.email) return null

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (busy || !email.trim() || !password) return
    setBusy(true)
    setErr(null)
    const failure = await signIn(email.trim(), password)
    if (failure) {
      setErr(failure)
    } else {
      setEmail('')
      setPassword('')
    }
    setBusy(false)
  }

  if (identity.email) {
    const roleLabel = identity.role ? identity.role.toUpperCase() : identity.ready ? 'NO ACCESS' : '…'
    return (
      <div className="lc-bar">
        <style>{CSS}</style>
        <span className="lc-chip">
          <span className="lc-chip-email">{identity.email}</span>
          <span className={`lc-chip-role${identity.role ? '' : ' lc-chip-role-none'}`}>{roleLabel}</span>
        </span>
        <button className="lc-signout" onClick={() => { void signOut() }}>SIGN OUT</button>
      </div>
    )
  }

  return (
    <form className="lc-bar" onSubmit={submit}>
      <style>{CSS}</style>
      <span className="lc-label">ANALYST SIGN-IN</span>
      <input
        className="lc-input"
        type="email"
        value={email}
        onChange={e => { setEmail(e.target.value); setErr(null) }}
        placeholder="email"
        autoComplete="username"
        aria-label="Email"
        disabled={busy}
      />
      <input
        className="lc-input"
        type="password"
        value={password}
        onChange={e => { setPassword(e.target.value); setErr(null) }}
        placeholder="password"
        autoComplete="current-password"
        aria-label="Password"
        disabled={busy}
      />
      <button className="lc-signin" type="submit" disabled={busy || !email.trim() || !password}>
        {busy ? 'SIGNING IN…' : 'SIGN IN'}
      </button>
      {err && <span className="lc-err" role="alert">{err}</span>}
    </form>
  )
}

const CSS = `
.lc-bar{display:flex;align-items:center;gap:.6rem;flex-wrap:wrap;justify-content:flex-end;
  background:var(--surface,#fff);border:1px solid var(--border,#dcebe7);border-radius:10px;
  padding:.5rem .8rem;margin:0 0 1rem}
.lc-label{font-size:10px;font-weight:600;letter-spacing:.09em;color:var(--muted,#5c6b67);margin-right:auto}
.lc-input{border:1px solid var(--border,#dcebe7);border-radius:6px;padding:.35rem .55rem;
  font-size:.82rem;background:var(--surface,#fff);color:inherit;width:170px}
button.lc-signin,button.lc-signout{font-size:10.5px;font-weight:600;letter-spacing:.08em;
  padding:.4rem .9rem;border-radius:6px}
button.lc-signout{background:transparent;color:var(--muted,#5c6b67);border:1px solid var(--border,#dcebe7)}
button.lc-signout:hover{background:var(--surface-2,#f5fbfa);border-color:var(--muted,#5c6b67);color:var(--text,#090e11)}
.lc-err{flex-basis:100%;text-align:right;font-size:.76rem;color:var(--danger,#c2384a)}
.lc-chip{display:inline-flex;align-items:center;gap:.55rem;font-size:.8rem}
.lc-chip-email{font-weight:500}
.lc-chip-role{font-size:9.5px;font-weight:700;letter-spacing:.08em;color:var(--cc-deep,#3f7d69);
  border:1px solid currentColor;border-radius:4px;padding:1px 7px;line-height:1.6}
.lc-chip-role-none{color:var(--muted,#5c6b67)}
@media(max-width:700px){
  .lc-bar{justify-content:stretch}
  .lc-label{flex-basis:100%;margin-right:0}
  .lc-input{flex:1 1 120px;width:auto;font-size:16px}
}
`
