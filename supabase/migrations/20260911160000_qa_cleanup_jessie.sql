-- Undo the test check-in performed on the real "Jessie Vue" delegate while
-- smoke-testing the redesigned name-based kiosk against the live AAK
-- Biennale Orchestra 2026 event. She wasn't actually at the venue.
delete from public.check_ins
where delegate_id = (
  select id from public.delegates
  where full_name = 'Jessie Vue'
    and event_id = 'b06f6b57-939a-4b6a-9519-7f2ff20bbb19'
);

update public.delegates
set status = 'expected', email = null, organization = null, photo_consent = null
where full_name = 'Jessie Vue'
  and event_id = 'b06f6b57-939a-4b6a-9519-7f2ff20bbb19';
