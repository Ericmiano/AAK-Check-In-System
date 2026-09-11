-- Email was globally unique across all delegates ever, which would block
-- the same person from being a delegate at a second event later. Scope
-- uniqueness to (event_id, email) instead: each event gets its own delegate
-- row per person, each with its own independent status and check-in, which
-- is the correct model for a check-in system meant to be reused event after
-- event. check_ins' one-row-per-delegate-id constraint stays correct as-is,
-- since a returning attendee now gets a fresh delegate row per event.
alter table public.delegates drop constraint delegates_email_key;
alter table public.delegates add constraint delegates_event_email_key unique (event_id, email);

-- Admin: CSV import, now tagging every row with the active event and
-- matching existing rows only within that same event.
create or replace function public.import_delegates(p_rows jsonb, p_filename text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_event_id uuid := public.active_event_id();
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
  if v_event_id is null then
    raise exception 'No active event. Create and activate an event before importing.' using errcode = '22023';
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

    select exists(select 1 from public.delegates where email = v_email and event_id = v_event_id) into v_exists;
    if v_exists then
      update public.delegates
        set full_name = v_name, organization = v_org, phone = coalesce(v_phone, phone), import_batch_id = b.id
        where email = v_email and event_id = v_event_id;
      v_updated := v_updated + 1;
    else
      insert into public.delegates (full_name, email, organization, phone, source, import_batch_id, event_id)
      values (v_name, v_email, v_org, v_phone, 'import', b.id, v_event_id);
      v_inserted := v_inserted + 1;
    end if;
  end loop;

  update public.import_batches
    set inserted = v_inserted, updated = v_updated, skipped = v_skipped, errors = v_errors
    where id = b.id;

  perform public.log_audit('import.completed', 'import_batch', b.id, jsonb_build_object('filename', b.filename, 'total', b.total_rows, 'inserted', v_inserted, 'updated', v_updated, 'skipped', v_skipped, 'event_id', v_event_id));

  return jsonb_build_object('batch_id', b.id, 'total', b.total_rows, 'inserted', v_inserted, 'updated', v_updated, 'skipped', v_skipped, 'errors', v_errors);
end; $$;

-- Staff: atomic, idempotent check-in — now scoped to the active event so a
-- badge or search match from a past event can never be checked in today.
create or replace function public.check_in_delegate(p_lookup text, p_method public.check_in_method, p_device_label text default null, p_notes text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_event_id uuid := public.active_event_id();
  d public.delegates%rowtype;
  c public.check_ins%rowtype;
  v_lookup text := btrim(coalesce(p_lookup, ''));
  v_inserted boolean := false;
begin
  if not public.is_active_staff(auth.uid()) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  if v_lookup = '' or v_event_id is null then
    return jsonb_build_object('result', 'not_found');
  end if;

  select * into d from public.delegates
  where event_id = v_event_id
    and (
      badge_token = v_lookup
      or upper(badge_code) = upper(v_lookup)
      or upper(badge_code) = 'AAK-' || upper(v_lookup)
      or (v_lookup ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' and id = v_lookup::uuid)
    )
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

-- Staff: add a walk-in and check them in, scoped to the active event.
create or replace function public.add_and_check_in(p_full_name text, p_email text, p_organization text, p_phone text default null, p_device_label text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_event_id uuid := public.active_event_id();
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
  if v_event_id is null then
    raise exception 'No active event.' using errcode = '22023';
  end if;
  if length(v_name) < 2 or length(v_name) > 120 then raise exception 'Enter the delegate full name.' using errcode = '22023'; end if;
  if not public.valid_email(v_email) then raise exception 'Enter a valid email address.' using errcode = '22023'; end if;
  if length(v_org) < 2 or length(v_org) > 160 then raise exception 'Enter the organization.' using errcode = '22023'; end if;

  select * into existing from public.delegates where email = v_email and event_id = v_event_id;
  if found then
    return jsonb_build_object(
      'result', 'duplicate',
      'delegate', jsonb_build_object('id', existing.id, 'full_name', existing.full_name, 'organization', existing.organization, 'email', existing.email, 'badge_code', existing.badge_code, 'status', existing.status, 'source', existing.source)
    );
  end if;

  insert into public.delegates (full_name, email, organization, phone, source, event_id)
  values (v_name, v_email, v_org, v_phone, 'walk_in', v_event_id)
  returning * into d;
  perform public.log_audit('delegate.walk_in_added', 'delegate', d.id, jsonb_build_object('device', p_device_label));

  return public.check_in_delegate(d.badge_token, 'walk_in', p_device_label, 'Walk-in');
end; $$;

-- Public kiosk: self-check-in, scoped to the active event.
create or replace function public.kiosk_check_in(p_token text, p_email text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_event_id uuid := public.active_event_id();
  v_email text := lower(btrim(coalesce(p_email, '')));
  d public.delegates%rowtype;
  c public.check_ins%rowtype;
  v_inserted boolean := false;
begin
  if not exists (select 1 from public.kiosk_tokens where token = btrim(coalesce(p_token, '')) and active) then
    raise exception 'This check-in code is no longer active. Please see a staff member.' using errcode = '42501';
  end if;
  if v_event_id is null or not public.valid_email(v_email) then
    return jsonb_build_object('result', 'not_found');
  end if;

  select * into d from public.delegates where email = v_email and event_id = v_event_id;
  if not found then
    perform public.log_audit('check_in.kiosk_not_found', null, null, jsonb_build_object('email', v_email));
    return jsonb_build_object('result', 'not_found');
  end if;

  insert into public.check_ins (delegate_id, checked_in_by, method, device_label)
  values (d.id, null, 'kiosk', 'Self check-in kiosk')
  on conflict (delegate_id) do nothing
  returning * into c;

  if c.id is not null then
    v_inserted := true;
    update public.delegates set status = 'checked_in' where id = d.id returning * into d;
    perform public.log_audit('check_in.created', 'delegate', d.id, jsonb_build_object('method', 'kiosk', 'badge_code', d.badge_code));
  end if;

  return jsonb_build_object(
    'result', case when v_inserted then 'checked_in' else 'already_checked_in' end,
    'full_name', d.full_name,
    'organization', d.organization
  );
end; $$;

-- Staff: dashboard stats, scoped to the active event.
create or replace function public.dashboard_stats()
returns jsonb language sql stable security definer set search_path = public as $$
  select case when public.is_active_staff(auth.uid()) then jsonb_build_object(
    'expected', (select count(*) from public.delegates where event_id = public.active_event_id()),
    'checked_in', (select count(*) from public.check_ins ci join public.delegates d on d.id = ci.delegate_id where d.event_id = public.active_event_id()),
    'walk_ins', (select count(*) from public.delegates where event_id = public.active_event_id() and source = 'walk_in'),
    'last_check_in_at', (select max(ci.checked_in_at) from public.check_ins ci join public.delegates d on d.id = ci.delegate_id where d.event_id = public.active_event_id())
  ) else null end
$$;
