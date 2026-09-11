-- Staff: fill in a delegate's missing details (email, organization, phone,
-- photo consent) after the fact — e.g. a name-only import row gets its
-- email/institution/consent signature recorded once the person arrives and
-- fills in the paper sign-in sheet at the door. Scoped to the active event
-- so staff can't edit a stale record from a past event.
create or replace function public.update_delegate_details(
  p_delegate_id uuid,
  p_email text default null,
  p_organization text default null,
  p_phone text default null,
  p_photo_consent boolean default null
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_event_id uuid := public.active_event_id();
  v_email text := nullif(lower(btrim(coalesce(p_email, ''))), '');
  v_org text := nullif(btrim(coalesce(p_organization, '')), '');
  v_phone text := nullif(btrim(coalesce(p_phone, '')), '');
  d public.delegates%rowtype;
begin
  if not public.is_active_staff(auth.uid()) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  if v_email is not null and not public.valid_email(v_email) then
    raise exception 'Enter a valid email address.' using errcode = '22023';
  end if;

  select * into d from public.delegates where id = p_delegate_id and event_id = v_event_id;
  if not found then
    raise exception 'Delegate not found in the active event.' using errcode = '22023';
  end if;

  update public.delegates
    set email = coalesce(v_email, email),
        organization = coalesce(v_org, organization),
        phone = coalesce(v_phone, phone),
        photo_consent = coalesce(p_photo_consent, photo_consent)
    where id = p_delegate_id
    returning * into d;

  perform public.log_audit('delegate.details_updated', 'delegate', d.id, jsonb_build_object(
    'email_set', v_email is not null,
    'organization_set', v_org is not null,
    'phone_set', v_phone is not null,
    'photo_consent_set', p_photo_consent is not null
  ));

  return jsonb_build_object(
    'id', d.id, 'full_name', d.full_name, 'email', d.email, 'organization', d.organization,
    'phone', d.phone, 'photo_consent', d.photo_consent, 'status', d.status
  );
end; $$;

revoke all on function public.update_delegate_details(uuid, text, text, text, boolean) from public, anon;
grant execute on function public.update_delegate_details(uuid, text, text, text, boolean) to authenticated;
