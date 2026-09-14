-- Staff accounts sign in via a synthetic, non-deliverable internal email
-- (see staff-admin-fn.ts), so a real "email me a reset link" flow has
-- nowhere to deliver to. The realistic fix is admin-mediated: an admin sets
-- a new temporary password directly (via the Supabase Auth admin API,
-- service-role only, done in the deleteStaffAccount-style server function),
-- and this RPC just records that it happened, attributed to the acting
-- admin's own session for the audit trail.
create or replace function public.admin_log_password_reset(p_user_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_active_admin(auth.uid()) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  if not exists (select 1 from public.staff_profiles where user_id = p_user_id) then
    raise exception 'Staff account not found.' using errcode = '22023';
  end if;
  perform public.log_audit('staff.password_reset', 'staff', p_user_id, '{}'::jsonb);
end; $$;

revoke all on function public.admin_log_password_reset(uuid) from public, anon;
grant execute on function public.admin_log_password_reset(uuid) to authenticated;
