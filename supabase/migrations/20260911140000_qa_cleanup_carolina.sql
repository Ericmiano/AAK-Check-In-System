-- Clear the fake email/organization/photo_consent set on the real
-- "Carolina Viana" delegate row while smoke-testing the new edit-delegate
-- feature against the live AAK Biennale Orchestra 2026 event.
update public.delegates
set email = null, organization = null, photo_consent = null
where id = (
  select id from public.delegates
  where full_name = 'Carolina Viana'
    and event_id = 'b06f6b57-939a-4b6a-9519-7f2ff20bbb19'
);
