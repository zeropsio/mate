import { normalizeOrigin } from "@t3tools/client-runtime/zerops/candidates";
import { accountLocalStorage } from "./accountLifetime";

const KEY = "environment-targets:v1";
export interface RememberedEnvironment {
  readonly key: string;
  readonly environmentId: string;
}
export function readRememberedEnvironments(): ReadonlyArray<RememberedEnvironment> {
  try {
    const parsed: unknown = JSON.parse(accountLocalStorage.getItem(KEY) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (value): value is RememberedEnvironment =>
        typeof value === "object" &&
        value !== null &&
        typeof value.key === "string" &&
        typeof value.environmentId === "string",
    );
  } catch {
    return [];
  }
}
export function rememberEnvironment(value: RememberedEnvironment): void {
  const values = readRememberedEnvironments().filter((entry) => entry.key !== value.key);
  accountLocalStorage.setItem(KEY, JSON.stringify([...values, value]));
}

/** Names and addresses cannot make a replacement service inherit an old target. */
export function isCurrentEnvironmentTarget(
  environment: { readonly environmentId: string; readonly displayUrl?: string | null },
  remembered: ReadonlyArray<RememberedEnvironment>,
  candidates: ReadonlyArray<{ readonly key: string; readonly containerOrigin?: string | null }>,
): boolean {
  if (!environment.displayUrl) return false;
  const origin = normalizeOrigin(environment.displayUrl);
  return remembered.some(
    (entry) =>
      entry.environmentId === environment.environmentId &&
      candidates.some(
        (candidate) =>
          candidate.key === entry.key &&
          candidate.containerOrigin != null &&
          normalizeOrigin(candidate.containerOrigin) === origin,
      ),
  );
}
