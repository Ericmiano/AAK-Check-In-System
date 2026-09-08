create schema if not exists extensions;
do $$ begin
  begin alter extension citext set schema extensions; exception when others then null; end;
  begin alter extension pgcrypto set schema extensions; exception when others then null; end;
end $$;

create or replace function public.valid_email(_email text)
returns boolean language sql immutable set search_path = public as $$
  select _email is not null and length(_email) <= 255 and _email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
$$;

revoke all on function public.has_role(uuid, public.app_role) from public, anon, authenticated;
revoke all on function public.is_active_staff(uuid) from public, anon, authenticated;
revoke all on function public.is_active_admin(uuid) from public, anon, authenticated;
revoke all on function public.set_updated_at() from public, anon, authenticated;
revoke all on function public.generate_badge_code() from public, anon, authenticated;
revoke all on function public.valid_email(text) from public, anon, authenticated;
revoke all on function public.log_audit(text, text, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.claim_first_admin(uuid, text, text) from public, anon, authenticated;
revoke all on function public.admin_exists() from public, anon, authenticated;

revoke all on function public.public_create_badge(text, text, text, text) from public;
revoke all on function public.public_find_badge(text) from public;
revoke all on function public.check_in_delegate(text, public.check_in_method, text, text) from public;
revoke all on function public.add_and_check_in(text, text, text, text, text) from public;
revoke all on function public.import_delegates(jsonb, text) from public;
revoke all on function public.remove_test_delegates() from public;
revoke all on function public.dashboard_stats() from public;

-- Policies call has_role / is_active_* as the table owner, so they keep working.
grant execute on function public.public_create_badge(text, text, text, text) to anon, authenticated;
grant execute on function public.public_find_badge(text) to anon, authenticated;
grant execute on function public.check_in_delegate(text, public.check_in_method, text, text) to authenticated;
grant execute on function public.add_and_check_in(text, text, text, text, text) to authenticated;
grant execute on function public.import_delegates(jsonb, text) to authenticated;
grant execute on function public.remove_test_delegates() to authenticated;
grant execute on function public.dashboard_stats() to authenticated;
grant execute on function public.admin_exists() to anon, authenticated;