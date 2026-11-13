// What the Discord bot last found for a company, on the settings tab: whether
// it may act in the server that is set, and the last thing that went wrong.
// So a manager can see why nothing is being posted. Read-only: the bot writes
// it (apps/bot), the page only shows it.
import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "@te-rebrand/ui/components/skeleton";
import { CircleAlert, CircleCheck, Clock } from "lucide-react";
import type { ReactNode } from "react";

import { useTRPC } from "@/utils/trpc";

const whenFmt = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});
const when = (date: Date | string) => whenFmt.format(new Date(date));

export function BotStatus({ companyId }: { companyId: string }) {
  const trpc = useTRPC();
  const status = useQuery(trpc.admin.settings.botStatus.queryOptions({ companyId }));

  return (
    <div className="space-y-3 border-t pt-5" aria-live="polite">
      <h4 className="font-sans text-[14px] font-semibold tracking-normal">Bot status</h4>
      {status.isError ? (
        <p className="text-[14px] text-muted-foreground">
          Couldn't load what the bot last reported. Reload the page.
        </p>
      ) : !status.data ? (
        <div className="space-y-2" aria-busy="true">
          <Skeleton className="h-4 w-72 max-w-full" />
          <Skeleton className="h-4 w-56 max-w-full" />
        </div>
      ) : (
        <ul className="space-y-3 text-[14px] leading-relaxed">
          <ServerLine status={status.data} />
          {status.data.lastProblem && (
            <Line
              icon={<CircleAlert className="size-4 text-destructive" aria-hidden="true" />}
              title="Last problem"
              detail={`Recorded ${when(status.data.lastProblem.at)}. It stays here until another one replaces it.`}
            >
              {status.data.lastProblem.text}
            </Line>
          )}
        </ul>
      )}
    </div>
  );
}

type Status = {
  guildId: string | null;
  server: { ok: boolean; reason: string | null; checkedAt: Date | string } | null;
};

function ServerLine({ status }: { status: Status }) {
  if (!status.guildId) {
    return (
      <Line
        icon={<Clock className="size-4 text-muted-foreground" aria-hidden="true" />}
        title="No server set"
      >
        The bot posts nothing and changes no roles until a server ID is saved above.
      </Line>
    );
  }
  if (!status.server) {
    return (
      <Line
        icon={<Clock className="size-4 text-muted-foreground" aria-hidden="true" />}
        title="Not checked yet"
      >
        The bot has not looked at this server yet. It checks the first time it has something to post
        or a role to change there.
      </Line>
    );
  }
  if (!status.server.ok) {
    return (
      <Line
        icon={<CircleAlert className="size-4 text-destructive" aria-hidden="true" />}
        title="The bot can't act in this server"
        detail={`Checked ${when(status.server.checkedAt)}. It checks again the next time it has something to post.`}
      >
        {status.server.reason ?? "The bot did not say why."}
      </Line>
    );
  }
  return (
    <Line
      icon={<CircleCheck className="size-4 text-success" aria-hidden="true" />}
      title="The bot can act in this server"
      detail={`Checked ${when(status.server.checkedAt)}.`}
    >
      An owner or manager of the company has Manage Server there.
    </Line>
  );
}

function Line({
  icon,
  title,
  detail,
  children,
}: {
  icon: ReactNode;
  title: string;
  detail?: string;
  children: ReactNode;
}) {
  return (
    <li className="flex gap-2.5">
      <span className="mt-[3px] shrink-0">{icon}</span>
      <div className="min-w-0 max-w-2xl">
        <p>
          <span className="font-semibold">{title}.</span>{" "}
          <span className="break-words text-muted-foreground">{children}</span>
        </p>
        {detail && <p className="tabular mt-0.5 text-[13px] text-muted-foreground">{detail}</p>}
      </div>
    </li>
  );
}
