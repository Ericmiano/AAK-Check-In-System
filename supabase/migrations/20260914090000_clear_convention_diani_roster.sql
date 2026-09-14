-- The AAK Convention Diani 2026 roster was imported before the CSV
-- header-matching fix, so it only captured names — Firm/Organization was
-- silently dropped for all 110 rows. Clear it out (no check-ins had
-- happened yet, source was 100% import) so it can be re-imported correctly
-- with organization data intact.
delete from public.check_ins
where delegate_id in (select id from public.delegates where event_id = '5ebbbdb6-023d-4c6f-8d92-66f2e2931683');

delete from public.delegates where event_id = '5ebbbdb6-023d-4c6f-8d92-66f2e2931683';
