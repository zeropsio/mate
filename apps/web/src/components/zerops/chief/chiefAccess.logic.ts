/**
 * The person's access their Chief reads with: the personal token HQ makes with their own sign-in
 * and keeps for it (`chiefToken` in their Chief's person facts), as the Chief's header says it.
 */
import type { HqChiefToken } from "@t3tools/shared/hqStream";

/** Said wherever the access is offered: the Chief carries what the person may do. */
export const CHIEF_ACCESS_RISK =
  "Chief reads with your own access: whatever you can reach in this organization, it can reach too.";

export interface ChiefAccessView {
  /** The state, in one line. */
  readonly said: string;
  /** What the person can do about it; none while it works. */
  readonly next: string | null;
  /** The press that has HQ make and keep a new one. */
  readonly keep: "Add access" | "Replace";
  /** Whether there is one to forget. */
  readonly forget: boolean;
  /** Chief cannot read until the person acts. */
  readonly attention: boolean;
}

/**
 * | `chiefToken` | said                         | presses          |
 * | ------------ | ---------------------------- | ---------------- |
 * | `kept`       | Chief reads with your access | Replace, Forget  |
 * | `refused`    | Your access was refused      | Replace, Forget  |
 * | `missing`    | Chief has no access yet      | Add access       |
 */
export function chiefAccessView(token: HqChiefToken): ChiefAccessView {
  switch (token) {
    case "kept":
      return {
        said: "Chief reads with your access",
        next: null,
        keep: "Replace",
        forget: true,
        attention: false,
      };
    case "refused":
      return {
        said: "Your access was refused",
        next: "Replace it so Chief can read again.",
        keep: "Replace",
        forget: true,
        attention: true,
      };
    case "missing":
      return {
        said: "Chief has no access yet",
        next: "Add it so Chief can read across your organization.",
        keep: "Add access",
        forget: false,
        attention: true,
      };
  }
}
