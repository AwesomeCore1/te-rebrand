import { createFileRoute } from "@tanstack/react-router";
import { appRouter } from "@te-rebrand/api/routers/index";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";

import { createContext } from "../../../context";

function handler({ request }: { request: Request }) {
  return fetchRequestHandler({
    req: request,
    router: appRouter,
    createContext,
    endpoint: "/api/trpc",
  });
}

export const Route = createFileRoute("/api/trpc/$")({
  server: {
    handlers: {
      GET: handler,
      POST: handler,
    },
  },
});
