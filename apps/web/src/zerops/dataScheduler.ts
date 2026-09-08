import * as Scheduler from "effect/Scheduler";

/** Browser task boundaries keep the UI responsive without nested timer clamping. */
export function makeBrowserDataScheduler(makeChannel = () => new MessageChannel()) {
  const channel = makeChannel();
  const pending = new Map<number, () => void>();
  let sequence = 0;
  let disposed = false;
  channel.port1.onmessage = (event: MessageEvent<number>) => {
    const task = pending.get(event.data);
    pending.delete(event.data);
    task?.();
  };
  return {
    scheduler: new Scheduler.MixedScheduler("async", (task) => {
      if (disposed) return () => undefined;
      const id = ++sequence;
      pending.set(id, task);
      channel.port2.postMessage(id);
      return () => {
        pending.delete(id);
      };
    }),
    dispose: () => {
      if (disposed) return;
      disposed = true;
      pending.clear();
      channel.port1.onmessage = null;
      channel.port1.close();
      channel.port2.close();
    },
  };
}
