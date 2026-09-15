-- Public kiosk: register yourself when the kiosk couldn't find a match —
-- either a genuine walk-in who was never on any list, or a real
-- registrant whose typed name just didn't match. Lands as 'pending', not
-- 'checked_in': a staff member still confirms in person and hands over
-- the actual badge, which is also where a paid event's staff can ask to
-- see proof of payment before finalizing anything. Re-checks for a match
-- first (by normalized name, same as kiosk_check_in) so retrying after
-- registering — or two people racing the same submission — doesn't create
-- a duplicate delegate.
create or replace function public.kiosk_self_register(
  p_token text,
  p_full_name text,
  p_email text default null,
  p_organization text default null,
  p_photo_consent boolean default null
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_event_id uuid := public.active_event_id();
  v_name text := btrim(coalesce(p_full_name, ''));
  v_name_norm text := public.normalize_name(p_full_name);
  v_email text := nullif(lower(btrim(coalesce(p_email, ''))), '');
  v_org text := nullif(btrim(coalesce(p_organization, '')), '');
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
  if v_email is not null and not public.valid_email(v_email) then
    raise exception 'Enter a valid email address.' using errcode = '22023';
  end if;

  select count(*) into v_match_count from public.delegates
    where event_id = v_event_id and public.normalize_name(full_name) = v_name_norm;
  if v_match_count > 0 then
    raise exception 'That name is already on the list — please try checking in again, or see a staff member.' using errcode = '22023';
  end if;

  insert into public.delegates (full_name, email, organization, photo_consent, source, status, event_id)
  values (v_name, v_email, v_org, p_photo_consent, 'kiosk', 'pending', v_event_id)
  returning * into d;

  perform public.log_audit('delegate.kiosk_self_registered', 'delegate', d.id, jsonb_build_object('full_name', d.full_name));

  return jsonb_build_object('result', 'registered', 'full_name', d.full_name);
end; $$;

revoke all on function public.kiosk_self_register(text, text, text, text, boolean) from public;
grant execute on function public.kiosk_self_register(text, text, text, text, boolean) to anon, authenticated;
