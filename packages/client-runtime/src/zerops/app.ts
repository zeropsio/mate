/**
 * The Zerops app an account was made in and its e-mails link back to. Zerops records it once, as
 * the user's `createdByApp`, and sends invitation, verification, password-recovery and sign-in
 * links to HQ with `?app=` in lower case; a null `app` means `PLATFORM`.
 */
export type ZeropsApp = "PLATFORM" | "MATE" | "BOX";

/** Every account and e-mail link Mate asks Zerops for is Mate's. */
export const ZEROPS_APP: ZeropsApp = "MATE";
