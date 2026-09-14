-- The kiosk page showed generic static branding with no indication of
-- which event it was actually checking people into, so a name that's a
-- real delegate under a DIFFERENT event (while this event's active) failed
-- with a confusing "no matching registration" and nobody could tell why.
-- Expose just the active event's name to the kiosk - the minimum needed to
-- show it up front - matching the same narrow, no-browsing privacy posture
-- as the rest of the kiosk's public functions.
create or replace function public.kiosk_active_event_name(p_token text)
returns text language sql stable security definer set search_path = public as $$
  select e.name from public.events e
  where e.active
    and exists (select 1 from public.kiosk_tokens where token = btrim(coalesce(p_token, '')) and active)
  limit 1
$$;

revoke all on function public.kiosk_active_event_name(text) from public;
grant execute on function public.kiosk_active_event_name(text) to anon, authenticated;
