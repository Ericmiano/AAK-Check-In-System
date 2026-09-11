-- Event creation/switching was admin-only, which meant a staff member
-- hitting "no active event" at the desk had no way to fix it themselves and
-- had to go find an admin. Opening this to any active staff member removes
-- that friction; the function names keep their historical "admin_" prefix
-- to avoid unnecessary churn, but the authorization check is now the same
-- one used everywhere else staff already have access (is_active_staff).
create or replace function public.admin_create_event(p_name text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_name text := btrim(coalesce(p_name, ''));
  e public.events%rowtype;
begin
  if not public.is_active_staff(auth.uid()) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  if length(v_name) < 2 or length(v_name) > 160 then
    raise exception 'Enter an event name.' using errcode = '22023';
  end if;
  update public.events set active = false where active;
  insert into public.events (name, active, created_by) values (v_name, true, auth.uid()) returning * into e;
  perform public.log_audit('event.created', 'event', e.id, jsonb_build_object('name', e.name));
  return jsonb_build_object('id', e.id, 'name', e.name);
end; $$;

create or replace function public.admin_set_active_event(p_event_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_active_staff(auth.uid()) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  if not exists (select 1 from public.events where id = p_event_id) then
    raise exception 'Event not found.' using errcode = '22023';
  end if;
  update public.events set active = false where active;
  update public.events set active = true where id = p_event_id;
  perform public.log_audit('event.activated', 'event', p_event_id, '{}'::jsonb);
end; $$;
