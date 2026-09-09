import { redirect } from "@tanstack/react-router";
import type { QueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Session } from "@supabase/supabase-js";

const STAFF_SESSION_KEY = ["staff-session"] as const;

export type StaffSession = {
  session: Session;
  userId: string;
  fullName: string;
  email: string;
  isStaff: boolean;
  isAdmin: boolean;
};

export type StaffSessionResult =
  { status: "ok"; staff: StaffSession } | { status: "unauthenticated" } | { status: "forbidden" };

/**
 * Resolves the current staff session directly from Supabase (session + own
 * staff_profiles/user_roles rows, both readable under RLS by the signed-in
 * user). Used by route guards and by the header, so "staff" and "admin"
 * always mean the same thing everywhere in the app.
 */
export async function resolveStaffSession(): Promise<StaffSessionResult> {
  const { data: sessionData } = await supabase.auth.getSession();
  const session = sessionData.session;
  if (!session) return { status: "unauthenticated" };

  const [{ data: profile, error: profileError }, { data: roles, error: rolesError }] =
    await Promise.all([
      supabase
        .from("staff_profiles")
        .select("full_name, email, active")
        .eq("user_id", session.user.id)
        .maybeSingle(),
      supabase.from("user_roles").select("role").eq("user_id", session.user.id),
    ]);

  if (profileError || rolesError) return { status: "unauthenticated" };
  if (!profile || profile.active === false) return { status: "forbidden" };

  const roleSet = new Set((roles ?? []).map((r) => r.role));
  const isAdmin = roleSet.has("admin");
  const isStaff = isAdmin || roleSet.has("staff");
  if (!isStaff) return { status: "forbidden" };

  return {
    status: "ok",
    staff: {
      session,
      userId: session.user.id,
      fullName: profile.full_name,
      email: profile.email,
      isStaff,
      isAdmin,
    },
  };
}

function redirectToLogin(pathname: string, reason: "signin" | "forbidden"): never {
  throw redirect({ to: "/staff/login", search: { redirect: pathname, reason } });
}

/**
 * Every protected route's beforeLoad calls requireStaff/requireAdmin, and
 * without caching that meant two fresh database round trips before any page
 * could render, on every single navigation between staff pages. Routing it
 * through the router's own queryClient means only the first navigation pays
 * that cost; the rest reuse it until it goes stale or is explicitly cleared
 * on sign-in/out.
 */
async function getStaffSession(queryClient: QueryClient): Promise<StaffSessionResult> {
  return queryClient.fetchQuery({
    queryKey: STAFF_SESSION_KEY,
    queryFn: resolveStaffSession,
    staleTime: 60_000,
  });
}

/** Call after sign-in or sign-out so the next guard check reflects reality. */
export function clearStaffSessionCache(queryClient: QueryClient) {
  queryClient.removeQueries({ queryKey: STAFF_SESSION_KEY });
}

/** Route beforeLoad guard: staff or admin may pass. */
export async function requireStaff(
  pathname: string,
  queryClient: QueryClient,
): Promise<StaffSession> {
  const result = await getStaffSession(queryClient);
  if (result.status === "unauthenticated") redirectToLogin(pathname, "signin");
  if (result.status === "forbidden") redirectToLogin(pathname, "forbidden");
  return result.staff;
}

/** Route beforeLoad guard: admin only. */
export async function requireAdmin(
  pathname: string,
  queryClient: QueryClient,
): Promise<StaffSession> {
  const staff = await requireStaff(pathname, queryClient);
  if (!staff.isAdmin) redirectToLogin(pathname, "forbidden");
  return staff;
}
