-- Track two physical hand-outs per delegate, separately from check-in
-- itself: the identity tag/badge and the gift bag. Neither should be
-- assumed just because someone is checked in — the desk can get busy, or
-- tags can run out — so staff mark each one explicitly. Both are one-time
-- per delegate for the whole (possibly multi-day) event, not per check-in
-- day, matching how a physical item is only ever handed over once.
alter table public.delegates add column tag_issued_at timestamptz;
alter table public.delegates add column tag_issued_by uuid;
alter table public.delegates add column gift_bag_issued_at timestamptz;
alter table public.delegates add column gift_bag_issued_by uuid;

create or replace function public.set_tag_issued(p_delegate_id uuid, p_issued boolean)
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

  if p_issued then
    update public.delegates
      set tag_issued_at = coalesce(tag_issued_at, now()), tag_issued_by = coalesce(tag_issued_by, auth.uid())
      where id = p_delegate_id
      returning * into d;
  else
    update public.delegates set tag_issued_at = null, tag_issued_by = null where id = p_delegate_id returning * into d;
  end if;

  perform public.log_audit(
    case when p_issued then 'delegate.tag_issued' else 'delegate.tag_unissued' end,
    'delegate', d.id, jsonb_build_object('badge_code', d.badge_code)
  );
  return jsonb_build_object('id', d.id, 'tag_issued_at', d.tag_issued_at);
end; $$;
revoke all on function public.set_tag_issued(uuid, boolean) from public, anon;
grant execute on function public.set_tag_issued(uuid, boolean) to authenticated;

create or replace function public.set_gift_bag_issued(p_delegate_id uuid, p_issued boolean)
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

  if p_issued then
    update public.delegates
      set gift_bag_issued_at = coalesce(gift_bag_issued_at, now()), gift_bag_issued_by = coalesce(gift_bag_issued_by, auth.uid())
      where id = p_delegate_id
      returning * into d;
  else
    update public.delegates set gift_bag_issued_at = null, gift_bag_issued_by = null where id = p_delegate_id returning * into d;
  end if;

  perform public.log_audit(
    case when p_issued then 'delegate.gift_bag_issued' else 'delegate.gift_bag_unissued' end,
    'delegate', d.id, jsonb_build_object('badge_code', d.badge_code)
  );
  return jsonb_build_object('id', d.id, 'gift_bag_issued_at', d.gift_bag_issued_at);
end; $$;
revoke all on function public.set_gift_bag_issued(uuid, boolean) from public, anon;
grant execute on function public.set_gift_bag_issued(uuid, boolean) to authenticated;
