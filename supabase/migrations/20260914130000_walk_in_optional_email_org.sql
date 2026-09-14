-- add_and_check_in still hard-required a valid email and an organization,
-- unlike import_delegates and update_delegate_details which were relaxed
-- earlier for events whose source data has no email column at all (e.g.
-- AAK Convention Diani 2026's tracker). That made walking in anyone from
-- such an event impossible at the desk - every attempt failed validation,
-- and (until the errorMessage() client-side fix) that failure was
-- completely invisible, showing only a generic "Connection problem"
-- message. Relax both fields to optional, and add the same
-- match-by-normalized-name fallback used elsewhere so a repeat walk-in of
-- the same no-email person is caught as a duplicate instead of creating a
-- second row.
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
    select * into d from public.delegates where id = v_match_id;
    return jsonb_build_object(
      'result', 'duplicate',
      'delegate', jsonb_build_object('id', d.id, 'full_name', d.full_name, 'organization', d.organization, 'email', d.email, 'badge_code', d.badge_code, 'status', d.status, 'source', d.source)
    );
  end if;

  insert into public.delegates (full_name, email, organization, phone, source, event_id)
  values (v_name, v_email, v_org, v_phone, 'walk_in', v_event_id)
  returning * into d;
  perform public.log_audit('delegate.walk_in_added', 'delegate', d.id, jsonb_build_object('device', p_device_label));

  return public.check_in_delegate(d.badge_token, 'walk_in', p_device_label, 'Walk-in');
end; $$;
