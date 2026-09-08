import { describe, expect, it, vi } from "vite-plus/test";

import { makeBrowserDataScheduler } from "./dataScheduler";

function harness() {
  const posted: Array<number> = [];
  const channel = {
    port1: { onmessage: null as ((event: { data: number }) => void) | null, close: vi.fn() },
    port2: { postMessage: (id: number) => posted.push(id), close: vi.fn() },
  };
  return {
    channel,
    ...makeBrowserDataScheduler(() => channel as unknown as MessageChannel),
    nextTask: () => {
      const id = posted.shift();
      if (id !== undefined) channel.port1.onmessage?.({ data: id });
    },
  };
}

describe("browser data scheduler", () => {
  it("yields to a browser task between drains and preserves queued order without timers", () => {
    const tasks = harness();
    const dispatcher = tasks.scheduler.makeDispatcher();
    const seen: Array<string> = [];
    dispatcher.scheduleTask(() => {
      seen.push("first");
      dispatcher.scheduleTask(() => seen.push("next drain"), 0);
    }, 0);
    dispatcher.scheduleTask(() => seen.push("second"), 0);
    expect(seen).toEqual([]);
    tasks.nextTask();
    expect(seen).toEqual(["first", "second"]);
    tasks.nextTask();
    expect(seen).toEqual(["first", "second", "next drain"]);
    tasks.dispose();
  });

  it("cancels flushed callbacks and closes both ports when the account stops", () => {
    const tasks = harness();
    const dispatcher = tasks.scheduler.makeDispatcher();
    const callback = vi.fn();
    dispatcher.scheduleTask(callback, 0);
    dispatcher.flush();
    tasks.nextTask();
    expect(callback).toHaveBeenCalledOnce();
    dispatcher.scheduleTask(callback, 0);
    tasks.dispose();
    tasks.dispose();
    tasks.nextTask();
    expect(callback).toHaveBeenCalledOnce();
    expect(tasks.channel.port1.close).toHaveBeenCalledOnce();
    expect(tasks.channel.port2.close).toHaveBeenCalledOnce();
  });
});
