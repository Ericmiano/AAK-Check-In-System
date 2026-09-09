-- Self-check-in kiosk: a single printed QR posted at the desk, scanned by
-- delegates on their own phones on arrival. This is deliberately not "remote"
-- check-in: the token is only distributed physically at the venue, and
-- scanning it does nothing without also being at the desk. It exists to cut
-- staff out of the loop for delegates who are already in the system, not to
-- let anyone check in before they arrive.
alter type public.check_in_method add value if not exists 'kiosk';

create table public.kiosk_tokens (
  token text primary key default encode(gen_random_bytes(16), 'hex'),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid
);
-- No table grants and no policies: reachable only through the admin_* and
-- kiosk_check_in security definer functions below, never queried directly.
alter table public.kiosk_tokens enable row level security;
