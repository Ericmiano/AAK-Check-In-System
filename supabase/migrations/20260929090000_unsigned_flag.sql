-- A simple manual flag for delegates whose attendance wasn't personally
-- signed by them (e.g. someone else signed on their behalf) — staff mark
-- it by hand, same one-time mark/unmark pattern as tag_issued and
-- gift_bag_issued. Not tied to check-in day: it's a flag on the delegate
-- record itself, toggled and un-toggled freely as it gets sorted out.
alter table public.delegates add column unsigned_at timestamptz;
alter table public.delegates add column unsigned_by uuid;

create or replace function public.set_unsigned(p_delegate_id uuid, p_flagged boolean)
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

  if p_flagged then
    update public.delegates
      set unsigned_at = coalesce(unsigned_at, now()), unsigned_by = coalesce(unsigned_by, auth.uid())
      where id = p_delegate_id
      returning * into d;
  else
    update public.delegates set unsigned_at = null, unsigned_by = null where id = p_delegate_id returning * into d;
  end if;

  perform public.log_audit(
    case when p_flagged then 'delegate.flagged_unsigned' else 'delegate.unflagged_unsigned' end,
    'delegate', d.id, jsonb_build_object('badge_code', d.badge_code)
  );
  return jsonb_build_object('id', d.id, 'unsigned_at', d.unsigned_at);
end; $$;
revoke all on function public.set_unsigned(uuid, boolean) from public, anon;
grant execute on function public.set_unsigned(uuid, boolean) to authenticated;
