-- Restores the self-check-in kiosk (dropped in 20260909180000, reinstated on
-- request): a single printed QR posted at the desk, scanned by delegates on
-- their own phones on arrival. Not "remote" check-in: the token is only ever
-- distributed physically at the venue, and scanning it does nothing without
-- also being there. It exists purely to cut staff out of the loop for
-- delegates already in the system, easing staff workload during arrivals.
-- The check_in_method enum already has 'kiosk' from the original rollout, so
-- there is nothing to add there.

create table public.kiosk_tokens (
  token text primary key default encode(gen_random_bytes(16), 'hex'),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid
);
-- No table grants and no policies: reachable only through the admin_* and
-- kiosk_check_in security definer functions below, never queried directly.
alter table public.kiosk_tokens enable row level security;

-- Admin: mint a new kiosk token, retiring any previous one. There is only
-- ever one active token at a time, matching "a single printed QR code".
create or replace function public.admin_create_kiosk_token()
returns text language plpgsql security definer set search_path = public as $$
declare
  v_token text;
begin
  if not public.is_active_admin(auth.uid()) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  update public.kiosk_tokens set active = false where active;
  insert into public.kiosk_tokens (created_by) values (auth.uid()) returning token into v_token;
  perform public.log_audit('kiosk.token_created', 'kiosk_token', null, '{}'::jsonb);
  return v_token;
end; $$;
revoke all on function public.admin_create_kiosk_token() from public;
grant execute on function public.admin_create_kiosk_token() to authenticated;

-- Admin: fetch the current active token (to re-print the same code without
-- minting a new one and invalidating badges already printed with it).
create or replace function public.admin_get_active_kiosk_token()
returns text language sql stable security definer set search_path = public as $$
  select case when public.is_active_admin(auth.uid())
    then (select token from public.kiosk_tokens where active order by created_at desc limit 1)
    else null end
$$;
revoke all on function public.admin_get_active_kiosk_token() from public;
grant execute on function public.admin_get_active_kiosk_token() to authenticated;

-- Public: self-check-in from the printed kiosk QR only. Exact email match
-- only, same privacy posture as the retired public_find_badge: this never
-- lists or browses delegates, it only ever confirms the one record whose
-- email was typed, and only while a matching token is active.
create or replace function public.kiosk_check_in(p_token text, p_email text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  d public.delegates%rowtype;
  c public.check_ins%rowtype;
  v_inserted boolean := false;
begin
  if not exists (select 1 from public.kiosk_tokens where token = btrim(coalesce(p_token, '')) and active) then
    raise exception 'This check-in code is no longer active. Please see a staff member.' using errcode = '42501';
  end if;
  if not public.valid_email(v_email) then
    return jsonb_build_object('result', 'not_found');
  end if;

  select * into d from public.delegates where email = v_email;
  if not found then
    perform public.log_audit('check_in.kiosk_not_found', null, null, jsonb_build_object('email', v_email));
    return jsonb_build_object('result', 'not_found');
  end if;

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
revoke all on function public.kiosk_check_in(text, text) from public;
grant execute on function public.kiosk_check_in(text, text) to anon, authenticated;
