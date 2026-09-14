-- Remove the throwaway "QA Nonadmin Event" created while verifying that
-- event switching works for non-admin staff on the dashboard.
delete from public.events where id = '6e0d0172-fd77-4bd3-b2e1-c5cdf0e7d40b';
