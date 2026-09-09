import type { ReactNode } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  ClipboardCheck,
  LayoutDashboard,
  LogOut,
  ShieldCheck,
  Upload,
  UserCircle,
  Users,
} from "lucide-react";
import aakLogo from "@/assets/aak-org-logo.png";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { clearStaffSessionCache, type StaffSession } from "@/lib/staff-session";

const navLinkClass =
  "inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground";
const navLinkActiveClass = "bg-accent text-accent-foreground";

export function StaffShell({ staff, children }: { staff: StaffSession; children: ReactNode }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  async function handleSignOut() {
    await supabase.auth.signOut();
    clearStaffSessionCache(queryClient);
    navigate({ to: "/staff/login" });
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-3">
            <img src={aakLogo} alt="AAK" className="h-8 w-auto" />
            <span className="eyebrow rounded-full border border-primary/30 bg-primary/10 px-2.5 py-1">
              Staff mode
            </span>
          </div>
          <nav className="flex flex-wrap items-center gap-1">
            <Link
              to="/staff/check-in"
              className={navLinkClass}
              activeProps={{ className: navLinkActiveClass }}
            >
              <ClipboardCheck className="size-4" aria-hidden="true" />
              Check-in
            </Link>
            <Link
              to="/staff/dashboard"
              className={navLinkClass}
              activeProps={{ className: navLinkActiveClass }}
            >
              <LayoutDashboard className="size-4" aria-hidden="true" />
              Dashboard
            </Link>
            {staff.isAdmin && (
              <>
                <Link
                  to="/admin/staff"
                  className={navLinkClass}
                  activeProps={{ className: navLinkActiveClass }}
                >
                  <Users className="size-4" aria-hidden="true" />
                  Staff
                </Link>
                <Link
                  to="/admin/import"
                  className={navLinkClass}
                  activeProps={{ className: navLinkActiveClass }}
                >
                  <Upload className="size-4" aria-hidden="true" />
                  Import
                </Link>
                <Link
                  to="/admin/audit"
                  className={navLinkClass}
                  activeProps={{ className: navLinkActiveClass }}
                >
                  <ShieldCheck className="size-4" aria-hidden="true" />
                  Audit
                </Link>
              </>
            )}
          </nav>
          <div className="flex items-center gap-3">
            <Link
              to="/staff/profile"
              className="hidden items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground sm:flex"
              activeProps={{ className: "text-foreground" }}
            >
              <UserCircle className="size-4" aria-hidden="true" />
              {staff.fullName}
            </Link>
            <Button variant="outline" size="sm" onClick={handleSignOut}>
              <LogOut className="size-4" aria-hidden="true" />
              Sign out
            </Button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
    </div>
  );
}
