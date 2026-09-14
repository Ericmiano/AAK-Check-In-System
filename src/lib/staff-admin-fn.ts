import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// Supabase Auth is email-based; staff sign in with a username instead, so
// each account gets a non-deliverable internal address purely for Auth's
// own bookkeeping. This domain is never emailed and never shown to anyone.
const INTERNAL_AUTH_DOMAIN = "staff.aak-checkin.internal";

const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9._-]{3,32}$/, "3-32 characters: letters, numbers, dots, underscores, or hyphens");

function toInternalEmail(username: string): string {
  return `${username}@${INTERNAL_AUTH_DOMAIN}`;
}

const bootstrapSchema = z.object({
  fullName: z.string().trim().min(2).max(120),
  username: usernameSchema,
  password: z.string().min(8).max(72),
});

/**
 * Public: creates the very first administrator. Only ever succeeds once.
 * claim_first_admin() takes an advisory lock and re-checks server-side, so a
 * race between two people submitting this form at once still yields exactly
 * one admin; the loser's freshly-created auth user is deleted again here.
 */
export const bootstrapFirstAdmin = createServerFn({ method: "POST" })
  .validator((data: unknown) => bootstrapSchema.parse(data))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const internalEmail = toInternalEmail(data.username);

    const { data: exists } = await supabaseAdmin.rpc("admin_exists");
    if (exists) {
      return { ok: false as const, error: "An administrator account already exists." };
    }

    const { data: created, error: createError } = await supabaseAdmin.auth.admin.createUser({
      email: internalEmail,
      password: data.password,
      email_confirm: true,
      user_metadata: { full_name: data.fullName, username: data.username },
    });
    if (createError || !created.user) {
      return { ok: false as const, error: createError?.message ?? "Could not create the account." };
    }

    const { data: claimed, error: claimError } = await supabaseAdmin.rpc("claim_first_admin", {
      p_user_id: created.user.id,
      p_full_name: data.fullName,
      p_username: data.username,
      p_email: internalEmail,
    });

    if (claimError || !claimed) {
      await supabaseAdmin.auth.admin.deleteUser(created.user.id);
      return {
        ok: false as const,
        error: claimError?.message ?? "An administrator account already exists.",
      };
    }

    return { ok: true as const };
  });

const provisionSchema = z.object({
  fullName: z.string().trim().min(2).max(120),
  username: usernameSchema,
  password: z.string().min(8).max(72),
  role: z.enum(["staff", "admin"]),
});

/**
 * Admin-only: invites a new staff or admin account. Creating a Supabase Auth
 * user requires the service role, so this step must run server-side; the
 * follow-up admin_provision_staff RPC runs as the *inviting admin's own*
 * session so staff_profiles/user_roles writes stay attributable and audited.
 */
export const provisionStaff = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => provisionSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { data: roleRows } = await context.supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId);
    const { data: profile } = await context.supabase
      .from("staff_profiles")
      .select("active")
      .eq("user_id", context.userId)
      .maybeSingle();
    const isAdmin = (roleRows ?? []).some((r) => r.role === "admin") && profile?.active !== false;
    if (!isAdmin) {
      return { ok: false as const, error: "Not authorized." };
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const internalEmail = toInternalEmail(data.username);

    const { data: created, error: createError } = await supabaseAdmin.auth.admin.createUser({
      email: internalEmail,
      password: data.password,
      email_confirm: true,
      user_metadata: { full_name: data.fullName, username: data.username },
    });
    if (createError || !created.user) {
      return { ok: false as const, error: createError?.message ?? "Could not create the account." };
    }

    const { error: provisionError } = await context.supabase.rpc("admin_provision_staff", {
      p_user_id: created.user.id,
      p_full_name: data.fullName,
      p_username: data.username,
      p_email: internalEmail,
      p_role: data.role,
    });

    if (provisionError) {
      await supabaseAdmin.auth.admin.deleteUser(created.user.id);
      return { ok: false as const, error: provisionError.message };
    }

    return { ok: true as const };
  });

const deleteStaffSchema = z.object({ userId: z.string().uuid() });

/**
 * Admin-only: removes a staff account. admin_delete_staff does the audited
 * DB-side removal (staff_profiles, user_roles) first, attributed to the
 * acting admin's own session — that alone already blocks sign-in, since
 * resolve_staff_login can no longer find them. Purging the underlying
 * Supabase Auth user needs the service role, so it happens here afterward;
 * if that step fails the account is still fully locked out, just left as a
 * harmless orphan in Supabase's own user list, so it doesn't roll back the
 * (already-succeeded) DB removal.
 */
export const deleteStaffAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => deleteStaffSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { data: roleRows } = await context.supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId);
    const { data: profile } = await context.supabase
      .from("staff_profiles")
      .select("active")
      .eq("user_id", context.userId)
      .maybeSingle();
    const isAdmin = (roleRows ?? []).some((r) => r.role === "admin") && profile?.active !== false;
    if (!isAdmin) {
      return { ok: false as const, error: "Not authorized." };
    }

    const { error: deleteError } = await context.supabase.rpc("admin_delete_staff", {
      p_user_id: data.userId,
    });
    if (deleteError) {
      return { ok: false as const, error: deleteError.message };
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.auth.admin.deleteUser(data.userId);

    return { ok: true as const };
  });

const resetPasswordSchema = z.object({
  userId: z.string().uuid(),
  password: z.string().min(8).max(72),
});

/**
 * Admin-only: sets a new password for a staff member who's locked out.
 * Staff accounts sign in via a synthetic internal email with nowhere real
 * to deliver a reset link, so this is the realistic "forgot password" path
 * here — an admin sets a fresh temporary password directly and hands it to
 * them the same way a new account's password is shared.
 */
export const resetStaffPassword = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => resetPasswordSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { data: roleRows } = await context.supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId);
    const { data: profile } = await context.supabase
      .from("staff_profiles")
      .select("active")
      .eq("user_id", context.userId)
      .maybeSingle();
    const isAdmin = (roleRows ?? []).some((r) => r.role === "admin") && profile?.active !== false;
    if (!isAdmin) {
      return { ok: false as const, error: "Not authorized." };
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(data.userId, {
      password: data.password,
    });
    if (updateError) {
      return { ok: false as const, error: updateError.message };
    }

    await context.supabase.rpc("admin_log_password_reset", { p_user_id: data.userId });

    return { ok: true as const };
  });
