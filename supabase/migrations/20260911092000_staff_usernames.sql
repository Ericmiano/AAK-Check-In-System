-- Staff sign in with a username, not an email. Supabase Auth itself is
-- email-based, so each staff account still gets an internal, non-deliverable
-- synthetic address (username@staff.aak-checkin.internal) purely for Auth's
-- own bookkeeping; the username is what staff actually see and type.
alter table public.staff_profiles add column username citext;
update public.staff_profiles set username = split_part(email::text, '@', 1) where username is null;
alter table public.staff_profiles alter column username set not null;
alter table public.staff_profiles add constraint staff_profiles_username_key unique (username);

-- Public: resolve a username to its internal sign-in address. Returns null
-- for unknown or deactivated accounts so the login form can show one generic
-- "incorrect username or password" either way, same as before.
create or replace function public.resolve_staff_login(p_username text)
returns text language sql stable security definer set search_path = public as $$
  select email::text from public.staff_profiles
  where username = lower(btrim(coalesce(p_username, ''))) and active
  limit 1
$$;
revoke all on function public.resolve_staff_login(text) from public;
grant execute on function public.resolve_staff_login(text) to anon, authenticated;

-- First administrator bootstrap: now takes a username instead of an email.
create or replace function public.claim_first_admin(p_user_id uuid, p_full_name text, p_username text, p_email text)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  perform pg_advisory_xact_lock(hashtext('claim_first_admin'));
  if exists (select 1 from public.user_roles where role = 'admin') then
    return false;
  end if;
  insert into public.user_roles (user_id, role) values (p_user_id, 'admin');
  insert into public.staff_profiles (user_id, full_name, username, email) values (p_user_id, p_full_name, lower(btrim(p_username)), p_email)
    on conflict (user_id) do update set full_name = excluded.full_name, username = excluded.username, email = excluded.email;
  insert into public.audit_events (actor_id, actor_email, action, entity_type, entity_id, metadata)
  values (p_user_id, p_email, 'staff.first_admin_claimed', 'staff', p_user_id, '{}'::jsonb);
  return true;
end; $$;
revoke all on function public.claim_first_admin(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.claim_first_admin(uuid, text, text, text) to service_role;
drop function if exists public.claim_first_admin(uuid, text, text);

-- Admin: finalize a new staff/admin account (username instead of email).
create or replace function public.admin_provision_staff(p_user_id uuid, p_full_name text, p_username text, p_email text, p_role public.app_role default 'staff')
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_name text := btrim(coalesce(p_full_name, ''));
  v_username text := lower(btrim(coalesce(p_username, '')));
begin
  if not public.is_active_admin(auth.uid()) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  if length(v_name) < 2 or length(v_name) > 120 then
    raise exception 'Enter the staff member full name.' using errcode = '22023';
  end if;
  if v_username !~ '^[a-z0-9._-]{3,32}$' then
    raise exception 'Username must be 3-32 characters: letters, numbers, dots, underscores, or hyphens.' using errcode = '22023';
  end if;

  insert into public.staff_profiles (user_id, full_name, username, email)
  values (p_user_id, v_name, v_username, p_email)
  on conflict (user_id) do update set full_name = excluded.full_name, username = excluded.username, email = excluded.email;

  insert into public.user_roles (user_id, role) values (p_user_id, p_role)
  on conflict (user_id, role) do nothing;

  perform public.log_audit('staff.invited', 'staff', p_user_id, jsonb_build_object('username', v_username, 'role', p_role));
  return jsonb_build_object('user_id', p_user_id, 'full_name', v_name, 'username', v_username, 'role', p_role);
end; $$;
revoke all on function public.admin_provision_staff(uuid, text, text, text, public.app_role) from public;
grant execute on function public.admin_provision_staff(uuid, text, text, public.app_role) to authenticated;
drop function if exists public.admin_provision_staff(uuid, text, text, public.app_role);
grant execute on function public.admin_provision_staff(uuid, text, text, text, public.app_role) to authenticated;
