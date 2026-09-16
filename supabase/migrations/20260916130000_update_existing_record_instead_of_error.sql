-- Both the staff walk-in flow and kiosk self-registration used to dead-end
-- with an error the moment they found an existing record with that name or
-- email, forcing staff to abandon the form and go search manually instead.
-- In both cases the sensible thing is obvious: update that existing record
-- with whatever new details were just given, and carry on straight to
-- check-in, exactly as if it had matched in the first place.

-- Walk-in: a match by email, or by name when the existing row has no email,
-- now updates that record (organization/phone/email filled in from
-- whatever was just typed, keeping what's already on file when a field was
-- left blank) and checks it in, instead of stopping at "already in the
-- system, search for them instead".
create or replace function public.add_and_check_in(p_full_name text, p_email text, p_organization text, p_phone text default null, p_device_label text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_event_id uuid := public.active_event_id();
  v_name text := btrim(coalesce(p_full_name, ''));
  v_email text := nullif(lower(btrim(coalesce(p_email, ''))), '');
  v_org text := nullif(btrim(coalesce(p_organization, '')), '');
  v_phone text := nullif(btrim(coalesce(p_phone, '')), '');
  v_match_id uuid;
  d public.delegates%rowtype;
begin
  if not public.is_active_staff(auth.uid()) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  if v_event_id is null then
    raise exception 'No active event.' using errcode = '22023';
  end if;
  if length(v_name) < 2 or length(v_name) > 120 then
    raise exception 'Enter the delegate full name.' using errcode = '22023';
  end if;
  if v_email is not null and not public.valid_email(v_email) then
    raise exception 'Enter a valid email address.' using errcode = '22023';
  end if;

  if v_email is not null then
    select id into v_match_id from public.delegates
      where email = v_email and event_id = v_event_id
      limit 1;
  else
    select id into v_match_id from public.delegates
      where event_id = v_event_id and email is null and public.normalize_name(full_name) = public.normalize_name(v_name)
      limit 1;
  end if;

  if v_match_id is not null then
    update public.delegates
      set email = coalesce(email, v_email),
          organization = coalesce(v_org, organization),
          phone = coalesce(v_phone, phone)
      where id = v_match_id
      returning * into d;
    return public.check_in_delegate(d.badge_token, 'walk_in', p_device_label, 'Walk-in (existing record updated)');
  end if;

  insert into public.delegates (full_name, email, organization, phone, source, event_id)
  values (v_name, v_email, v_org, v_phone, 'walk_in', v_event_id)
  returning * into d;
  perform public.log_audit('delegate.walk_in_added', 'delegate', d.id, jsonb_build_object('device', p_device_label));

  return public.check_in_delegate(d.badge_token, 'walk_in', p_device_label, 'Walk-in');
end; $$;

-- Kiosk self-registration: if exactly one existing record already carries
-- that name (it slipped past kiosk_check_in's own, separately-timed search
-- — e.g. someone else's check-in changed the roster in between), treat this
-- exactly like checking that record in rather than refusing with an error:
-- delegate straight to kiosk_check_in, which already knows how to update
-- details and walk through the normal checked_in / already_checked_in /
-- needs_details outcomes. Only a genuinely ambiguous name (2+ existing
-- matches, so there's no single record to safely update) still can't be
-- resolved automatically.
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

  if v_match_count = 1 then
    return public.kiosk_check_in(p_token, p_full_name, p_email, p_organization, p_photo_consent, p_phone);
  elsif v_match_count > 1 then
    raise exception 'More than one person is already registered under that name. Please see a staff member.' using errcode = '22023';
  end if;

  insert into public.delegates (full_name, email, organization, phone, photo_consent, source, status, event_id)
  values (v_name, v_email, v_org, v_phone, p_photo_consent, 'kiosk', 'pending', v_event_id)
  returning * into d;

  perform public.log_audit('delegate.kiosk_self_registered', 'delegate', d.id, jsonb_build_object('full_name', d.full_name));

  return jsonb_build_object('result', 'registered', 'full_name', d.full_name);
end; $$;
