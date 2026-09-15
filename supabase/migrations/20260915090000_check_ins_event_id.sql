-- check_ins had no event_id of its own, which forced every realtime
-- subscription that cares about check-ins to listen to the whole table
-- rather than the active event specifically — a check-in in one event
-- triggers a refetch for every desk watching any event, and multi-event
-- realtime scoping (e.g. dashboards/kiosks) has no way to filter at the
-- subscription level at all. Backfill event_id from each row's existing
-- delegate (every check_ins row already has exactly one, via the unique
-- delegate_id FK), then require it on all future rows.
alter table public.check_ins add column event_id uuid references public.events(id);

update public.check_ins ci
set event_id = d.event_id
from public.delegates d
where d.id = ci.delegate_id;

alter table public.check_ins alter column event_id set not null;
create index check_ins_event_id_idx on public.check_ins (event_id);

-- Staff check-in: stamp the new column with the same active-event id
-- already used to scope the lookup.
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

  insert into public.check_ins (delegate_id, event_id, checked_in_by, method, device_label, notes)
  values (d.id, v_event_id, auth.uid(), p_method, left(p_device_label, 160), left(p_notes, 500))
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

-- Public kiosk: same, stamp event_id on the self-check-in insert.
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
