-- The kiosk used to match a delegate by exact email, but this event's roster
-- was imported name-only (email/institution/photo consent are collected at
-- the door, same as the paper sign-in sheet). Email can no longer be the
-- kiosk's identifier, so it switches to matching by full name instead — the
-- one field every pre-registered delegate always has — while still letting
-- the delegate fill in email, institution, and photo consent themselves.
-- Matching stays a single direct lookup with no listing/browsing of other
-- delegates, same privacy posture as the email version it replaces.

create or replace function public.normalize_name(p text)
returns text language sql immutable as $$
  select btrim(lower(regexp_replace(
    regexp_replace(coalesce(p, ''), '[' || chr(8203) || chr(8288) || chr(65279) || ']', '', 'g'),
    '\s+', ' ', 'g'
  )))
$$;

drop function if exists public.kiosk_check_in(text, text);

create or replace function public.kiosk_check_in(
  p_token text,
  p_full_name text,
  p_email text default null,
  p_organization text default null,
  p_photo_consent boolean default null
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_event_id uuid := public.active_event_id();
  v_name_norm text := public.normalize_name(p_full_name);
  v_email text := nullif(lower(btrim(coalesce(p_email, ''))), '');
  v_org text := nullif(btrim(coalesce(p_organization, '')), '');
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

  select count(*) into v_match_count from public.delegates
    where event_id = v_event_id and public.normalize_name(full_name) = v_name_norm;

  -- Zero matches (not on the list) or more than one (ambiguous, same name
  -- twice) both go to a staff member rather than guessing.
  if v_match_count <> 1 then
    perform public.log_audit('check_in.kiosk_not_found', null, null, jsonb_build_object('name', left(coalesce(p_full_name, ''), 120), 'matches', v_match_count));
    return jsonb_build_object('result', 'not_found');
  end if;

  select * into d from public.delegates
    where event_id = v_event_id and public.normalize_name(full_name) = v_name_norm;

  update public.delegates
    set email = coalesce(v_email, email),
        organization = coalesce(v_org, organization),
        photo_consent = coalesce(p_photo_consent, photo_consent)
    where id = d.id
    returning * into d;

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
revoke all on function public.kiosk_check_in(text, text, text, text, boolean) from public;
grant execute on function public.kiosk_check_in(text, text, text, text, boolean) to anon, authenticated;
