-- Bugfix: has_role / is_active_staff / is_active_admin are referenced inside
-- RLS policy expressions on staff_profiles, user_roles, delegates, check_ins,
-- import_batches, and audit_events. Unlike a function called from inside
-- another SECURITY DEFINER function's body, a policy expression is evaluated
-- under the querying role's own privileges, so revoking EXECUTE from
-- `authenticated` (done in the second migration, on the mistaken assumption
-- that policies always run as the table owner) makes every one of those
-- policies throw "permission denied" instead of merely evaluating false, even
-- when a different, satisfiable policy exists on the same table. That broke
-- every direct table read in the app (delegate roster, audit trail, staff
-- list, and the login guard's own staff_profiles/user_roles check), while
-- RPC calls kept working because their SECURITY DEFINER bodies call these
-- helpers as their owner, not as the caller.
--
-- These functions only ever return a boolean for a given user id, so letting
-- `authenticated` call them directly carries no meaningful new exposure.
grant execute on function public.has_role(uuid, public.app_role) to authenticated;
grant execute on function public.is_active_staff(uuid) to authenticated;
grant execute on function public.is_active_admin(uuid) to authenticated;
