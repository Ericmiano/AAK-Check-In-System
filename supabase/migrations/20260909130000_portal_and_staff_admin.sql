-- Delegate portal: fetch a badge and live check-in status by opaque token only.
-- Safe for anon because badge_token is an unguessable random secret, and this
-- returns no more than what is already printed on the badge itself.
create or replace function public.public_get_badge(p_token text)
returns jsonb language sql stable security definer set search_path = public as $$
  select case when d.id is null then null else jsonb_build_object(
    'full_name', d.full_name,
    'organization', d.organization,
    'badge_code', d.badge_code,
    'badge_token', d.badge_token,
    'status', d.status,
    'checked_in_at', c.checked_in_at
  ) end
  from (select 1) as _dummy
  left join public.delegates d on d.badge_token = btrim(coalesce(p_token, ''))
  left join public.check_ins c on c.delegate_id = d.id
$$;
revoke all on function public.public_get_badge(text) from public;
grant execute on function public.public_get_badge(text) to anon, authenticated;

-- Admin: update a staff member's display name and active flag.
-- staff_profiles carries no direct UPDATE grant for `authenticated`, so this
-- security definer wrapper is the only path, and it is itself gated on
-- is_active_admin and logs an audit event.
create or replace function public.admin_update_staff(p_user_id uuid, p_full_name text default null, p_active boolean default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  p public.staff_profiles%rowtype;
begin
  if not public.is_active_admin(auth.uid()) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  if p_full_name is not null and length(btrim(p_full_name)) < 2 then
    raise exception 'Enter a valid name.' using errcode = '22023';
  end if;
  if p_active = false and p_user_id = auth.uid() then
    raise exception 'You cannot deactivate your own account.' using errcode = '22023';
  end if;

  update public.staff_profiles
    set full_name = coalesce(btrim(p_full_name), full_name),
        active = coalesce(p_active, active)
    where user_id = p_user_id
    returning * into p;

  if p.user_id is null then
    raise exception 'Staff member not found.' using errcode = '22023';
  end if;

  perform public.log_audit('staff.updated', 'staff', p_user_id, jsonb_build_object('full_name', p.full_name, 'active', p.active));
  return jsonb_build_object('user_id', p.user_id, 'full_name', p.full_name, 'active', p.active);
end; $$;
revoke all on function public.admin_update_staff(uuid, text, boolean) from public;
grant execute on function public.admin_update_staff(uuid, text, boolean) to authenticated;

-- Admin: grant or revoke a role. Refuses to remove the last administrator so
-- the system can never end up with zero admins able to manage staff.
create or replace function public.admin_set_staff_role(p_user_id uuid, p_role public.app_role, p_grant boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_admin_count int;
begin
  if not public.is_active_admin(auth.uid()) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  if p_grant then
    insert into public.user_roles (user_id, role) values (p_user_id, p_role)
    on conflict (user_id, role) do nothing;
  else
    if p_role = 'admin' then
      select count(*) into v_admin_count from public.user_roles where role = 'admin';
      if v_admin_count <= 1 and exists (select 1 from public.user_roles where user_id = p_user_id and role = 'admin') then
        raise exception 'At least one administrator is required.' using errcode = '22023';
      end if;
    end if;
    delete from public.user_roles where user_id = p_user_id and role = p_role;
  end if;

  perform public.log_audit(
    case when p_grant then 'staff.role_granted' else 'staff.role_revoked' end,
    'staff', p_user_id, jsonb_build_object('role', p_role)
  );
  return jsonb_build_object('user_id', p_user_id, 'role', p_role, 'granted', p_grant);
end; $$;
revoke all on function public.admin_set_staff_role(uuid, public.app_role, boolean) from public;
grant execute on function public.admin_set_staff_role(uuid, public.app_role, boolean) to authenticated;

-- Admin: finalize a staff or admin account after the Auth user has already
-- been created server-side (via the service role, which is the only way to
-- create Supabase Auth users). Called by the inviting admin's own session so
-- the action is attributed and audited correctly.
create or replace function public.admin_provision_staff(p_user_id uuid, p_full_name text, p_email text, p_role public.app_role default 'staff')
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_name text := btrim(coalesce(p_full_name, ''));
begin
  if not public.is_active_admin(auth.uid()) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  if length(v_name) < 2 or length(v_name) > 120 then
    raise exception 'Enter the staff member full name.' using errcode = '22023';
  end if;
  if not public.valid_email(lower(btrim(coalesce(p_email, '')))) then
    raise exception 'Enter a valid email address.' using errcode = '22023';
  end if;

  insert into public.staff_profiles (user_id, full_name, email)
  values (p_user_id, v_name, lower(btrim(p_email)))
  on conflict (user_id) do update set full_name = excluded.full_name, email = excluded.email;

  insert into public.user_roles (user_id, role) values (p_user_id, p_role)
  on conflict (user_id, role) do nothing;

  perform public.log_audit('staff.invited', 'staff', p_user_id, jsonb_build_object('email', lower(btrim(p_email)), 'role', p_role));
  return jsonb_build_object('user_id', p_user_id, 'full_name', v_name, 'role', p_role);
end; $$;
revoke all on function public.admin_provision_staff(uuid, text, text, public.app_role) from public;
grant execute on function public.admin_provision_staff(uuid, text, text, public.app_role) to authenticated;

-- Defensive: service_role must be able to bootstrap the first administrator
-- and check whether one already exists, independent of default PUBLIC grants.
grant execute on function public.claim_first_admin(uuid, text, text) to service_role;
grant execute on function public.admin_exists() to service_role;
