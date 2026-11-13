// Who may do what to whom inside one company. Pure rules with no imports, so
// the API enforces them and the website can use the same ones to decide which
// buttons to show.
export type Role = "owner" | "manager" | "driver";

/**
 * Why `actor` may not remove `target` from the company, or null when they may.
 * - Nobody removes the owner.
 * - A manager removes drivers; only the owner removes a manager.
 * - Nobody removes themselves here (that's "Leave company").
 * Drivers never get this far: the API only lets managers and owners ask.
 */
export function removalBlock(actor: Role, target: Role, self: boolean): string | null {
  if (target === "owner") return "The owner can't be removed.";
  if (self) return "You can't remove yourself. Use Leave company instead.";
  if (actor === "driver") return "Only managers and the owner remove members.";
  if (actor === "manager" && target !== "driver") return "Only the owner can remove a manager.";
  return null;
}

/** Why a member with this role may not leave, or null when they may. */
export function leaveBlock(role: Role): string | null {
  return role === "owner"
    ? "You own this company. Ownership can't be handed over yet, so the owner can't leave."
    : null;
}
