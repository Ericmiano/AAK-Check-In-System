import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { useOrganizations } from "@/lib/delegates-data";

/**
 * A plain text field that also suggests organizations already on the
 * roster as you type, so staff can pick an existing one instead of
 * retyping (and accidentally misspelling) it — while still allowing a
 * genuinely new organization to be typed freely, since the roster's
 * long tail of one-off attendee organizations can't be a closed list.
 */
export function OrganizationCombobox({
  id,
  value,
  onChange,
  placeholder,
}: {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  const organizations = useOrganizations();
  const [open, setOpen] = useState(false);

  const suggestions = useMemo(() => {
    const q = value.trim().toLowerCase();
    const matches = q
      ? organizations.filter((o) => o.toLowerCase().includes(q) && o.toLowerCase() !== q)
      : organizations;
    return matches.slice(0, 20);
  }, [value, organizations]);

  return (
    <Popover open={open && suggestions.length > 0}>
      <PopoverAnchor asChild>
        <Input
          id={id}
          value={value}
          placeholder={placeholder}
          autoComplete="off"
          onChange={(e) => {
            onChange(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
        />
      </PopoverAnchor>
      <PopoverContent
        align="start"
        className="w-(--radix-popover-trigger-width) p-1"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <div className="max-h-56 overflow-y-auto">
          {suggestions.map((org) => (
            <button
              key={org}
              type="button"
              className="block w-full rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground"
              // Fires before the input's blur, so the click registers
              // instead of the popover closing out from under it first.
              onMouseDown={(e) => {
                e.preventDefault();
                onChange(org);
                setOpen(false);
              }}
            >
              {org}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
