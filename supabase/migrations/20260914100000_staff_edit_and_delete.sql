-- Admin: extend admin_update_staff to also rename a staff member's
-- username. Supabase Auth's own internal email never needs to change for
-- this - resolve_staff_login always does a fresh username -> email lookup
-- against staff_profiles, so renaming the username here is enough for the
-- new username to work at sign-in immediately.
drop function if exists public.admin_update_staff(uuid, text, boolean);

create or replace function public.admin_update_staff(
  p_user_id uuid,
  p_full_name text default null,
  p_active boolean default null,
  p_username text default null
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  p public.staff_profiles%rowtype;
  v_username text := nullif(lower(btrim(coalesce(p_username, ''))), '');
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
  if v_username is not null then
    if v_username !~ '^[a-z0-9._-]{3,32}$' then
      raise exception '3-32 characters: letters, numbers, dots, underscores, or hyphens.' using errcode = '22023';
    end if;
    if exists (select 1 from public.staff_profiles where username = v_username and user_id <> p_user_id) then
      raise exception 'That username is already taken.' using errcode = '22023';
    end if;
  end if;

  update public.staff_profiles
    set full_name = coalesce(btrim(p_full_name), full_name),
        active = coalesce(p_active, active),
        username = coalesce(v_username, username)
    where user_id = p_user_id
    returning * into p;

  if not found then
    raise exception 'Staff account not found.' using errcode = '22023';
  end if;

  perform public.log_audit('staff.updated', 'staff', p_user_id, jsonb_build_object(
    'full_name', p_full_name, 'active', p_active, 'username', v_username
  ));

  return jsonb_build_object('user_id', p.user_id, 'full_name', p.full_name, 'username', p.username, 'active', p.active);
end; $$;

revoke all on function public.admin_update_staff(uuid, text, boolean, text) from public;
grant execute on function public.admin_update_staff(uuid, text, boolean, text) to authenticated;

-- Admin: remove a staff account's database records (staff_profiles,
-- user_roles), immediately blocking sign-in (resolve_staff_login can no
-- longer find them) and removing them from the staff list. Can't delete
-- yourself, and can't delete the last remaining administrator.
create or replace function public.admin_delete_staff(p_user_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  p public.staff_profiles%rowtype;
  v_admin_count int;
begin
  if not public.is_active_admin(auth.uid()) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  if p_user_id = auth.uid() then
    raise exception 'You cannot delete your own account.' using errcode = '22023';
  end if;

  select * into p from public.staff_profiles where user_id = p_user_id;
  if not found then
    raise exception 'Staff account not found.' using errcode = '22023';
  end if;

  if exists (select 1 from public.user_roles where user_id = p_user_id and role = 'admin') then
    select count(*) into v_admin_count from public.user_roles where role = 'admin';
    if v_admin_count <= 1 then
      raise exception 'At least one administrator is required.' using errcode = '22023';
    end if;
  end if;

  delete from public.user_roles where user_id = p_user_id;
  delete from public.staff_profiles where user_id = p_user_id;

  perform public.log_audit('staff.deleted', 'staff', p_user_id, jsonb_build_object(
    'full_name', p.full_name, 'username', p.username
  ));

  return jsonb_build_object('user_id', p_user_id, 'full_name', p.full_name);
end; $$;

revoke all on function public.admin_delete_staff(uuid) from public, anon;
grant execute on function public.admin_delete_staff(uuid) to authenticated;
