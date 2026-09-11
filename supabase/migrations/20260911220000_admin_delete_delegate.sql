-- Admin: permanently delete a delegate, for cleaning up duplicate records
-- (e.g. the same person imported twice under slightly different name
-- spellings that didn't match during merge). Admin-only since this is
-- destructive and irreversible, unlike the staff-level edit/undo actions.
-- check_ins cascades on delete already, so no manual cleanup needed there.
create or replace function public.admin_delete_delegate(p_delegate_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_event_id uuid := public.active_event_id();
  d public.delegates%rowtype;
begin
  if not public.is_active_admin(auth.uid()) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  select * into d from public.delegates where id = p_delegate_id and event_id = v_event_id;
  if not found then
    raise exception 'Delegate not found in the active event.' using errcode = '22023';
  end if;

  delete from public.delegates where id = p_delegate_id;

  perform public.log_audit('delegate.deleted', 'delegate', d.id, jsonb_build_object(
    'full_name', d.full_name, 'email', d.email, 'badge_code', d.badge_code, 'status', d.status
  ));

  return jsonb_build_object('id', d.id, 'full_name', d.full_name);
end; $$;

revoke all on function public.admin_delete_delegate(uuid) from public, anon;
grant execute on function public.admin_delete_delegate(uuid) to authenticated;
