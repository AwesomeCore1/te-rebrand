import { createFileRoute } from "@tanstack/react-router";
import { Button } from "@te-rebrand/ui/components/button";
import { useState } from "react";
import { toast } from "sonner";
import { z } from "zod";

import { DiscordIcon } from "@/components/landing/bits";
import { authClient } from "@/lib/auth-client";

export const Route = createFileRoute("/login")({
  validateSearch: z.object({ redirect: z.string().startsWith("/").optional() }),
  component: LoginPage,
});

function LoginPage() {
  const { redirect } = Route.useSearch();
  const [pending, setPending] = useState(false);

  async function signIn() {
    setPending(true);
    const { error } = await authClient.signIn.social({
      provider: "discord",
      callbackURL: redirect ?? "/dashboard",
    });
    if (error) {
      setPending(false);
      toast.error(error.message ?? "Could not reach Discord. Try again.");
    }
  }

  return (
    <main className="mx-auto flex min-h-svh w-full max-w-md flex-col justify-center gap-6 px-5 pt-28 pb-16">
      <div className="space-y-6 rounded-[24px] border bg-card p-7 md:p-9">
        <div className="space-y-2">
          <h1 className="text-3xl font-extrabold">Log in to Tacho</h1>
          <p className="text-[15px] leading-relaxed text-muted-foreground">
            Drivers log in with Discord. You can link Steam afterwards so your TruckersMP VTC can be
            checked.
          </p>
        </div>
        <Button
          className="h-12 w-full bg-discord text-white hover:bg-[#4752c4]"
          onClick={signIn}
          disabled={pending}
        >
          <DiscordIcon /> {pending ? "Opening Discord…" : "Log in with Discord"}
        </Button>
      </div>
    </main>
  );
}
