-- The events table was never added to the supabase_realtime publication
-- (only delegates and check_ins were, back in the original schema, before
-- events existed) — so useActiveEvent's postgres_changes subscription has
-- never actually received a notification for anything. Switching the
-- active event on one device has never propagated live to any other open
-- device or tab; it only ever appeared to work after a manual reload,
-- which is exactly the intermittent "switching between events had issues"
-- behavior this was reported as.
alter publication supabase_realtime add table public.events;
