-- kiosk_check_in's new email/phone gate (20260915130000) fired even for
-- someone who is already checked in and just has an incomplete legacy
-- record (e.g. a name-only import) — they'd hit "Almost there, add your
-- email and phone" every time they revisited the kiosk, which is
-- misleading since they're already in. The gate should only apply to a
-- check-in that's actually about to happen for the first time; someone
-- already checked in should still get the normal "Already checked in"
-- response regardless of what's on file for them.
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

  select * into c from public.check_ins where delegate_id = d.id;
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

  insert into public.check_ins (delegate_id, event_id, checked_in_by, method, device_label)
  values (d.id, v_event_id, null, 'kiosk', 'Self check-in kiosk')
  on conflict (delegate_id) do nothing
  returning * into c;

  if c.id is not null then
    v_inserted := true;
    update public.delegates set status = 'checked_in' where id = d.id returning * into d;
    perform public.log_audit('check_in.created', 'delegate', d.id, jsonb_build_object('method', 'kiosk', 'badge_code', d.badge_code));
  else
    select * into c from public.check_ins where delegate_id = d.id;
  end if;

  return jsonb_build_object(
    'result', case when v_inserted then 'checked_in' else 'already_checked_in' end,
    'full_name', d.full_name,
    'organization', d.organization
  );
end; $$;
