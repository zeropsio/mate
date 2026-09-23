import { afterEach, describe, expect, it } from "vite-plus/test";

import { openAccountChannel } from "./accountChannel";

const opened: Array<{ close(): void }> = [];
afterEach(() => {
  for (const channel of opened.splice(0)) channel.close();
});

/** Another tab's end of the named channel, and the messages it has heard. */
function otherTab(name: string) {
  const channel = new BroadcastChannel(name);
  opened.push(channel);
  const heard: Array<unknown> = [];
  channel.addEventListener("message", (event) => heard.push(event.data));
  return { channel, heard };
}

const nextTask = () => new Promise<void>((resolve) => setTimeout(resolve, 10));

const invalidation = {
  userId: "user-1",
  loginGeneration: "generation-1",
  invalidation: { topic: "access", change: "renew-now" },
} as const;

describe("openAccountChannel (DESIGN §6.7)", () => {
  it("opens the `mate:account` channel the account's tabs share", async () => {
    const channel = openAccountChannel();
    opened.push(channel);
    const other = otherTab("mate:account");
    const elsewhere = otherTab("mate:elsewhere");
    // oxlint-disable-next-line unicorn/require-post-message-target-origin -- a BroadcastChannel stays within its origin
    channel.postMessage(invalidation);
    await nextTask();
    expect(other.heard).toEqual([invalidation]);
    expect(elsewhere.heard).toEqual([]);
  });

  it("hears nothing once closed", async () => {
    const channel = openAccountChannel();
    const heard: Array<unknown> = [];
    channel.addEventListener("message", (event) => heard.push(event.data));
    channel.close();
    // oxlint-disable-next-line unicorn/require-post-message-target-origin -- a BroadcastChannel stays within its origin
    otherTab("mate:account").channel.postMessage(invalidation);
    await nextTask();
    expect(heard).toEqual([]);
  });
});
