// User management — the admin-only roster behind sign-in. Lists profiles,
// creates accounts (email + temp password + role; there is no self-signup —
// the admin hands the credentials to the person), toggles roles and
// disables/enables access, all through authFetch against /api/users. Honest
// empty/degraded/error states follow DealHistory's patterns; the server
// re-checks admin on every call, so a 401/403 here is shown, never masked.
import { useCallback, useEffect, useState } from 'react'
import { Kicker } from './cc-ui'
import { authFetch, type Role } from './auth'

interface UserRow {
  id: string
  email: string
  role: Role
  disabled: boolean
  created_at: string
}

const dateFmt = new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'short', day: 'numeric' })

function fmtDate(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : dateFmt.format(d)
}

/** Shared response handling: non-JSON → dev hint; 401/403/503 → honest words. */
async function readJson(r: Response): Promise<any> {
  const ct = r.headers.get('content-type') || ''
  if (!ct.includes('application/json'))
    throw new Error('User management needs the deployed API — run `netlify dev` (plain vite has no persistence).')
  const data = await r.json().catch(() => ({}))
  if (r.status === 401) throw new Error(data.error || 'Sign in required')
  if (r.status === 403) throw new Error(data.error || 'Admin access required')
  return data
}

export default function UsersPanel() {
  const [rows, setRows] = useState<UserRow[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [degraded, setDegraded] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const [newEmail, setNewEmail] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [newRole, setNewRole] = useState<Role>('analyst')
  const [creating, setCreating] = useState(false)

  // Success notes are transient — they clear themselves after a few seconds.
  useEffect(() => {
    if (!notice) return
    const t = setTimeout(() => setNotice(null), 6000)
    return () => clearTimeout(t)
  }, [notice])

  const load = useCallback(async () => {
    setLoading(true)
    setErr(null)
    setDegraded(false)
    try {
      const r = await authFetch('/api/users')
      const data = await readJson(r)
      if (r.status === 503) {
        setDegraded(true)
        setRows(null)
        return
      }
      if (data.error) throw new Error(data.error)
      setRows(Array.isArray(data.users) ? (data.users as UserRow[]) : [])
    } catch (e: unknown) {
      setErr(String((e as Error)?.message || e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const createUser = async () => {
    const email = newEmail.trim()
    if (!email || !newPassword || creating) return
    setCreating(true)
    setErr(null)
    setNotice(null)
    try {
      const r = await authFetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password: newPassword, role: newRole }),
      })
      const data = await readJson(r)
      if (!r.ok) throw new Error(data.error || `Create failed (HTTP ${r.status})`)
      setNewEmail('')
      setNewPassword('')
      setNewRole('analyst')
      setNotice(`Created ${email} as ${newRole} — hand them the email and temporary password; there is no self-signup.`)
      await load()
    } catch (e: unknown) {
      setErr(String((e as Error)?.message || e))
    } finally {
      setCreating(false)
    }
  }

  const patchUser = async (row: UserRow, patch: { role?: Role; disabled?: boolean }, done: string) => {
    if (busyId) return
    setBusyId(row.id)
    setErr(null)
    setNotice(null)
    try {
      const r = await authFetch(`/api/users/${row.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
      const data = await readJson(r)
      if (!r.ok) throw new Error(data.error || `Update failed (HTTP ${r.status})`)
      setNotice(`${row.email} ${done}.`)
      await load()
    } catch (e: unknown) {
      setErr(String((e as Error)?.message || e))
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="up-root">
      <style>{CSS}</style>
      <div className="card up-hero">
        <Kicker>CONNECTED CAPITAL — USERS</Kicker>
        <h2>Who can sign in, and as what</h2>
        <p className="up-lede">
          Accounts are created here and handed over — there is no self-signup. Admins save rulebook
          versions, record macro overrides, delete deals and manage users; analysts do everything
          else. Disabling an account blocks sign-in without deleting its attribution history.
        </p>
        <div className="up-actions">
          <button className="secondary" onClick={load} disabled={loading}>
            {loading ? 'LOADING…' : 'REFRESH'}
          </button>
        </div>
      </div>

      {loading && !rows && <div className="up-busy" role="status">Loading users…</div>}
      {err && <div className="up-err" role="alert">{err}</div>}
      {notice && <div className="up-notice" role="status">{notice}</div>}

      {degraded && (
        <div className="card up-degraded" role="note">
          <h3>User management is unavailable</h3>
          <p>
            Persistence isn't configured on this deployment (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY),
            so there are no accounts to manage — the site runs open, exactly as the public demo does.
          </p>
        </div>
      )}

      {rows && rows.length === 0 && (
        <div className="card up-empty">
          No users yet — create the first account below and hand over the credentials.
        </div>
      )}

      {rows && rows.length > 0 && (
        <div className="card up-table-card">
          <table className="up-table">
            <thead>
              <tr>
                <th>Email</th><th>Role</th><th>Status</th><th>Created</th>
                <th aria-label="Actions"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id} className={r.disabled ? 'up-row-disabled' : undefined}>
                  <td className="up-email">{r.email}</td>
                  <td><span className={`up-role up-role-${r.role}`}>{r.role.toUpperCase()}</span></td>
                  <td>{r.disabled ? <span className="up-status-off">DISABLED</span> : <span className="up-status-on">ACTIVE</span>}</td>
                  <td title={r.created_at}>{fmtDate(r.created_at)}</td>
                  <td className="up-row-actions">
                    <button
                      className="up-act"
                      disabled={busyId !== null}
                      onClick={() => patchUser(
                        r,
                        { role: r.role === 'admin' ? 'analyst' : 'admin' },
                        r.role === 'admin' ? 'is now an analyst' : 'is now an admin',
                      )}
                    >
                      {busyId === r.id ? '…' : r.role === 'admin' ? 'MAKE ANALYST' : 'MAKE ADMIN'}
                    </button>
                    <button
                      className={`up-act${r.disabled ? '' : ' up-act-danger'}`}
                      disabled={busyId !== null}
                      onClick={() => patchUser(
                        r,
                        { disabled: !r.disabled },
                        r.disabled ? 'can sign in again' : 'can no longer sign in',
                      )}
                    >
                      {busyId === r.id ? '…' : r.disabled ? 'ENABLE' : 'DISABLE'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!degraded && (
        <div className="card up-create">
          <h3>Create a user</h3>
          <div className="up-create-row">
            <label className="up-field">
              <span>Email</span>
              <input
                type="email"
                value={newEmail}
                onChange={e => setNewEmail(e.target.value)}
                placeholder="person@fund.com"
                autoComplete="off"
                disabled={creating}
              />
            </label>
            <label className="up-field">
              <span>Temporary password</span>
              <input
                type="text"
                value={newPassword}
                onChange={e => setNewPassword(e.target.value)}
                placeholder="temp password (10+ chars)"
                autoComplete="off"
                disabled={creating}
              />
            </label>
            <label className="up-field">
              <span>Role</span>
              <select value={newRole} onChange={e => setNewRole(e.target.value as Role)} disabled={creating}>
                <option value="analyst">analyst</option>
                <option value="admin">admin</option>
              </select>
            </label>
            <button onClick={createUser} disabled={creating || !newEmail.trim() || !newPassword}>
              {creating ? 'CREATING…' : 'CREATE USER'}
            </button>
          </div>
          <p className="up-create-note">
            You hand these credentials to the person yourself — nothing is emailed, and no one can
            register on their own.
          </p>
        </div>
      )}
    </div>
  )
}

const CSS = `
.up-root{display:flex;flex-direction:column;gap:2rem;max-width:1180px;margin:0 auto;width:100%}
.up-hero{padding:2.5rem}
.up-hero h2{font-family:'Roboto',system-ui,sans-serif;font-weight:300;font-size:1.9rem;margin:.5rem 0 .4rem;letter-spacing:-.01em}
.up-lede{color:var(--muted,#5c6b67);font-size:.9rem;max-width:640px;line-height:1.6;margin:0 0 1.5rem}
.up-actions{display:flex;gap:.9rem;flex-wrap:wrap;align-items:center}
.up-actions button{letter-spacing:.08em;font-size:12px}
.up-busy{color:var(--accent,#3f7d69);font-size:.82rem}
.up-err{background:#fbecef;color:#c2384a;border:1px solid #f0c8d0;border-radius:10px;padding:.8rem 1rem;font-size:.85rem}
.up-notice{background:#e4f5ee;color:#2c574a;border:1px solid #bcded3;border-radius:10px;padding:.8rem 1rem;font-size:.85rem}
.up-degraded{padding:1.5rem;border:1px solid #f0e0b0;background:#fbf3df}
.up-degraded h3{font-size:12px;letter-spacing:.08em;text-transform:uppercase;margin:0 0 .8rem;font-weight:600;color:#5b4a16}
.up-degraded p{color:#5b4a16;font-size:.85rem;line-height:1.6;margin:0}
.up-empty{padding:1.5rem;color:var(--muted,#5c6b67);font-size:.88rem}
.up-table-card{padding:.5rem 1rem;overflow-x:auto}
.up-table{width:100%;border-collapse:collapse;font-size:.83rem}
.up-table th{text-align:left;font-size:10.5px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted,#5c6b67);padding:.7rem .6rem;border-bottom:1px solid var(--border,#dcebe7)}
.up-table td{padding:.65rem .6rem;border-bottom:1px solid var(--border,#dcebe7);vertical-align:middle}
.up-row-disabled .up-email{color:var(--muted,#5c6b67);text-decoration:line-through}
.up-email{font-weight:500}
.up-role{font-size:10px;letter-spacing:.08em;font-weight:700;padding:2px 8px;border-radius:6px;border:1.5px solid;display:inline-block}
.up-role-admin{color:#3f7d69;border-color:#3f7d69;background:rgba(63,125,105,.08)}
.up-role-analyst{color:#5c6b67;border-color:#9c9c9c;background:rgba(156,156,156,.12)}
.up-status-on{font-size:10.5px;letter-spacing:.06em;font-weight:600;color:#3f7d69}
.up-status-off{font-size:10.5px;letter-spacing:.06em;font-weight:600;color:#c2384a}
.up-row-actions{display:flex;gap:.4rem;flex-wrap:wrap}
.up-act{font-size:9.5px;letter-spacing:.08em;font-weight:700;color:var(--cc-deep,#3f7d69);background:transparent;
  border:1px solid var(--border,#c9ded7);border-radius:6px;padding:3px 9px;cursor:pointer}
.up-act:hover:not(:disabled){background:var(--accent-soft,#e4f5ee);border-color:var(--cc-deep,#3f7d69);color:var(--cc-deep,#3f7d69)}
.up-act-danger{color:#c2384a;border-color:#f0c8d0}
.up-act-danger:hover:not(:disabled){background:#fbecef;border-color:#c2384a;color:#c2384a}
.up-act:disabled{opacity:.45;cursor:default}
.up-create{padding:1.5rem}
.up-create h3{font-size:12px;letter-spacing:.08em;text-transform:uppercase;margin:0 0 1rem;font-weight:600}
.up-create-row{display:flex;align-items:flex-end;gap:1rem;flex-wrap:wrap}
.up-create-row button{letter-spacing:.08em;font-size:12px;flex-shrink:0}
.up-field{display:flex;flex-direction:column;gap:.35rem}
.up-field span{font-size:10.5px;letter-spacing:.07em;text-transform:uppercase;color:var(--muted,#5c6b67);font-weight:600}
.up-field input,.up-field select{border:1px solid var(--border,#dcebe7);border-radius:6px;padding:.45rem .6rem;
  background:var(--surface,#fff);font-size:.85rem;color:inherit}
.up-field input{width:200px}
.up-create-note{margin:.9rem 0 0;font-size:.76rem;color:var(--muted,#5c6b67);line-height:1.5}
@media(max-width:700px){
  .up-create-row{flex-direction:column;align-items:stretch}
  .up-field input{width:auto}
  .up-act{font-size:11px}
}
`
