// Ending a membership: a manager or owner removes someone, or a member leaves.
// The rules (who may remove whom, the owner can't leave) are in
// ../membership-rules.ts. Changing roles is `company.setMemberRole`.
import { z } from "zod";

import { companyProcedure, router } from "../index";
import { leaveCompany, removeMember } from "../memberships";

export const membershipsRouter = router({
  /** Takes a member out of the company: status `removed`, `leftAt` now. */
  remove: companyProcedure("manager")
    .input(z.object({ membershipId: z.string().min(1) }))
    .mutation(({ ctx, input }) =>
      removeMember(ctx.db, {
        companyId: ctx.companyId,
        membershipId: input.membershipId,
        actor: { membershipId: ctx.membership.id, role: ctx.membership.role },
      }),
    ),

  /** The caller leaves this company: status `left`, `leftAt` now. */
  leave: companyProcedure("driver").mutation(({ ctx }) => leaveCompany(ctx.db, ctx.membership)),
});
