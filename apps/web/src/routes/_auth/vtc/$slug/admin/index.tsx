import { createFileRoute, redirect } from "@tanstack/react-router";

// /vtc/<slug>/admin opens on the first tab.
export const Route = createFileRoute("/_auth/vtc/$slug/admin/")({
  beforeLoad: ({ params }) => {
    throw redirect({ to: "/vtc/$slug/admin/members", params, replace: true });
  },
});
