// Small pieces the company pages share: the logo, the verified mark, a
// two-step confirm for actions that can't be undone, and the role pill.
import { Button } from "@te-rebrand/ui/components/button";
import { BadgeCheck } from "lucide-react";
import { type ReactNode, useState } from "react";

const dateFmt = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
});
/** "12 Mar 2026" */
export function formatDate(date: Date | string) {
  return dateFmt.format(new Date(date));
}

/** The company's logo, or its initials on a neutral tile when it has none (or it fails to load). */
export function CompanyLogo({
  name,
  tag,
  logoUrl,
  className = "size-16 text-xl",
}: {
  name: string;
  tag: string | null;
  logoUrl: string | null;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const initials =
    (tag ?? name)
      .replace(/[^\p{L}\p{N}]/gu, "")
      .slice(0, 3)
      .toUpperCase() || "VTC";
  return (
    <div
      className={`flex shrink-0 items-center justify-center overflow-hidden rounded-2xl border bg-secondary font-display font-extrabold tracking-tight text-muted-foreground ${className}`}
    >
      {logoUrl && !failed ? (
        <img
          src={logoUrl}
          alt=""
          referrerPolicy="no-referrer"
          className="size-full object-cover"
          onError={() => setFailed(true)}
        />
      ) : (
        <span aria-hidden="true">{initials}</span>
      )}
    </div>
  );
}

/** Shown when TruckersMP confirmed that the person who registered the company runs the VTC. */
export function VerifiedMark({ className = "" }: { className?: string }) {
  return (
    <span
      className={`inline-flex h-6 items-center gap-1 rounded-full bg-success-bg px-2 text-[12px] font-semibold text-success ${className}`}
      title="TruckersMP confirmed that this company is run by the VTC's owner."
    >
      <BadgeCheck className="size-3.5" aria-hidden="true" />
      Verified VTC
    </span>
  );
}

const ROLE_LABEL = { owner: "Owner", manager: "Manager", driver: "Driver" } as const;
export type Role = keyof typeof ROLE_LABEL;
export const roleLabel = (role: Role) => ROLE_LABEL[role];

export function RolePill({ role }: { role: Role }) {
  return (
    <span className="inline-flex h-6 items-center rounded-full bg-secondary px-2.5 text-[12px] font-semibold">
      {ROLE_LABEL[role]}
    </span>
  );
}

/**
 * A button that asks once more before it acts: the first press swaps it for a
 * question with a destructive button and Cancel. For leaving, removing,
 * rejecting and withdrawing, which can't be undone from the same screen.
 */
export function ConfirmAction({
  label,
  icon,
  question,
  detail,
  confirmLabel,
  pendingLabel,
  pending,
  disabled,
  onConfirm,
  size = "default",
  variant = "outline",
  align = "start",
}: {
  label: string;
  icon?: ReactNode;
  question: string;
  detail?: string;
  confirmLabel: string;
  pendingLabel: string;
  pending: boolean;
  disabled?: boolean;
  onConfirm: () => void;
  size?: "default" | "sm";
  variant?: "outline" | "ghost";
  align?: "start" | "end";
}) {
  const [asking, setAsking] = useState(false);
  if (!asking) {
    return (
      <Button variant={variant} size={size} disabled={disabled} onClick={() => setAsking(true)}>
        {icon}
        {label}
      </Button>
    );
  }
  return (
    <div
      role="group"
      aria-label={question}
      className={`flex flex-wrap items-center gap-x-3 gap-y-2 ${align === "end" ? "justify-end" : ""}`}
    >
      <p className="min-w-0 text-[14px] leading-relaxed">
        <span className="font-semibold">{question}</span>
        {detail && <span className="text-muted-foreground"> {detail}</span>}
      </p>
      <div className="flex gap-2">
        <Button variant="destructive" size={size} disabled={pending} onClick={onConfirm}>
          {pending ? pendingLabel : confirmLabel}
        </Button>
        <Button
          variant="ghost"
          size={size}
          disabled={pending}
          onClick={() => setAsking(false)}
          autoFocus
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}

type ApiError = { message: string; data?: { code?: string } | null };

/**
 * The API words its own refusals (who may remove whom, what TruckersMP said);
 * those are shown as they are. Anything else gets a plain line.
 */
export function actionError(error: ApiError, fallback = "That didn't work. Try again.") {
  const code = error.data?.code;
  const worded =
    code === "CONFLICT" ||
    code === "NOT_FOUND" ||
    code === "FORBIDDEN" ||
    code === "PRECONDITION_FAILED" ||
    code === "BAD_GATEWAY" ||
    (code === "BAD_REQUEST" && !error.message.trimStart().startsWith("["));
  return worded ? error.message : fallback;
}
