import { createFileRoute, redirect } from "@tanstack/react-router";

// Check-in is desk-only now: there is no public delegate-facing entry point,
// so "/" hands off to staff sign-in, the only real front door.
export const Route = createFileRoute("/")({
  beforeLoad: () => {
    throw redirect({ to: "/staff/login" });
  },
});
