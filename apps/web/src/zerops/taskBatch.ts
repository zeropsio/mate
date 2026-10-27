/**
 * The account runtime's publications as React hears them: at most once per task.
 *
 * A store of the account runtime publishes on every change, and a reconnect lands its changes
 * one microtask after another inside one task: every Mate's environment and container machine
 * after a grant, every project's atom as the inventory reads it. React commits each publication
 * it hears on its own, and a surface that leaves an update pending in each of those commits
 * meets React's nested-update limit (50). A listener handed out here is told once, in the next
 * task, however often its store published before it.
 */

let channel: MessageChannel | null = null;
let pending = new Set<() => void>();

function flush(): void {
  const told = pending;
  pending = new Set();
  for (const listener of told) listener();
}

/** `listener`, told at most once per task however often its store publishes. */
export function batchedPerTask(listener: () => void) {
  return {
    /** The store published: `listener` hears it in the next task. */
    notify: () => {
      if (pending.size === 0) {
        if (channel === null) {
          channel = new MessageChannel();
          channel.port1.onmessage = flush;
        }
        channel.port2.postMessage(null);
      }
      pending.add(listener);
    },
    /** The subscription ended: a publication it was not yet told of is dropped. */
    cancel: () => {
      pending.delete(listener);
    },
  };
}
