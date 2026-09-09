-- Product decision: check-in is fully staff-mediated. Self-check-in by email
-- (the kiosk) had no identity verification, and printed-badge scanning is no
-- longer part of the workflow either. Drop both capabilities outright rather
-- than just unlinking their pages, consistent with how the earlier public
-- badge self-service was retired.
drop function if exists public.kiosk_check_in(text, text);
drop function if exists public.admin_create_kiosk_token();
drop function if exists public.admin_get_active_kiosk_token();
drop table if exists public.kiosk_tokens;

drop function if exists public.admin_get_delegate_badge(uuid);
