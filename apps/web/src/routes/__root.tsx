import type { QueryClient } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { HeadContent, Outlet, Scripts, createRootRouteWithContext } from "@tanstack/react-router";
import { TanStackRouterDevtools } from "@tanstack/react-router-devtools";
import type { AppRouter } from "@te-rebrand/api/routers/index";
import { Toaster } from "@te-rebrand/ui/components/sonner";
import { MotionConfig } from "motion/react";
import type { TRPCOptionsProxy } from "@trpc/tanstack-react-query";

import Header from "../components/header";
import { THEME_SCRIPT, useTheme } from "../lib/theme";

import appCss from "../index.css?url";
export interface RouterAppContext {
  trpc: TRPCOptionsProxy<AppRouter>;
  queryClient: QueryClient;
}

export const Route = createRootRouteWithContext<RouterAppContext>()({
  head: () => ({
    meta: [
      {
        charSet: "utf-8",
      },
      {
        name: "viewport",
        content: "width=device-width, initial-scale=1",
      },
      {
        title: "Tacho · Job tracker and hub for ETS2 and ATS VTCs",
      },
      {
        name: "description",
        content:
          "A tray app that logs every Euro Truck Simulator 2 and American Truck Simulator delivery, plus leaderboards, Discord ranks, convoys and a live map for your VTC.",
      },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
      // The Tacho dial (same as TachoMark in components/landing/bits.tsx).
      { rel: "icon", href: "/favicon.svg", type: "image/svg+xml" },
      { rel: "icon", href: "/favicon-32.png", type: "image/png", sizes: "32x32" },
      { rel: "apple-touch-icon", href: "/apple-touch-icon.png" },
      { rel: "manifest", href: "/site.webmanifest" },
    ],
  }),

  component: RootDocument,
});

function RootDocument() {
  const { resolved } = useTheme();
  return (
    // The theme script sets class="dark" before React loads, so the server's
    // <html> attributes differ from the browser's on purpose.
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* oxlint-disable-next-line react/no-danger -- fixed string, no user input */}
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
        <HeadContent />
      </head>
      <body>
        {/* Visitors who ask for reduced motion get fades, not movement. */}
        <MotionConfig reducedMotion="user">
          <Header />
          <Outlet />
        </MotionConfig>
        <Toaster richColors theme={resolved ?? "system"} />
        <TanStackRouterDevtools position="bottom-left" />
        <ReactQueryDevtools position="bottom" buttonPosition="bottom-right" />
        <Scripts />
      </body>
    </html>
  );
}
