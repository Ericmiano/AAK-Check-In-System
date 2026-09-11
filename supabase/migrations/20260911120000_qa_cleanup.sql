-- Remove the throwaway "Orchestra QA Test" event and its delegates/check-ins/
-- import batch, created only to verify the optional-fields import path
-- against a real name-only sign-in sheet before using it on the live
-- "AAK Biennale Orchestra 2026" event.
delete from public.check_ins
where delegate_id in (select id from public.delegates where event_id = '0a54b263-4bf4-4d88-a91a-77ab70c1f220');

delete from public.import_batches
where id in (select import_batch_id from public.delegates where event_id = '0a54b263-4bf4-4d88-a91a-77ab70c1f220' and import_batch_id is not null);

delete from public.delegates where event_id = '0a54b263-4bf4-4d88-a91a-77ab70c1f220';

delete from public.events where id = '0a54b263-4bf4-4d88-a91a-77ab70c1f220';
