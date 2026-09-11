-- The per-ticket export only listed one of the two tickets under booking
-- B12868 (as "Winstone Odhiambo"), which incorrectly overwrote the actual
-- booker "Ruth Serem" 's name during the tickets-file merge. Restore her
-- identity and details to match the original booking record.
update public.delegates
set full_name = 'Ruth Serem',
    email = 'ruth.serem.o@gmail.com',
    phone = '254722908779',
    organization = 'Kenya Wildlife Service'
where email = 'ruth.serem.o@gmail.com'
  and event_id = 'b06f6b57-939a-4b6a-9519-7f2ff20bbb19';
