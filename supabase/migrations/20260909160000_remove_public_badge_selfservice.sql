-- Product decision: check-in is desk-only. Delegates can no longer request or
-- retrieve a badge remotely; every delegate is either pre-imported by an
-- admin (CSV) or added on the spot by staff as a walk-in, and every check-in
-- is performed by staff (QR scan or search), never by the delegate. Lock the
-- functions themselves, not just the front-end routes, so the capability is
-- actually gone rather than merely unlinked.
revoke execute on function public.public_create_badge(text, text, text, text) from anon, authenticated;
revoke execute on function public.public_find_badge(text) from anon, authenticated;
revoke execute on function public.public_get_badge(text) from anon, authenticated;

-- Admin: fetch a delegate's badge QR payload so it can be viewed or printed
-- ahead of the event. Scoped to admins (not all staff) since it returns the
-- badge_token, the same opaque credential check_in_delegate matches on.
create or replace function public.admin_get_delegate_badge(p_delegate_id uuid)
returns jsonb language plpgsql security definer stable set search_path = public as $$
declare
  d public.delegates%rowtype;
begin
  if not public.is_active_admin(auth.uid()) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  select * into d from public.delegates where id = p_delegate_id;
  if not found then
    raise exception 'Delegate not found.' using errcode = '22023';
  end if;
  return jsonb_build_object(
    'full_name', d.full_name,
    'organization', d.organization,
    'badge_code', d.badge_code,
    'badge_token', d.badge_token,
    'status', d.status
  );
end; $$;
revoke all on function public.admin_get_delegate_badge(uuid) from public;
grant execute on function public.admin_get_delegate_badge(uuid) to authenticated;
