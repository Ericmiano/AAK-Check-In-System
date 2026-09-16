-- The convention runs multiple days (through Saturday), and delegates need
-- to check in on each day they attend, not just once for the whole event.
-- check_ins has so far enforced one row per delegate ever (unique on
-- delegate_id alone); switch that to one row per delegate PER DAY, where
-- "day" is the calendar date at the venue (Africa/Nairobi), so the same
-- person can have a fresh check-in every morning without staff re-adding
-- them or the system claiming they're a duplicate.
alter table public.check_ins add column check_in_date date;

update public.check_ins
  set check_in_date = (checked_in_at at time zone 'Africa/Nairobi')::date
  where check_in_date is null;

alter table public.check_ins alter column check_in_date set not null;
alter table public.check_ins alter column check_in_date set default ((now() at time zone 'Africa/Nairobi')::date);

alter table public.check_ins drop constraint check_ins_delegate_id_key;
alter table public.check_ins add constraint check_ins_delegate_id_date_key unique (delegate_id, check_in_date);
create index check_ins_event_date_idx on public.check_ins (event_id, check_in_date);

-- Staff check-in: "already checked in" now means already checked in TODAY,
-- not ever — a returning delegate from a previous day gets checked in
-- fresh. A delegate's lifetime `status` still only ever moves expected/
-- pending -> checked_in on their first-ever check-in (it doesn't reset
-- between days); day-to-day presence lives in check_ins rows instead.
create or replace function public.check_in_delegate(p_lookup text, p_method public.check_in_method, p_device_label text default null, p_notes text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_event_id uuid := public.active_event_id();
  v_today date := (now() at time zone 'Africa/Nairobi')::date;
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

  insert into public.check_ins (delegate_id, event_id, check_in_date, checked_in_by, method, device_label, notes)
  values (d.id, v_event_id, v_today, auth.uid(), p_method, left(p_device_label, 160), left(p_notes, 500))
  on conflict (delegate_id, check_in_date) do nothing
  returning * into c;

  if c.id is not null then
    v_inserted := true;
    update public.delegates set status = 'checked_in' where id = d.id returning * into d;
    perform public.log_audit('check_in.created', 'delegate', d.id, jsonb_build_object('method', p_method, 'device', p_device_label, 'badge_code', d.badge_code));
  else
    select * into c from public.check_ins where delegate_id = d.id and check_in_date = v_today;
    perform public.log_audit('check_in.duplicate_attempt', 'delegate', d.id, jsonb_build_object('method', p_method, 'device', p_device_label, 'badge_code', d.badge_code));
  end if;

  return jsonb_build_object(
    'result', case when v_inserted then 'checked_in' else 'already_checked_in' end,
    'delegate', jsonb_build_object('id', d.id, 'full_name', d.full_name, 'organization', d.organization, 'email', d.email, 'badge_code', d.badge_code, 'status', d.status, 'source', d.source),
    'check_in', jsonb_build_object('id', c.id, 'checked_in_at', c.checked_in_at, 'method', c.method, 'checked_in_by', c.checked_in_by)
  );
end; $$;

-- Kiosk: same day-scoping for the "already checked in" / needs_details gate.
create or replace function public.kiosk_check_in(
  p_token text,
  p_full_name text,
  p_email text default null,
  p_organization text default null,
  p_photo_consent boolean default null,
  p_phone text default null
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_event_id uuid := public.active_event_id();
  v_today date := (now() at time zone 'Africa/Nairobi')::date;
  v_name_norm text := public.normalize_name(p_full_name);
  v_email text := nullif(lower(btrim(coalesce(p_email, ''))), '');
  v_org text := nullif(btrim(coalesce(p_organization, '')), '');
  v_phone text := nullif(btrim(coalesce(p_phone, '')), '');
  d public.delegates%rowtype;
  c public.check_ins%rowtype;
  v_inserted boolean := false;
  v_match_count int;
begin
  if not exists (select 1 from public.kiosk_tokens where token = btrim(coalesce(p_token, '')) and active) then
    raise exception 'This check-in code is no longer active. Please see a staff member.' using errcode = '42501';
  end if;
  if v_event_id is null or v_name_norm = '' then
    return jsonb_build_object('result', 'not_found');
  end if;
  if v_email is not null and not public.valid_email(v_email) then
    raise exception 'Enter a valid email address.' using errcode = '22023';
  end if;
  if v_phone is not null and not public.valid_phone(v_phone) then
    raise exception 'Enter a valid phone number.' using errcode = '22023';
  end if;

  select count(*) into v_match_count from public.delegates
    where event_id = v_event_id and public.normalize_name(full_name) = v_name_norm;

  if v_match_count <> 1 then
    perform public.log_audit('check_in.kiosk_not_found', null, null, jsonb_build_object('name', left(coalesce(p_full_name, ''), 120), 'matches', v_match_count));
    return jsonb_build_object('result', 'not_found');
  end if;

  select * into d from public.delegates
    where event_id = v_event_id and public.normalize_name(full_name) = v_name_norm;

  update public.delegates
    set email = coalesce(v_email, email),
        organization = coalesce(v_org, organization),
        phone = coalesce(v_phone, phone),
        photo_consent = coalesce(p_photo_consent, photo_consent)
    where id = d.id
    returning * into d;

  select * into c from public.check_ins where delegate_id = d.id and check_in_date = v_today;
  if c.id is not null then
    return jsonb_build_object('result', 'already_checked_in', 'full_name', d.full_name, 'organization', d.organization);
  end if;

  if d.email is null or d.phone is null then
    perform public.log_audit('check_in.kiosk_needs_details', 'delegate', d.id, jsonb_build_object('missing_email', d.email is null, 'missing_phone', d.phone is null));
    return jsonb_build_object(
      'result', 'needs_details',
      'full_name', d.full_name,
      'missing_email', d.email is null,
      'missing_phone', d.phone is null
    );
  end if;

  insert into public.check_ins (delegate_id, event_id, check_in_date, checked_in_by, method, device_label)
  values (d.id, v_event_id, v_today, null, 'kiosk', 'Self check-in kiosk')
  on conflict (delegate_id, check_in_date) do nothing
  returning * into c;

  if c.id is not null then
    v_inserted := true;
    update public.delegates set status = 'checked_in' where id = d.id returning * into d;
    perform public.log_audit('check_in.created', 'delegate', d.id, jsonb_build_object('method', 'kiosk', 'badge_code', d.badge_code));
  else
    select * into c from public.check_ins where delegate_id = d.id and check_in_date = v_today;
  end if;

  return jsonb_build_object(
    'result', case when v_inserted then 'checked_in' else 'already_checked_in' end,
    'full_name', d.full_name,
    'organization', d.organization
  );
end; $$;

-- Undo: only the mis-tap that was just made — removes today's check-in row
-- only (not the delegate's whole attendance history), and only drops status
-- back to "expected" when that was genuinely their only check-in ever.
create or replace function public.undo_check_in(p_delegate_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_event_id uuid := public.active_event_id();
  v_today date := (now() at time zone 'Africa/Nairobi')::date;
  d public.delegates%rowtype;
begin
  if not public.is_active_staff(auth.uid()) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  select * into d from public.delegates where id = p_delegate_id and event_id = v_event_id;
  if not found then
    raise exception 'Delegate not found in the active event.' using errcode = '22023';
  end if;

  delete from public.check_ins where delegate_id = p_delegate_id and check_in_date = v_today;
  update public.delegates
    set status = case when exists (select 1 from public.check_ins where delegate_id = p_delegate_id) then status else 'expected' end
    where id = p_delegate_id
    returning * into d;

  perform public.log_audit('check_in.undone', 'delegate', d.id, jsonb_build_object('badge_code', d.badge_code));

  return jsonb_build_object('id', d.id, 'full_name', d.full_name, 'status', d.status);
end; $$;

-- Dashboard: "checked_in" now reports today's live attendance (the number
-- that actually matters while the event is running), with a separate
-- lifetime "checked_in_ever" (badges issued) for overall registration
-- tracking across the whole multi-day event.
create or replace function public.dashboard_stats()
returns jsonb language sql stable security definer set search_path = public as $$
  select case when public.is_active_staff(auth.uid()) then jsonb_build_object(
    'expected', (select count(*) from public.delegates where event_id = public.active_event_id()),
    'checked_in', (select count(distinct ci.delegate_id) from public.check_ins ci join public.delegates d on d.id = ci.delegate_id where d.event_id = public.active_event_id() and ci.check_in_date = (now() at time zone 'Africa/Nairobi')::date),
    'checked_in_ever', (select count(*) from public.delegates where event_id = public.active_event_id() and status = 'checked_in'),
    'walk_ins', (select count(*) from public.delegates where event_id = public.active_event_id() and source = 'walk_in'),
    'last_check_in_at', (select max(ci.checked_in_at) from public.check_ins ci join public.delegates d on d.id = ci.delegate_id where d.event_id = public.active_event_id())
  ) else null end
$$;

-- Delegate portal badge lookup: check_ins is now a has-many relation per
-- delegate (one row per day), so the old bare join could return more than
-- one row and this function (declared to return a single jsonb) would
-- start erroring the moment anyone had a second day's check-in. Pick their
-- most recent check-in instead.
create or replace function public.public_get_badge(p_token text)
returns jsonb language sql stable security definer set search_path = public as $$
  select case when d.id is null then null else jsonb_build_object(
    'full_name', d.full_name,
    'organization', d.organization,
    'badge_code', d.badge_code,
    'badge_token', d.badge_token,
    'status', d.status,
    'checked_in_at', c.checked_in_at,
    'checked_in_today', c.check_in_date = (now() at time zone 'Africa/Nairobi')::date
  ) end
  from (select 1) as _dummy
  left join public.delegates d on d.badge_token = btrim(coalesce(p_token, ''))
  left join lateral (
    select * from public.check_ins ci
    where ci.delegate_id = d.id
    order by ci.check_in_date desc, ci.checked_in_at desc
    limit 1
  ) c on true
$$;
