-- One-time bulk action: everyone who already has their tag also gets their
-- gift bag marked received, using the tag's own timestamp/attribution
-- (coalesce keeps this a no-op for anyone whose gift bag is already marked
-- with its own real value, and it never touches delegates without a tag).
update public.delegates
set gift_bag_issued_at = coalesce(gift_bag_issued_at, tag_issued_at),
    gift_bag_issued_by = coalesce(gift_bag_issued_by, tag_issued_by)
where event_id = public.active_event_id()
  and tag_issued_at is not null
  and gift_bag_issued_at is null;
