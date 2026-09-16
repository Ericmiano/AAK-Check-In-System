-- Auto-marking the tag only took effect for check-ins from that migration
-- onward — everyone already checked in before then (which, on a live event,
-- was most of today's real check-ins) still shows no tag given, even though
-- they were in fact checked in at the desk. Backfill tag_issued_at/by from
-- each such delegate's own first check-in, so "checked in" and "tag given"
-- agree for everyone retroactively, not just going forward. Only touches
-- delegates who are checked in, have no tag recorded yet, and have an
-- actual check-in to backfill from (coalesce keeps this a no-op for anyone
-- already marked, manually or automatically).
update public.delegates d
set tag_issued_at = coalesce(d.tag_issued_at, first_ci.checked_in_at),
    tag_issued_by = coalesce(d.tag_issued_by, first_ci.checked_in_by)
from (
  select distinct on (delegate_id) delegate_id, checked_in_at, checked_in_by
  from public.check_ins
  order by delegate_id, checked_in_at asc
) first_ci
where d.id = first_ci.delegate_id
  and d.status = 'checked_in'
  and d.tag_issued_at is null;
