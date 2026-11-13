import { createFileRoute, Link } from "@tanstack/react-router";
import { buttonVariants } from "@te-rebrand/ui/components/button";
import { cn } from "@te-rebrand/ui/lib/utils";
import { Download, Monitor, ShieldAlert } from "lucide-react";
import type { ReactNode } from "react";

import { getTrackerDownload } from "@/functions/get-tracker-download";
import { authClient } from "@/lib/auth-client";

// Where a driver gets the tracker. The installer's address is configuration
// (TRACKER_DOWNLOAD_URL): until there is a release, the page says so instead
// of offering a link. Either way it says what happens after installing.
export const Route = createFileRoute("/download")({
  loader: () => getTrackerDownload(),
  head: () => ({ meta: [{ title: "Download the tracker · Tacho" }] }),
  component: DownloadPage,
});

const link = "rounded-sm font-medium text-signal-ink underline-offset-2 hover:underline";

function DownloadPage() {
  const { windowsUrl } = Route.useLoaderData();
  const { data: session, isPending } = authClient.useSession();

  const steps: { title: string; body: ReactNode }[] = [
    {
      title: "Link the tracker",
      body: (
        <>
          Open the tracker and choose Link account. It opens Tacho with a code; check that it
          matches the one in the tracker and confirm. If the page didn't open,{" "}
          <Link to="/tracker/link" className={link}>
            enter the code here
          </Link>
          .
        </>
      ),
    },
    {
      title: "Install the game plugin",
      body: "The tracker finds Euro Truck Simulator 2 and American Truck Simulator through Steam and shows a setup card. One click installs the telemetry plugin into each game. The next time a game starts it asks once to allow SDK features: accept.",
    },
    {
      title: "Drive",
      body: "Finish a delivery in either game, on TruckersMP or in singleplayer. The tracker sits in the tray and sends each finished job to Tacho; it shows on your dashboard.",
    },
  ];

  return (
    <main className="mx-auto w-full max-w-3xl space-y-6 px-5 pt-28 pb-16 md:px-8">
      <header>
        <h1 className="text-[clamp(2rem,4vw,2.75rem)] leading-none font-extrabold">
          Download the tracker
        </h1>
        <p className="mt-3 max-w-xl text-[15px] leading-relaxed text-muted-foreground">
          A small Windows app that runs in the tray while you play and logs every delivery in ETS2
          and ATS. Install it once.
        </p>
      </header>

      <section className="overflow-hidden rounded-2xl border bg-card" aria-labelledby="get-it">
        <div className="space-y-4 p-5">
          {windowsUrl ? (
            <>
              <h2 id="get-it" className="text-xl font-bold tracking-tight">
                Tacho tracker for Windows
              </h2>
              {/* A plain link: the installer is a file on another host. */}
              <a
                href={windowsUrl}
                rel="noopener noreferrer"
                className={cn(buttonVariants({ size: "lg" }), "h-11 px-5 text-[15px]")}
              >
                <Download aria-hidden="true" /> Download for Windows
              </a>
            </>
          ) : (
            <>
              <h2 id="get-it" className="text-xl font-bold tracking-tight">
                The tracker isn't released yet
              </h2>
              <p className="max-w-xl text-[15px] leading-relaxed text-muted-foreground">
                There is no installer to download yet. When the first release is out, the download
                is on this page.
              </p>
            </>
          )}
        </div>
        <ul className="divide-y border-t text-[14px] leading-relaxed">
          <Note icon={<Monitor className="size-4" aria-hidden="true" />}>
            <span className="font-semibold">Windows only for now.</span>{" "}
            <span className="text-muted-foreground">
              The tracker reads the game's telemetry on Windows. There is no macOS or Linux version
              yet.
            </span>
          </Note>
          <Note icon={<ShieldAlert className="size-4" aria-hidden="true" />}>
            <span className="font-semibold">Windows may warn about the installer.</span>{" "}
            <span className="text-muted-foreground">
              During the beta the installer is not code-signed, so Windows can show "Windows
              protected your PC" before it runs. Choose More info, then Run anyway.
            </span>
          </Note>
        </ul>
      </section>

      <section className="overflow-hidden rounded-2xl border bg-card" aria-labelledby="after">
        <h2 id="after" className="border-b px-5 py-3.5 text-[17px] font-bold tracking-tight">
          After installing
        </h2>
        <ol className="divide-y">
          {steps.map((step, i) => (
            <li key={step.title} className="flex gap-3.5 px-5 py-4">
              <span
                className="tabular mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-secondary text-[13px] font-bold"
                aria-hidden="true"
              >
                {i + 1}
              </span>
              <div className="min-w-0">
                <h3 className="font-sans text-[15px] font-semibold tracking-normal">
                  {step.title}
                </h3>
                <p className="mt-0.5 max-w-xl text-[14px] leading-relaxed text-muted-foreground">
                  {step.body}
                </p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      {/* Linking needs an account. Empty until the session is known, so the server and browser agree. */}
      <p className="min-h-5 text-[14px] leading-relaxed text-muted-foreground">
        {isPending ? null : session ? (
          <>
            Linked trackers are listed on your{" "}
            <Link to="/dashboard" className={link}>
              dashboard
            </Link>
            , where you can unlink one.
          </>
        ) : (
          <>
            Linking needs a Tacho account.{" "}
            <Link to="/login" search={{ redirect: "/download" }} className={link}>
              Log in with Discord
            </Link>{" "}
            first.
          </>
        )}
      </p>
    </main>
  );
}

function Note({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <li className="flex gap-3 px-5 py-3.5">
      <span className="mt-0.5 shrink-0 text-muted-foreground">{icon}</span>
      <p className="min-w-0 max-w-xl">{children}</p>
    </li>
  );
}
