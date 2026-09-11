-- Staff: undo an accidental check-in. Removes the check-in record and puts
-- the delegate back to "expected", scoped to the active event so a stale
-- check-in from a past event can never be touched. Any active staff member
-- can do this (matches check_in_delegate's own authorization), not just
-- admins, since correcting a mis-tap at the desk needs to happen instantly.
create or replace function public.undo_check_in(p_delegate_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_event_id uuid := public.active_event_id();
  d public.delegates%rowtype;
begin
  if not public.is_active_staff(auth.uid()) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  select * into d from public.delegates where id = p_delegate_id and event_id = v_event_id;
  if not found then
    raise exception 'Delegate not found in the active event.' using errcode = '22023';
  end if;

  delete from public.check_ins where delegate_id = p_delegate_id;
  update public.delegates set status = 'expected' where id = p_delegate_id returning * into d;

  perform public.log_audit('check_in.undone', 'delegate', d.id, jsonb_build_object('badge_code', d.badge_code));

  return jsonb_build_object('id', d.id, 'full_name', d.full_name, 'status', d.status);
end; $$;

revoke all on function public.undo_check_in(uuid) from public, anon;
grant execute on function public.undo_check_in(uuid) to authenticated;
