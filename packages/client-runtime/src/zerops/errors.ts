/**
 * Why a Zerops call failed, in the terms the UI branches on. `expired-session`
 * means the credential is gone (the client has already signed itself out);
 * `forbidden` means this account may not touch that resource and the session
 * is still good.
 */
export type ZeropsApiErrorKind =
  | "network"
  | "uncertain"
  | "expired-session"
  | "forbidden"
  | "not-found"
  | "invalid-input"
  | "server"
  | "unexpected";

/**
 * A project write its admission refused before anything was sent: nothing reached Zerops, so it
 * cannot have landed. Says the admission's own words; `refusal` is what the admission threw.
 */
export class ZeropsWriteNotSent extends Error {
  readonly refusal: unknown;

  constructor(refusal: unknown) {
    super(
      typeof refusal === "object" &&
        refusal !== null &&
        "message" in refusal &&
        typeof refusal.message === "string"
        ? refusal.message
        : "The write was not sent.",
    );
    this.name = "ZeropsWriteNotSent";
    this.refusal = refusal;
  }
}

export class ZeropsApiError extends Error {
  readonly kind: ZeropsApiErrorKind;
  readonly status: number | null;
  readonly code: string | null;
  /** What the platform itself said, when it said anything; `null` for a status alone. */
  readonly detail: string | null;
  /** How long a throttled request was asked to wait (its `Retry-After`); `null` when unsaid. */
  readonly retryAfterMs: number | null;

  constructor(
    message: string,
    kind: ZeropsApiErrorKind,
    status: number | null = null,
    code: string | null = null,
    detail: string | null = null,
    retryAfterMs: number | null = null,
  ) {
    super(message);
    this.name = "ZeropsApiError";
    this.kind = kind;
    this.status = status;
    this.code = code;
    this.detail = detail;
    this.retryAfterMs = retryAfterMs;
  }
}

/** The target import itself, rather than an earlier read or key write, was refused. */
export class ZeropsTargetWriteRefused extends ZeropsApiError {
  readonly targetWriteRefused = true;
  constructor(refusal: ZeropsApiError) {
    super(
      refusal.message,
      refusal.kind,
      refusal.status,
      refusal.code,
      refusal.detail,
      refusal.retryAfterMs,
    );
  }
}

/** Turns a caught rejection into copy a picker or a connect flow can show. */
export function zeropsErrorMessage(error: unknown): string {
  if (error instanceof ZeropsApiError) return error.message;
  if (error instanceof Error) return error.message;
  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string"
  )
    return error.message;
  return "Something went wrong talking to Zerops.";
}

/**
 * A write the platform may have done anyway — its answer lost, a creation's confirmation never
 * read: asked again, it could be done twice. The client's own error or the data layer's.
 */
export function isUncertainZeropsFailure(cause: unknown): boolean {
  if (cause instanceof ZeropsApiError) return cause.kind === "uncertain";
  return false;
}
