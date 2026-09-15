-- Name alone is a weak identifier once you have more than one delegate
-- with the same (or similarly-spelled) name — badges, exports, and any
-- follow-up contact all key off the record itself, not just what's on
-- screen at the desk. Require email + phone for anyone the kiosk can't
-- already fully identify: a brand-new self-registration (kiosk_self_register)
-- has no prior record to fall back on, and an existing match whose record
-- is still missing email or phone hasn't given us a way to disambiguate
-- them from a same-named delegate either. A fully-registered match with
-- both fields already on file is unaffected and keeps checking in on name
-- alone, same as today.

create or replace function public.valid_phone(_phone text)
returns boolean language sql immutable as $$
  select _phone is not null and length(regexp_replace(_phone, '[^0-9]', '', 'g')) >= 7
$$;

revoke all on function public.valid_phone(text) from public, anon, authenticated;

-- Public kiosk, matched delegate: now also accepts p_phone, and won't
-- complete the check-in until the record has both email and phone —
-- either already on file, or just supplied — returning 'needs_details'
-- instead so the kiosk can ask for whatever's still missing.
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

  if d.email is null or d.phone is null then
    perform public.log_audit('check_in.kiosk_needs_details', 'delegate', d.id, jsonb_build_object('missing_email', d.email is null, 'missing_phone', d.phone is null));
    return jsonb_build_object(
      'result', 'needs_details',
      'full_name', d.full_name,
      'missing_email', d.email is null,
      'missing_phone', d.phone is null
    );
  end if;

  insert into public.check_ins (delegate_id, event_id, checked_in_by, method, device_label)
  values (d.id, v_event_id, null, 'kiosk', 'Self check-in kiosk')
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

revoke all on function public.kiosk_check_in(text, text, text, text, boolean, text) from public;
grant execute on function public.kiosk_check_in(text, text, text, text, boolean, text) to anon, authenticated;

-- Public kiosk, self-registration: email and phone are now mandatory,
-- not just accepted — a brand-new record has no other way to tell two
-- same-named registrants apart.
create or replace function public.kiosk_self_register(
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
  v_name text := btrim(coalesce(p_full_name, ''));
  v_name_norm text := public.normalize_name(p_full_name);
  v_email text := nullif(lower(btrim(coalesce(p_email, ''))), '');
  v_org text := nullif(btrim(coalesce(p_organization, '')), '');
  v_phone text := nullif(btrim(coalesce(p_phone, '')), '');
  d public.delegates%rowtype;
  v_match_count int;
begin
  if not exists (select 1 from public.kiosk_tokens where token = btrim(coalesce(p_token, '')) and active) then
    raise exception 'This check-in code is no longer active. Please see a staff member.' using errcode = '42501';
  end if;
  if v_event_id is null then
    raise exception 'No active event.' using errcode = '22023';
  end if;
  if length(v_name) < 2 or length(v_name) > 120 then
    raise exception 'Enter your full name.' using errcode = '22023';
  end if;
  if not public.valid_email(v_email) then
    raise exception 'Enter a valid email address.' using errcode = '22023';
  end if;
  if not public.valid_phone(v_phone) then
    raise exception 'Enter a valid phone number.' using errcode = '22023';
  end if;

  select count(*) into v_match_count from public.delegates
    where event_id = v_event_id and public.normalize_name(full_name) = v_name_norm;
  if v_match_count > 0 then
    raise exception 'That name is already on the list — please try checking in again, or see a staff member.' using errcode = '22023';
  end if;

  insert into public.delegates (full_name, email, organization, phone, photo_consent, source, status, event_id)
  values (v_name, v_email, v_org, v_phone, p_photo_consent, 'kiosk', 'pending', v_event_id)
  returning * into d;

  perform public.log_audit('delegate.kiosk_self_registered', 'delegate', d.id, jsonb_build_object('full_name', d.full_name));

  return jsonb_build_object('result', 'registered', 'full_name', d.full_name);
end; $$;

revoke all on function public.kiosk_self_register(text, text, text, text, boolean, text) from public;
grant execute on function public.kiosk_self_register(text, text, text, text, boolean, text) to anon, authenticated;

-- Old five-arg signatures are gone now that p_phone is part of both calls.
drop function if exists public.kiosk_check_in(text, text, text, text, boolean);
drop function if exists public.kiosk_self_register(text, text, text, text, boolean);
