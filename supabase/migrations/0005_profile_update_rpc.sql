-- Atomic guarded profile update — replaces the read-then-write lockout guard
-- in the users API (PATCH /api/users/:id). The API's check-count-then-update
-- sequence let two admins concurrently demote/disable each other: both counts
-- saw the other admin still enabled, both updates landed, zero enabled admins
-- remained. Here the lock, the re-check, and the update run in one function
-- body — one transaction — so the second writer waits on the row locks, then
-- re-checks against the first writer's committed result and is refused.
--
-- Errcodes the API maps (netlify/functions/users.ts):
--   P0002 → 404 user not found (same convention as delete_deal, 0003)
--   AD001 → 409 self-lockout (actor disabling/demoting their own admin account)
--   AD002 → 409 last-admin lockout (change would leave zero enabled admins)

create or replace function update_profile_guarded(
  p_id uuid,
  p_actor uuid,
  p_role text default null,
  p_disabled boolean default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_target profiles%rowtype;
  v_other_admins integer;
begin
  -- Serialize competing guarded updates: lock the target row plus every
  -- currently-enabled admin row. Sorted before locking (ORDER BY applies
  -- first, then FOR UPDATE acquires in that order), so two concurrent calls
  -- take the same locks in the same order — they queue instead of deadlocking.
  perform id from profiles
    where id = p_id or (role = 'admin' and disabled = false)
    order by id
    for update;

  -- Re-read under the lock: a competing transaction that got here first has
  -- committed, and this statement's fresh snapshot sees its result.
  select * into v_target from profiles where id = p_id;
  if not found then
    raise exception 'User not found' using errcode = 'P0002';
  end if;

  -- Lockout guards — apply only when the change would remove a working admin
  -- (re-enabling, promoting, or touching an analyst is never a lockout risk).
  if v_target.role = 'admin' and not v_target.disabled
     and (p_role = 'analyst' or p_disabled is true) then
    if p_actor is not null and p_actor = p_id then
      raise exception 'You cannot disable or demote your own account — ask another admin'
        using errcode = 'AD001';
    end if;
    select count(*) into v_other_admins
      from profiles
      where role = 'admin' and disabled = false and id <> p_id;
    if v_other_admins = 0 then
      raise exception 'This is the only enabled admin — promote another admin first'
        using errcode = 'AD002';
    end if;
  end if;

  update profiles
     set role = coalesce(p_role, role),
         disabled = coalesce(p_disabled, disabled)
   where id = p_id;
end;
$$;

-- Service key only — same trust boundary as the tables themselves (RLS on,
-- zero policies; the SPA never talks to Supabase directly).
revoke execute on function update_profile_guarded(uuid, uuid, text, boolean) from public;
revoke execute on function update_profile_guarded(uuid, uuid, text, boolean) from anon;
revoke execute on function update_profile_guarded(uuid, uuid, text, boolean) from authenticated;
grant execute on function update_profile_guarded(uuid, uuid, text, boolean) to service_role;
