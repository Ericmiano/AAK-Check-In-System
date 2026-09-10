-- Self-contained error visibility for the live event: no third-party service
-- or API key to manage, just a table admins can check. Any caller (including
-- anon, since the kiosk page has no session) can report an error about their
-- own session, but only admins can read the log.
create table public.client_errors (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  message text not null,
  stack text,
  path text,
  actor_id uuid,
  actor_email text,
  context jsonb not null default '{}'::jsonb
);
create index client_errors_created_at_idx on public.client_errors (created_at desc);
grant select on public.client_errors to authenticated;
grant all on public.client_errors to service_role;
alter table public.client_errors enable row level security;
create policy "Admins read client errors" on public.client_errors for select to authenticated using (public.is_active_admin(auth.uid()));

create or replace function public.log_client_error(p_message text, p_stack text default null, p_path text default null, p_context jsonb default '{}'::jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.client_errors (message, stack, path, actor_id, actor_email, context)
  values (
    left(coalesce(p_message, 'Unknown error'), 2000),
    left(p_stack, 4000),
    left(p_path, 300),
    auth.uid(),
    auth.jwt() ->> 'email',
    coalesce(p_context, '{}'::jsonb)
  );
exception when others then
  -- Never let error reporting itself break the app.
  null;
end; $$;
revoke all on function public.log_client_error(text, text, text, jsonb) from public;
grant execute on function public.log_client_error(text, text, text, jsonb) to anon, authenticated;
