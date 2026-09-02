/**
 * Signing up for Zerops from inside Zerops Mate.
 *
 * The body is built by a pure function so the two decisions in it — whether a
 * pool project is claimed, and whether a captcha token rides along — are
 * pinned by tests rather than buried in a component.
 */

export interface ZeropsRegistrationInput {
  readonly email: string;
  readonly password: string;
  readonly fullName: string;
  readonly organizationName: string;
  /**
   * Asks the platform to hand this brand-new account a pre-provisioned project
   * from the zcp pool. Undocumented but accepted; the response's `zcpClaimed`
   * says whether one was actually given.
   */
  readonly claimZcpPool?: boolean;
  /**
   * Cloudflare Turnstile token, obtained by the widget on the page.
   *
   * Required, and measured to be so: a complete body with no `token` is
   * refused with `cloudflareCaptchaVerificationFailed` — a different layer
   * from the field validation that answers `invalidUserInput`. There is no
   * captcha-less registration path, so the client refuses to spend a request
   * on one.
   */
  readonly turnstileToken: string;
}

/** The platform's code for "the captcha did not check out". */
export const ZEROPS_CAPTCHA_ERROR_CODE = "cloudflareCaptchaVerificationFailed";

export interface ZeropsRegistrationBody {
  readonly email: string;
  readonly password: string;
  readonly name: string;
  readonly accountName: string;
  readonly languageId: string;
  readonly claimZcpPool: boolean;
  readonly token: string;
}

export function buildZeropsRegistrationBody(
  input: ZeropsRegistrationInput,
): ZeropsRegistrationBody {
  return {
    email: input.email.trim(),
    // Never trimmed: a leading or trailing space is a legitimate part of a
    // password, and silently dropping it locks the account out.
    password: input.password,
    name: input.fullName.trim(),
    accountName: input.organizationName.trim(),
    languageId: "en",
    claimZcpPool: input.claimZcpPool ?? true,
    token: input.turnstileToken,
  };
}

/**
 * Whether a failure is the platform refusing the captcha rather than the form.
 * The two are different layers and want different words on screen: a captcha
 * refusal on a third-party origin means registration is unavailable *here*,
 * not that the user typed something wrong.
 */
export function isZeropsCaptchaRejection(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { readonly code?: unknown }).code === ZEROPS_CAPTCHA_ERROR_CODE
  );
}
