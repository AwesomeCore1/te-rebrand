import { createFileRoute } from "@tanstack/react-router";

import { authClient } from "@/lib/auth-client";
import { ClosingBand, SiteFooter } from "@/components/landing/closing";
import { Faq } from "@/components/landing/faq";
import { Features } from "@/components/landing/features";
import { Hero } from "@/components/landing/hero";
import { HowItWorks } from "@/components/landing/how-it-works";
import { RouteDrum } from "@/components/landing/route-drum";

export const Route = createFileRoute("/")({
  component: Landing,
});

function Landing() {
  const { data: session } = authClient.useSession();
  const loggedIn = Boolean(session);
  return (
    <main>
      <Hero loggedIn={loggedIn} />
      <RouteDrum />
      <HowItWorks />
      <Features />
      <Faq />
      <ClosingBand loggedIn={loggedIn} />
      <SiteFooter />
    </main>
  );
}
