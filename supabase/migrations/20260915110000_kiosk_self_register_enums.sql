-- New delegate states for kiosk self-registration: someone the kiosk
-- couldn't match (a genuine walk-in, or a real registrant whose name just
-- didn't match) can register themselves right there instead of being sent
-- to a staff member — but they land as 'pending', not 'checked_in'. A
-- staff member still has to confirm them face-to-face to hand over an
-- actual badge, which is also the point where a paid event's staff can
-- ask to see proof of payment before finalizing. Kept as its own
-- migration: Postgres won't let a new enum value be referenced by other
-- statements in the same transaction it was added in.
alter type public.delegate_status add value 'pending';
alter type public.delegate_source add value 'kiosk';
