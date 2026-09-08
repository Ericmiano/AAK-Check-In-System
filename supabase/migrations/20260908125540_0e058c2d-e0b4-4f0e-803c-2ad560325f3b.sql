create extension if not exists citext;
create extension if not exists pgcrypto;

create type public.app_role as enum ('admin', 'staff');
create type public.delegate_source as enum ('import', 'public', 'walk_in');
create type public.delegate_status as enum ('expected', 'checked_in');
create type public.check_in_method as enum ('qr', 'search', 'walk_in');

create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin new.updated_at = now(); return new; end; $$;

-- Roles
create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  role public.app_role not null,
  created_at timestamptz not null default now(),
  unique (user_id, role)
);
grant select on public.user_roles to authenticated;
grant all on public.user_roles to service_role;
alter table public.user_roles enable row level security;

create or replace function public.has_role(_user_id uuid, _role public.app_role)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_roles where user_id = _user_id and role = _role)
$$;

create policy "Users read own roles" on public.user_roles for select to authenticated using (user_id = auth.uid());
create policy "Admins read all roles" on public.user_roles for select to authenticated using (public.has_role(auth.uid(), 'admin'));

-- Staff profiles
create table public.staff_profiles (
  user_id uuid primary key,
  full_name text not null,
  email citext not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select on public.staff_profiles to authenticated;
grant all on public.staff_profiles to service_role;
alter table public.staff_profiles enable row level security;
create policy "Users read own profile" on public.staff_profiles for select to authenticated using (user_id = auth.uid());
create policy "Admins read all profiles" on public.staff_profiles for select to authenticated using (public.has_role(auth.uid(), 'admin'));
create trigger staff_profiles_updated_at before update on public.staff_profiles for each row execute function public.set_updated_at();

create or replace function public.is_active_staff(_user_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.user_roles r
    where r.user_id = _user_id and r.role in ('admin','staff')
      and not exists (select 1 from public.staff_profiles p where p.user_id = _user_id and p.active = false)
  )
$$;

create or replace function public.is_active_admin(_user_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.has_role(_user_id, 'admin')
    and not exists (select 1 from public.staff_profiles p where p.user_id = _user_id and p.active = false)
$$;

-- Import batches
create table public.import_batches (
  id uuid primary key default gen_random_uuid(),
  created_by uuid,
  filename text not null,
  total_rows integer not null default 0,
  inserted integer not null default 0,
  updated integer not null default 0,
  skipped integer not null default 0,
  errors jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);
grant select on public.import_batches to authenticated;
grant all on public.import_batches to service_role;
alter table public.import_batches enable row level security;
create policy "Admins read import batches" on public.import_batches for select to authenticated using (public.is_active_admin(auth.uid()));

-- Badge code generator (unambiguous alphabet)
create or replace function public.generate_badge_code()
returns text language plpgsql volatile set search_path = public as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  code text;
  i int;
begin
  loop
    code := '';
    for i in 1..6 loop
      code := code || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    end loop;
    code := 'AAK-' || code;
    exit when not exists (select 1 from public.delegates where badge_code = code);
  end loop;
  return code;
end; $$;

-- Delegates
create table public.delegates (
  id uuid primary key default gen_random_uuid(),
  badge_token text not null unique default encode(gen_random_bytes(16), 'hex'),
  badge_code text not null unique,
  full_name text not null,
  email citext not null unique,
  organization text not null,
  phone text,
  source public.delegate_source not null default 'import',
  status public.delegate_status not null default 'expected',
  import_batch_id uuid references public.import_batches(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.delegates alter column badge_code set default public.generate_badge_code();
create index delegates_full_name_idx on public.delegates (lower(full_name));
create index delegates_status_idx on public.delegates (status);
grant select, update, delete on public.delegates to authenticated;
grant all on public.delegates to service_role;
alter table public.delegates enable row level security;
create policy "Staff read delegates" on public.delegates for select to authenticated using (public.is_active_staff(auth.uid()));
create policy "Admins update delegates" on public.delegates for update to authenticated using (public.is_active_admin(auth.uid())) with check (public.is_active_admin(auth.uid()));
create policy "Admins delete delegates" on public.delegates for delete to authenticated using (public.is_active_admin(auth.uid()));
create trigger delegates_updated_at before update on public.delegates for each row execute function public.set_updated_at();

-- Check-ins (one per delegate)
create table public.check_ins (
  id uuid primary key default gen_random_uuid(),
  delegate_id uuid not null unique references public.delegates(id) on delete cascade,
  checked_in_at timestamptz not null default now(),
  checked_in_by uuid,
  method public.check_in_method not null,
  device_label text,
  notes text
);
create index check_ins_checked_in_at_idx on public.check_ins (checked_in_at desc);
grant select on public.check_ins to authenticated;
grant all on public.check_ins to service_role;
alter table public.check_ins enable row level security;
create policy "Staff read check-ins" on public.check_ins for select to authenticated using (public.is_active_staff(auth.uid()));

-- Audit events
create table public.audit_events (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid,
  actor_email text,
  action text not null,
  entity_type text,
  entity_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index audit_events_created_at_idx on public.audit_events (created_at desc);
grant select on public.audit_events to authenticated;
grant all on public.audit_events to service_role;
alter table public.audit_events enable row level security;
create policy "Admins read audit events" on public.audit_events for select to authenticated using (public.is_active_admin(auth.uid()));

create or replace function public.log_audit(_action text, _entity_type text, _entity_id uuid, _metadata jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.audit_events (actor_id, actor_email, action, entity_type, entity_id, metadata)
  values (auth.uid(), coalesce(auth.jwt() ->> 'email', null), _action, _entity_type, _entity_id, coalesce(_metadata, '{}'::jsonb));
end; $$;
revoke all on function public.log_audit(text, text, uuid, jsonb) from public, anon, authenticated;

-- Validation helper
create or replace function public.valid_email(_email text)
returns boolean language sql immutable as $$
  select _email is not null and length(_email) <= 255 and _email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
$$;

-- Public: create a badge (returns only the caller's own record)
create or replace function public.public_create_badge(p_full_name text, p_email text, p_organization text, p_phone text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_name text := btrim(coalesce(p_full_name, ''));
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_org text := btrim(coalesce(p_organization, ''));
  v_phone text := nullif(btrim(coalesce(p_phone, '')), '');
  d public.delegates%rowtype;
  v_existing boolean := false;
begin
  if length(v_name) < 2 or length(v_name) > 120 then raise exception 'Enter your full name.' using errcode = '22023'; end if;
  if not public.valid_email(v_email) then raise exception 'Enter a valid email address.' using errcode = '22023'; end if;
  if length(v_org) < 2 or length(v_org) > 160 then raise exception 'Enter your organization.' using errcode = '22023'; end if;
  if v_phone is not null and length(v_phone) > 40 then raise exception 'Phone number is too long.' using errcode = '22023'; end if;

  select * into d from public.delegates where email = v_email;
  if found then
    v_existing := true;
  else
    insert into public.delegates (full_name, email, organization, phone, source)
    values (v_name, v_email, v_org, v_phone, 'public')
    on conflict (email) do nothing
    returning * into d;
    if d.id is null then
      select * into d from public.delegates where email = v_email;
      v_existing := true;
    else
      perform public.log_audit('badge.created', 'delegate', d.id, jsonb_build_object('source', 'public'));
    end if;
  end if;

  return jsonb_build_object(
    'existing', v_existing,
    'full_name', d.full_name,
    'organization', d.organization,
    'badge_code', d.badge_code,
    'badge_token', d.badge_token,
    'status', d.status
  );
end; $$;

-- Public: find own badge by exact email
create or replace function public.public_find_badge(p_email text)
returns jsonb language plpgsql security definer stable set search_path = public as $$
declare
  d public.delegates%rowtype;
begin
  if not public.valid_email(lower(btrim(coalesce(p_email, '')))) then return null; end if;
  select * into d from public.delegates where email = lower(btrim(p_email));
  if not found then return null; end if;
  return jsonb_build_object(
    'existing', true,
    'full_name', d.full_name,
    'organization', d.organization,
    'badge_code', d.badge_code,
    'badge_token', d.badge_token,
    'status', d.status
  );
end; $$;

grant execute on function public.public_create_badge(text, text, text, text) to anon, authenticated;
grant execute on function public.public_find_badge(text) to anon, authenticated;

-- Staff: atomic, idempotent check-in
create or replace function public.check_in_delegate(p_lookup text, p_method public.check_in_method, p_device_label text default null, p_notes text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  d public.delegates%rowtype;
  c public.check_ins%rowtype;
  v_lookup text := btrim(coalesce(p_lookup, ''));
  v_inserted boolean := false;
begin
  if not public.is_active_staff(auth.uid()) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  if v_lookup = '' then
    return jsonb_build_object('result', 'not_found');
  end if;

  select * into d from public.delegates
  where badge_token = v_lookup
     or upper(badge_code) = upper(v_lookup)
     or upper(badge_code) = 'AAK-' || upper(v_lookup)
     or (v_lookup ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' and id = v_lookup::uuid)
  limit 1;

  if not found then
    perform public.log_audit('check_in.not_found', null, null, jsonb_build_object('lookup', left(v_lookup, 64), 'method', p_method, 'device', p_device_label));
    return jsonb_build_object('result', 'not_found');
  end if;

  insert into public.check_ins (delegate_id, checked_in_by, method, device_label, notes)
  values (d.id, auth.uid(), p_method, left(p_device_label, 160), left(p_notes, 500))
  on conflict (delegate_id) do nothing
  returning * into c;

  if c.id is not null then
    v_inserted := true;
    update public.delegates set status = 'checked_in' where id = d.id returning * into d;
    perform public.log_audit('check_in.created', 'delegate', d.id, jsonb_build_object('method', p_method, 'device', p_device_label, 'badge_code', d.badge_code));
  else
    select * into c from public.check_ins where delegate_id = d.id;
    perform public.log_audit('check_in.duplicate_attempt', 'delegate', d.id, jsonb_build_object('method', p_method, 'device', p_device_label, 'badge_code', d.badge_code));
  end if;

  return jsonb_build_object(
    'result', case when v_inserted then 'checked_in' else 'already_checked_in' end,
    'delegate', jsonb_build_object('id', d.id, 'full_name', d.full_name, 'organization', d.organization, 'email', d.email, 'badge_code', d.badge_code, 'status', d.status, 'source', d.source),
    'check_in', jsonb_build_object('id', c.id, 'checked_in_at', c.checked_in_at, 'method', c.method, 'checked_in_by', c.checked_in_by)
  );
end; $$;
revoke all on function public.check_in_delegate(text, public.check_in_method, text, text) from public, anon;
grant execute on function public.check_in_delegate(text, public.check_in_method, text, text) to authenticated;

-- Staff: add a walk-in and check them in
create or replace function public.add_and_check_in(p_full_name text, p_email text, p_organization text, p_phone text default null, p_device_label text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_name text := btrim(coalesce(p_full_name, ''));
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_org text := btrim(coalesce(p_organization, ''));
  v_phone text := nullif(btrim(coalesce(p_phone, '')), '');
  d public.delegates%rowtype;
  existing public.delegates%rowtype;
begin
  if not public.is_active_staff(auth.uid()) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  if length(v_name) < 2 or length(v_name) > 120 then raise exception 'Enter the delegate full name.' using errcode = '22023'; end if;
  if not public.valid_email(v_email) then raise exception 'Enter a valid email address.' using errcode = '22023'; end if;
  if length(v_org) < 2 or length(v_org) > 160 then raise exception 'Enter the organization.' using errcode = '22023'; end if;

  select * into existing from public.delegates where email = v_email;
  if found then
    return jsonb_build_object(
      'result', 'duplicate',
      'delegate', jsonb_build_object('id', existing.id, 'full_name', existing.full_name, 'organization', existing.organization, 'email', existing.email, 'badge_code', existing.badge_code, 'status', existing.status, 'source', existing.source)
    );
  end if;

  insert into public.delegates (full_name, email, organization, phone, source)
  values (v_name, v_email, v_org, v_phone, 'walk_in')
  returning * into d;
  perform public.log_audit('delegate.walk_in_added', 'delegate', d.id, jsonb_build_object('device', p_device_label));

  return public.check_in_delegate(d.badge_token, 'walk_in', p_device_label, 'Walk-in');
end; $$;
revoke all on function public.add_and_check_in(text, text, text, text, text) from public, anon;
grant execute on function public.add_and_check_in(text, text, text, text, text) to authenticated;

-- Admin: CSV import (upsert by email)
create or replace function public.import_delegates(p_rows jsonb, p_filename text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  b public.import_batches%rowtype;
  r jsonb;
  idx int := 0;
  v_name text; v_email text; v_org text; v_phone text;
  v_inserted int := 0; v_updated int := 0; v_skipped int := 0;
  v_errors jsonb := '[]'::jsonb;
  v_exists boolean;
begin
  if not public.is_active_admin(auth.uid()) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'No rows to import.' using errcode = '22023';
  end if;
  if jsonb_array_length(p_rows) > 5000 then
    raise exception 'Import at most 5000 rows per file.' using errcode = '22023';
  end if;

  insert into public.import_batches (created_by, filename, total_rows)
  values (auth.uid(), left(coalesce(p_filename, 'import.csv'), 200), jsonb_array_length(p_rows))
  returning * into b;

  for r in select * from jsonb_array_elements(p_rows) loop
    idx := idx + 1;
    v_name := btrim(coalesce(r ->> 'full_name', ''));
    v_email := lower(btrim(coalesce(r ->> 'email', '')));
    v_org := btrim(coalesce(r ->> 'organization', ''));
    v_phone := nullif(btrim(coalesce(r ->> 'phone', '')), '');

    if length(v_name) < 2 or length(v_name) > 120 then
      v_skipped := v_skipped + 1;
      v_errors := v_errors || jsonb_build_object('row', idx, 'email', v_email, 'reason', 'Missing or invalid full name');
      continue;
    end if;
    if not public.valid_email(v_email) then
      v_skipped := v_skipped + 1;
      v_errors := v_errors || jsonb_build_object('row', idx, 'email', v_email, 'reason', 'Missing or invalid email');
      continue;
    end if;
    if length(v_org) < 1 or length(v_org) > 160 then
      v_skipped := v_skipped + 1;
      v_errors := v_errors || jsonb_build_object('row', idx, 'email', v_email, 'reason', 'Missing organization');
      continue;
    end if;

    select exists(select 1 from public.delegates where email = v_email) into v_exists;
    if v_exists then
      update public.delegates
        set full_name = v_name, organization = v_org, phone = coalesce(v_phone, phone), import_batch_id = b.id
        where email = v_email;
      v_updated := v_updated + 1;
    else
      insert into public.delegates (full_name, email, organization, phone, source, import_batch_id)
      values (v_name, v_email, v_org, v_phone, 'import', b.id);
      v_inserted := v_inserted + 1;
    end if;
  end loop;

  update public.import_batches
    set inserted = v_inserted, updated = v_updated, skipped = v_skipped, errors = v_errors
    where id = b.id;

  perform public.log_audit('import.completed', 'import_batch', b.id, jsonb_build_object('filename', b.filename, 'total', b.total_rows, 'inserted', v_inserted, 'updated', v_updated, 'skipped', v_skipped));

  return jsonb_build_object('batch_id', b.id, 'total', b.total_rows, 'inserted', v_inserted, 'updated', v_updated, 'skipped', v_skipped, 'errors', v_errors);
end; $$;
revoke all on function public.import_delegates(jsonb, text) from public, anon;
grant execute on function public.import_delegates(jsonb, text) to authenticated;

-- Admin: remove seed test data (example.com emails only)
create or replace function public.remove_test_delegates()
returns integer language plpgsql security definer set search_path = public as $$
declare v_count int;
begin
  if not public.is_active_admin(auth.uid()) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  with del as (delete from public.delegates where email::text like '%@example.com' returning id)
  select count(*) into v_count from del;
  perform public.log_audit('delegates.test_data_removed', null, null, jsonb_build_object('count', v_count));
  return v_count;
end; $$;
revoke all on function public.remove_test_delegates() from public, anon;
grant execute on function public.remove_test_delegates() to authenticated;

-- Staff: dashboard stats
create or replace function public.dashboard_stats()
returns jsonb language sql stable security definer set search_path = public as $$
  select case when public.is_active_staff(auth.uid()) then jsonb_build_object(
    'expected', (select count(*) from public.delegates),
    'checked_in', (select count(*) from public.check_ins),
    'walk_ins', (select count(*) from public.delegates where source = 'walk_in'),
    'last_check_in_at', (select max(checked_in_at) from public.check_ins)
  ) else null end
$$;
revoke all on function public.dashboard_stats() from public, anon;
grant execute on function public.dashboard_stats() to authenticated;

-- First administrator bootstrap: only succeeds while no admin exists
create or replace function public.claim_first_admin(p_user_id uuid, p_full_name text, p_email text)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  perform pg_advisory_xact_lock(hashtext('claim_first_admin'));
  if exists (select 1 from public.user_roles where role = 'admin') then
    return false;
  end if;
  insert into public.user_roles (user_id, role) values (p_user_id, 'admin');
  insert into public.staff_profiles (user_id, full_name, email) values (p_user_id, p_full_name, p_email)
    on conflict (user_id) do update set full_name = excluded.full_name, email = excluded.email;
  insert into public.audit_events (actor_id, actor_email, action, entity_type, entity_id, metadata)
  values (p_user_id, p_email, 'staff.first_admin_claimed', 'staff', p_user_id, '{}'::jsonb);
  return true;
end; $$;
revoke all on function public.claim_first_admin(uuid, text, text) from public, anon, authenticated;

create or replace function public.admin_exists()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_roles where role = 'admin')
$$;
grant execute on function public.admin_exists() to anon, authenticated;

-- Realtime
alter publication supabase_realtime add table public.delegates;
alter publication supabase_realtime add table public.check_ins;

-- Fictional seed data (TEST ONLY). All emails use example.com so they can be removed in one action.
insert into public.import_batches (id, filename, total_rows, inserted)
values ('00000000-0000-4000-8000-000000000001', 'seed-fictional-test-data.csv', 12, 12);

insert into public.delegates (full_name, email, organization, phone, source, import_batch_id) values
('Test Delegate Wanjiru Kamau', 'test.wanjiru.kamau@example.com', 'Sample Practice One (test data)', '+254 700 000 001', 'import', '00000000-0000-4000-8000-000000000001'),
('Test Delegate Otieno Achieng', 'test.otieno.achieng@example.com', 'Sample Practice Two (test data)', '+254 700 000 002', 'import', '00000000-0000-4000-8000-000000000001'),
('Test Delegate Amina Yusuf', 'test.amina.yusuf@example.com', 'Sample County Works (test data)', null, 'import', '00000000-0000-4000-8000-000000000001'),
('Test Delegate Kipchoge Rotich', 'test.kipchoge.rotich@example.com', 'Sample Quantity Surveyors (test data)', '+254 700 000 004', 'import', '00000000-0000-4000-8000-000000000001'),
('Test Delegate Njeri Mwangi', 'test.njeri.mwangi@example.com', 'Sample Landscape Studio (test data)', null, 'import', '00000000-0000-4000-8000-000000000001'),
('Test Delegate Baraka Mwakio', 'test.baraka.mwakio@example.com', 'Sample Coastal Engineers (test data)', '+254 700 000 006', 'import', '00000000-0000-4000-8000-000000000001'),
('Test Delegate Zawadi Hassan', 'test.zawadi.hassan@example.com', 'Sample University Department (test data)', null, 'import', '00000000-0000-4000-8000-000000000001'),
('Test Delegate Mutua Kilonzo', 'test.mutua.kilonzo@example.com', 'Sample Construction Managers (test data)', '+254 700 000 008', 'import', '00000000-0000-4000-8000-000000000001'),
('Test Delegate Chebet Koech', 'test.chebet.koech@example.com', 'Sample Planning Consultancy (test data)', null, 'import', '00000000-0000-4000-8000-000000000001'),
('Test Delegate Omondi Owuor', 'test.omondi.owuor@example.com', 'Sample Practice One (test data)', '+254 700 000 010', 'import', '00000000-0000-4000-8000-000000000001'),
('Test Delegate Fatuma Ali', 'test.fatuma.ali@example.com', 'Sample Interior Studio (test data)', null, 'import', '00000000-0000-4000-8000-000000000001'),
('Test Delegate Kariuki Ndungu', 'test.kariuki.ndungu@example.com', 'Sample Practice Two (test data)', '+254 700 000 012', 'import', '00000000-0000-4000-8000-000000000001');