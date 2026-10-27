/**
 * The browser's locks a Mate's setup holds across this browser's tabs (`navigator.locks`): one
 * press or *Finish setup* per project at a time. A key's read-then-write is every token writer's
 * one lock (`tokenWriteLock.ts`).
 */

/** The part of `navigator.locks` these use. */
export interface LockManagerLike {
  readonly request: <T>(
    name: string,
    options: { readonly ifAvailable?: boolean },
    hold: (lock: unknown) => Promise<T>,
  ) => Promise<T>;
}

/** This browser's locks, where it has them. */
export function browserLocks(): LockManagerLike | undefined {
  if (typeof navigator === "undefined") return undefined;
  const locks = (navigator as { readonly locks?: LockManager }).locks;
  return locks === undefined ? undefined : (locks as unknown as LockManagerLike);
}

export const matePressLockName = (projectId: string): string => `mate:press:${projectId}`;

/** Runs `run` holding the lock where no other holder has it; `busy` where one does. */
export async function withLockIfFree<T>(
  locks: LockManagerLike | undefined,
  name: string,
  run: () => Promise<T>,
  busy: () => T,
): Promise<T> {
  if (locks === undefined) return run();
  return locks.request(name, { ifAvailable: true }, async (lock) =>
    lock === null ? busy() : run(),
  );
}

/** Runs `run` holding the lock, waiting its turn behind any other holder: a press, to its end. */
export async function withExclusiveLock<T>(
  locks: LockManagerLike | undefined,
  name: string,
  run: () => Promise<T>,
): Promise<T> {
  if (locks === undefined) return run();
  return locks.request(name, {}, () => run());
}
