-- The macro API stores the complete computed snapshot (including quadrant and
-- market context, which have no dedicated columns) alongside the structured
-- columns, and readers prefer it: `data.snapshot ?? data`. The column was
-- being written but never existed — every macro_snapshots insert failed.
alter table macro_snapshots add column if not exists snapshot jsonb;
