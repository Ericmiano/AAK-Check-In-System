-- The tag is handed over at the moment someone is checked in, so require
-- staff to separately tick a box for it every time added friction with no
-- benefit — auto-mark it the instant a delegate's first check-in of the
-- event happens. It's still a plain one-time field (coalesce, same as
-- set_tag_issued), so this only fires once per delegate no matter how many
-- days they attend, and staff keep full manual mark/unmark control via the
-- existing set_tag_issued RPC for corrections (a shortage at the desk, a
-- delegate who left before collecting theirs, etc). Gift bags are
-- deliberately NOT auto-marked — that's a separate, often separately-staffed
-- hand-out staff still confirm by hand.
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
    update public.delegates
      set status = 'checked_in',
          tag_issued_at = coalesce(tag_issued_at, now()),
          tag_issued_by = coalesce(tag_issued_by, auth.uid())
      where id = d.id
      returning * into d;
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
    update public.delegates
      set status = 'checked_in',
          tag_issued_at = coalesce(tag_issued_at, now())
      where id = d.id
      returning * into d;
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

-- Undo needs to match: if this was genuinely the delegate's only check-in
-- (so status reverts to "expected"), the tag auto-issued alongside it never
-- corresponded to a real hand-out either, so clear it too. A returning
-- delegate who still has an earlier day's check-in keeps both their
-- checked_in status and their tag untouched. Gift bags are never touched
-- here since they were never auto-marked in the first place.
create or replace function public.undo_check_in(p_delegate_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_event_id uuid := public.active_event_id();
  v_today date := (now() at time zone 'Africa/Nairobi')::date;
  d public.delegates%rowtype;
  v_no_checkins_left boolean;
begin
  if not public.is_active_staff(auth.uid()) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  select * into d from public.delegates where id = p_delegate_id and event_id = v_event_id;
  if not found then
    raise exception 'Delegate not found in the active event.' using errcode = '22023';
  end if;

  delete from public.check_ins where delegate_id = p_delegate_id and check_in_date = v_today;
  v_no_checkins_left := not exists (select 1 from public.check_ins where delegate_id = p_delegate_id);

  update public.delegates
    set status = case when v_no_checkins_left then 'expected' else status end,
        tag_issued_at = case when v_no_checkins_left then null else tag_issued_at end,
        tag_issued_by = case when v_no_checkins_left then null else tag_issued_by end
    where id = p_delegate_id
    returning * into d;

  perform public.log_audit('check_in.undone', 'delegate', d.id, jsonb_build_object('badge_code', d.badge_code));

  return jsonb_build_object('id', d.id, 'full_name', d.full_name, 'status', d.status);
end; $$;
