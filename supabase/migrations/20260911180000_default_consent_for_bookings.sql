-- Everyone who came through the ticketing/payment portal already agreed to
-- photo consent as part of that checkout flow, even though the booking
-- export itself has no explicit consent column. Default their record to
-- "yes" now rather than showing it as missing at check-in. Scoped to the
-- specific import batch from that bookings file, so the handful of people
-- added only from the paper sign-in sheet (who never went through the
-- portal) correctly stay unrecorded until they actually sign in person.
update public.delegates
set photo_consent = true
where import_batch_id = '134ad06a-94bb-415c-b3ba-1ccded6570d4'
  and photo_consent is null;
