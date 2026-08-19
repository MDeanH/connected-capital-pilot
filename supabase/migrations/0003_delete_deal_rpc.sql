-- Atomic deal delete — replaces four sequential mutations in the deals API.
-- A mid-sequence failure there left the deal partially intact with its
-- gate_decisions rows irrecoverably gone; a function body is one transaction,
-- so the delete now lands whole or not at all.
-- Semantics preserved from the API: decisions go with the deal, extraction
-- telemetry keeps its rows but drops the link, staged document rows go too.

create or replace function delete_deal(p_deal_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_decisions integer;
begin
  if not exists (select 1 from deals where id = p_deal_id) then
    -- P0002 (no_data_found): the API maps this to 404.
    raise exception 'Deal not found' using errcode = 'P0002';
  end if;

  delete from gate_decisions where deal_id = p_deal_id;
  get diagnostics v_decisions = row_count;

  update extractions set deal_id = null where deal_id = p_deal_id;
  delete from deal_documents where deal_id = p_deal_id;
  delete from deals where id = p_deal_id;

  return v_decisions;
end;
$$;

-- Service key only — same trust boundary as the tables themselves (RLS on,
-- zero policies; the SPA never talks to Supabase directly).
revoke execute on function delete_deal(uuid) from public;
revoke execute on function delete_deal(uuid) from anon;
revoke execute on function delete_deal(uuid) from authenticated;
grant execute on function delete_deal(uuid) to service_role;
