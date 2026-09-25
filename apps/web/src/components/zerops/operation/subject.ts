/**
 * What an operation card's subject line names: the service (or host) as an
 * identity chip, plus the page's path for a browser check. Pure, props only
 * (R2) — the adapter resolves a browser host to its service hostname
 * (`useOperationCard.ts`'s `browserSubjectHostFor`) and hands it in.
 */
import type { ZeropsOperation, ZeropsOperationKind } from "@t3tools/client-runtime/zerops/model";

export type OperationSubject =
  /** `path` is the page's path + query, absent at the site root. */
  | { readonly kind: "named"; readonly host: string; readonly path?: string }
  /** The input has not named the target yet; `text` is the reducer's own fallback phrase. */
  | { readonly kind: "nameless"; readonly text: string };

/**
 * The kinds whose card names one service (or one page): their status word
 * names the operation in every phase ("Checking", "Deploying", "Starting",
 * "Scaling"), so the word stands as the verb beside the service. Every kind
 * that names several services or none keeps its voice line (a batch deploy
 * among them).
 */
const SUBJECT_KINDS: ReadonlySet<ZeropsOperationKind> = new Set<ZeropsOperationKind>([
  "browser",
  "delete",
  "deploy",
  "devServer",
  "env",
  "logs",
  "manage",
  "scale",
  "subdomain",
  "verify",
]);

/** A browser operation's page, once its subject is a URL rather than the reducer's "the page". */
export function browserPageUrl(operation: ZeropsOperation): URL | undefined {
  if (operation.kind !== "browser" || !URL.canParse(operation.subject)) {
    return undefined;
  }
  return new URL(operation.subject);
}

/**
 * `undefined` for a kind that keeps its voice line. A hostname never holds
 * whitespace and every fallback phrase the reducer writes before the input
 * arrives ("the service", "the dev server") does, so a target with a space
 * is not named yet.
 */
export function operationSubject(
  operation: ZeropsOperation,
  subjectHost: string | undefined,
): OperationSubject | undefined {
  if (!SUBJECT_KINDS.has(operation.kind) || operation.batch === true) {
    return undefined;
  }
  const nameless = { kind: "nameless", text: operation.subject } as const;
  if (operation.kind === "browser") {
    const url = browserPageUrl(operation);
    if (url === undefined) {
      return nameless;
    }
    const path = `${url.pathname}${url.search}`;
    return { kind: "named", host: subjectHost ?? url.host, ...(path === "/" ? {} : { path }) };
  }
  // Only a deploy (and a log read) carries `target`; every other kind's
  // subject is its hostname once the input names one.
  const hostname = operation.target?.hostname ?? operation.subject;
  return hostname === undefined || /\s/.test(hostname)
    ? nameless
    : { kind: "named", host: hostname };
}
