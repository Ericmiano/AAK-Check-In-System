-- Multi-event support: every delegate (and by extension every check-in) is
-- tagged with the event it belongs to, so reusing this system for a
-- different event later never mixes rosters or counts. Exactly one event is
-- "active" at a time (same pattern as kiosk_tokens) — that's the event all
-- operational screens (check-in, dashboard, kiosk, import) work against.
create table public.events (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  active boolean not null default false,
  created_at timestamptz not null default now(),
  created_by uuid
);
grant select on public.events to authenticated;
grant all on public.events to service_role;
alter table public.events enable row level security;
create policy "Staff read events" on public.events for select to authenticated using (public.is_active_staff(auth.uid()));

-- Existing delegates predate event-tagging: move them under a clearly
-- labeled placeholder event so they never silently count toward whatever
-- event is activated next.
insert into public.events (name, active) values ('Untagged (pre-event tracking)', false);

alter table public.delegates add column event_id uuid references public.events(id);
update public.delegates set event_id = (select id from public.events where name = 'Untagged (pre-event tracking)');
alter table public.delegates alter column event_id set not null;
create index delegates_event_id_idx on public.delegates (event_id);

create or replace function public.active_event_id()
returns uuid language sql stable as $$
  select id from public.events where active limit 1
$$;

-- Admin: create a new event and make it the active one (only one active at
-- a time keeps every operational screen unambiguous about "today's event").
create or replace function public.admin_create_event(p_name text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_name text := btrim(coalesce(p_name, ''));
  e public.events%rowtype;
begin
  if not public.is_active_admin(auth.uid()) then
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
revoke all on function public.admin_create_event(text) from public;
grant execute on function public.admin_create_event(text) to authenticated;

-- Admin: switch which existing event is active.
create or replace function public.admin_set_active_event(p_event_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_active_admin(auth.uid()) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  if not exists (select 1 from public.events where id = p_event_id) then
    raise exception 'Event not found.' using errcode = '22023';
  end if;
  update public.events set active = false where active;
  update public.events set active = true where id = p_event_id;
  perform public.log_audit('event.activated', 'event', p_event_id, '{}'::jsonb);
end; $$;
revoke all on function public.admin_set_active_event(uuid) from public;
grant execute on function public.admin_set_active_event(uuid) to authenticated;
