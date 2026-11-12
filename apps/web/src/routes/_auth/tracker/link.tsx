import { useMutation } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Button } from "@te-rebrand/ui/components/button";
import { Input } from "@te-rebrand/ui/components/input";
import { Label } from "@te-rebrand/ui/components/label";
import { useState } from "react";
import { z } from "zod";

import { useTRPC } from "@/utils/trpc";

// The tracker app opens this page with ?code=XXXX-XXXX after "Link account".
export const Route = createFileRoute("/_auth/tracker/link")({
  validateSearch: z.object({ code: z.string().optional() }),
  component: LinkTracker,
});

function LinkTracker() {
  const trpc = useTRPC();
  const { code: initial } = Route.useSearch();
  const [code, setCode] = useState(initial ?? "");
  const approve = useMutation(trpc.tracker.approvePairing.mutationOptions());

  if (approve.isSuccess) {
    return (
      <main className="mx-auto w-full max-w-md space-y-2 px-5 pt-32 pb-16">
        <h1 className="text-3xl font-extrabold">Tracker linked</h1>
        <p className="text-sm text-muted-foreground">
          {approve.data.deviceName} is now logging your jobs. You can close this tab.
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-md px-5 pt-32 pb-16">
      <form
        className="space-y-5 rounded-[24px] border bg-card p-7 md:p-9"
        onSubmit={(e) => {
          e.preventDefault();
          approve.mutate({ userCode: code });
        }}
      >
        <h1 className="text-3xl font-extrabold">Link the tracker</h1>
        <p className="text-sm text-muted-foreground">
          Check that this code matches the one shown in the tracker app, then link it to your
          account.
        </p>
        <div className="space-y-2">
          <Label htmlFor="code">Code from the tracker</Label>
          <Input
            id="code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="ABCD-EFGH"
            autoComplete="off"
            className="h-11 font-mono text-lg tracking-widest"
            aria-invalid={approve.isError || undefined}
          />
          {approve.isError && (
            <p className="text-sm text-destructive" role="alert">
              {approve.error.message}
            </p>
          )}
        </div>
        <Button type="submit" className="h-12 w-full" disabled={approve.isPending || !code}>
          {approve.isPending ? "Linking…" : "Link tracker"}
        </Button>
      </form>
    </main>
  );
}
