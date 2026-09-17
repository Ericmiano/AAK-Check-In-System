-- One-time bulk action: mark everyone who checked in yesterday as also
-- checked in today, so the desk doesn't have to rescan the same returning
-- delegates again this morning. Additive only via the same
-- (delegate_id, check_in_date) uniqueness the rest of the multi-day feature
-- relies on — anyone who already has a real check-in today is left alone,
-- and this never touches anyone whose only check-in is from further back
-- than yesterday.
insert into public.check_ins (delegate_id, event_id, check_in_date, checked_in_by, method, device_label, notes)
select
  ci.delegate_id,
  ci.event_id,
  (now() at time zone 'Africa/Nairobi')::date,
  null,
  'search',
  'Bulk carry-forward',
  'Carried forward from ' || (ci.check_in_date)::text || ' check-in'
from public.check_ins ci
where ci.event_id = public.active_event_id()
  and ci.check_in_date = (now() at time zone 'Africa/Nairobi')::date - 1
on conflict (delegate_id, check_in_date) do nothing;
