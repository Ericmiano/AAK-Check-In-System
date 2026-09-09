-- Staff: update your own display name. staff_profiles carries no UPDATE grant
-- for `authenticated` at all (see admin_update_staff), so self-service edits
-- need their own narrow security definer path, scoped to auth.uid() only.
create or replace function public.update_own_full_name(p_full_name text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_name text := btrim(coalesce(p_full_name, ''));
  p public.staff_profiles%rowtype;
begin
  if not public.is_active_staff(auth.uid()) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  if length(v_name) < 2 or length(v_name) > 120 then
    raise exception 'Enter a valid name.' using errcode = '22023';
  end if;

  update public.staff_profiles set full_name = v_name where user_id = auth.uid()
  returning * into p;

  perform public.log_audit('staff.self_updated_name', 'staff', auth.uid(), jsonb_build_object('full_name', v_name));
  return jsonb_build_object('user_id', p.user_id, 'full_name', p.full_name);
end; $$;
revoke all on function public.update_own_full_name(text) from public;
grant execute on function public.update_own_full_name(text) to authenticated;
