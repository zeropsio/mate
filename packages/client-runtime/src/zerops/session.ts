/**
 * The Zerops session — its shape, the predicates over it, and its persistence
 * together with the remembered org/project selection, behind an injectable
 * storage adapter so mobile can back it with secure storage and web with
 * `localStorage` without either owning the encoding.
 *
 * This module never imports the REST client: the connection layer reads the
 * stored session through it, and render-only surfaces reach the connection
 * layer, so anything here must stay free of calls that can mutate a project.
 *
 * Session and selection live under separate versioned keys: signing out must
 * not forget which project the account was working in.
 */

/** The Zerops account session as the platform returns it and the client stores it. */
export interface ZeropsSession {
  readonly accessToken: string;
  readonly refreshToken?: string;
  readonly expiresAt?: string;
  readonly expiresIn?: number;
  readonly userId?: string;
  readonly tokenType?: string;
  /** Set when the account has 2FA enabled; the values are method names ("TOTP"). */
  readonly twoFAMethods?: ReadonlyArray<string>;
  /** True only once the second factor has been presented. */
  readonly twoFAVerified?: boolean;
  /** One-time secret returned when a recovery code was consumed; never persisted. */
  readonly newRecoveryToken?: string;
}

export function requiresZeropsTwoFactor(session: ZeropsSession | null | undefined): boolean {
  return !!(
    session &&
    session.twoFAMethods &&
    session.twoFAMethods.length > 0 &&
    session.twoFAVerified !== true
  );
}

export function isZeropsSession(value: unknown): value is ZeropsSession {
  if (!value || typeof value !== "object") return false;
  const session = value as Partial<ZeropsSession>;
  return typeof session.accessToken === "string" && session.accessToken.trim().length > 0;
}

/** A session that is usable for API calls: present and past any second factor. */
export function isUsableZeropsSession(value: unknown): value is ZeropsSession {
  return isZeropsSession(value) && !requiresZeropsTwoFactor(value);
}

/** The narrowest shape both backends satisfy — get/set/remove, async. */
export interface ZeropsStorageAdapter {
  readonly get: (key: string) => Promise<string | null>;
  readonly set: (key: string, value: string) => Promise<void>;
  readonly remove: (key: string) => Promise<void>;
}

export const ZEROPS_SESSION_STORAGE_KEY = "zerops-mate.zerops-session.v1";
export const ZEROPS_SELECTION_STORAGE_KEY = "zerops-mate.zerops-selection.v1";

export interface ZeropsSelection {
  readonly userId: string;
  /** Exact `clientUser` membership, matching the platform GUI's active scope. */
  readonly clientUserId: string | null;
  readonly clientId: string | null;
  readonly projectId: string | null;
}

function withoutRecoveryToken(session: ZeropsSession): ZeropsSession {
  // A rotated recovery token is a one-time secret the UI shows once. It must
  // not become a durable part of the stored session.
  const { newRecoveryToken: _newRecoveryToken, ...persistable } = session;
  return persistable;
}

/**
 * Parses a raw stored value into a usable session, or null when it is missing,
 * corrupt, or still mid-2FA. A half-2FA session is deliberately memory-only:
 * on restart the user starts a fresh sign-in rather than booting an authorized
 * UI. Pure, so a synchronous backend can skip the async round trip.
 */
export function parseZeropsSession(raw: string | null): ZeropsSession | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isZeropsSession(parsed) || !isUsableZeropsSession(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function loadZeropsSession(
  storage: ZeropsStorageAdapter,
): Promise<ZeropsSession | null> {
  const raw = await storage.get(ZEROPS_SESSION_STORAGE_KEY);
  const session = parseZeropsSession(raw);
  if (raw && !session) {
    // Corrupt, outdated or half-2FA records read as signed out.
    await storage.remove(ZEROPS_SESSION_STORAGE_KEY);
  }
  return session;
}

export async function saveZeropsSession(
  storage: ZeropsStorageAdapter,
  session: ZeropsSession,
): Promise<void> {
  if (!isUsableZeropsSession(session)) {
    await clearZeropsSession(storage);
    return;
  }
  await storage.set(ZEROPS_SESSION_STORAGE_KEY, JSON.stringify(withoutRecoveryToken(session)));
}

export async function clearZeropsSession(storage: ZeropsStorageAdapter): Promise<void> {
  await storage.remove(ZEROPS_SESSION_STORAGE_KEY);
}

function parseSelection(value: unknown): ZeropsSelection | null {
  if (!value || typeof value !== "object") return null;
  const selection = value as Partial<ZeropsSelection>;
  if (typeof selection.userId !== "string" || !selection.userId) return null;
  if (
    selection.clientUserId !== undefined &&
    selection.clientUserId !== null &&
    typeof selection.clientUserId !== "string"
  )
    return null;
  if (selection.clientId !== null && typeof selection.clientId !== "string") return null;
  if (selection.projectId !== null && typeof selection.projectId !== "string") return null;
  return {
    userId: selection.userId,
    clientUserId: selection.clientUserId ?? null,
    clientId: selection.clientId ?? null,
    projectId: selection.projectId ?? null,
  };
}

export async function loadZeropsSelection(
  storage: ZeropsStorageAdapter,
  userId: string,
): Promise<ZeropsSelection> {
  const fallback: ZeropsSelection = {
    userId,
    clientUserId: null,
    clientId: null,
    projectId: null,
  };
  const raw = await storage.get(ZEROPS_SELECTION_STORAGE_KEY);
  if (!raw) return fallback;
  try {
    const selection = parseSelection(JSON.parse(raw));
    return selection?.userId === userId ? selection : fallback;
  } catch {
    return fallback;
  }
}

export async function saveZeropsSelection(
  storage: ZeropsStorageAdapter,
  selection: ZeropsSelection,
): Promise<void> {
  await storage.set(ZEROPS_SELECTION_STORAGE_KEY, JSON.stringify(selection));
}

export async function clearZeropsSelection(storage: ZeropsStorageAdapter): Promise<void> {
  await storage.remove(ZEROPS_SELECTION_STORAGE_KEY);
}
