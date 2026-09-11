-- Set photo consent to "yes" for every delegate in the active orchestra
-- event, including the handful added from the paper sign-in sheet whose
-- consent was previously left unrecorded.
update public.delegates
set photo_consent = true
where event_id = (select id from public.events where active limit 1);
