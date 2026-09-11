-- The Nairobi Biennale African Orchestra sign-in sheet lists only names
-- ahead of time; email, institution, and a photo-consent signature are
-- collected on paper at the door and only sometimes known in advance.
-- organization/email were both `not null`, which made this event's roster
-- impossible to import as-is. Relax both to optional and add photo_consent
-- so the digital record can carry the same fields as the paper form.
alter table public.delegates alter column organization drop not null;
alter table public.delegates alter column email drop not null;
alter table public.delegates add column photo_consent boolean;

-- Admin: CSV import, now tolerant of blank email/organization and carrying
-- an optional photo_consent column. Rows with no email are matched for
-- update by (event_id, full_name) instead, since email is the only other
-- unique key and this event's sheet doesn't have one.
create or replace function public.import_delegates(p_rows jsonb, p_filename text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_event_id uuid := public.active_event_id();
  b public.import_batches%rowtype;
  r jsonb;
  idx int := 0;
  v_name text; v_email text; v_org text; v_phone text; v_consent_raw text; v_consent boolean;
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
    v_email := nullif(lower(btrim(coalesce(r ->> 'email', ''))), '');
    v_org := nullif(btrim(coalesce(r ->> 'organization', '')), '');
    v_phone := nullif(btrim(coalesce(r ->> 'phone', '')), '');
    v_consent_raw := lower(btrim(coalesce(r ->> 'photo_consent', '')));
    v_consent := case
      when v_consent_raw in ('y', 'yes', 'true', '1') then true
      when v_consent_raw in ('n', 'no', 'false', '0') then false
      else null
    end;

    if length(v_name) < 2 or length(v_name) > 120 then
      v_skipped := v_skipped + 1;
      v_errors := v_errors || jsonb_build_object('row', idx, 'email', coalesce(v_email, ''), 'reason', 'Missing or invalid full name');
      continue;
    end if;
    if v_email is not null and not public.valid_email(v_email) then
      v_skipped := v_skipped + 1;
      v_errors := v_errors || jsonb_build_object('row', idx, 'email', v_email, 'reason', 'Invalid email');
      continue;
    end if;

    if v_email is not null then
      select exists(select 1 from public.delegates where email = v_email and event_id = v_event_id) into v_exists;
    else
      select exists(select 1 from public.delegates where email is null and lower(full_name) = lower(v_name) and event_id = v_event_id) into v_exists;
    end if;

    if v_exists then
      update public.delegates
        set full_name = v_name,
            organization = coalesce(v_org, organization),
            phone = coalesce(v_phone, phone),
            photo_consent = coalesce(v_consent, photo_consent),
            import_batch_id = b.id
        where event_id = v_event_id
          and (
            (v_email is not null and email = v_email)
            or (v_email is null and email is null and lower(full_name) = lower(v_name))
          );
      v_updated := v_updated + 1;
    else
      insert into public.delegates (full_name, email, organization, phone, photo_consent, source, import_batch_id, event_id)
      values (v_name, v_email, v_org, v_phone, v_consent, 'import', b.id, v_event_id);
      v_inserted := v_inserted + 1;
    end if;
  end loop;

  update public.import_batches
    set inserted = v_inserted, updated = v_updated, skipped = v_skipped, errors = v_errors
    where id = b.id;

  perform public.log_audit('import.completed', 'import_batch', b.id, jsonb_build_object('filename', b.filename, 'total', b.total_rows, 'inserted', v_inserted, 'updated', v_updated, 'skipped', v_skipped, 'event_id', v_event_id));

  return jsonb_build_object('batch_id', b.id, 'total', b.total_rows, 'inserted', v_inserted, 'updated', v_updated, 'skipped', v_skipped, 'errors', v_errors);
end; $$;
