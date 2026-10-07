import { AtomRegistry } from "effect/unstable/reactivity";
import { makeAccountStore, makeSendTurnReceipts } from "@t3tools/client-runtime/data";
import { describe, expect, it, vi } from "vite-plus/test";

const SENT = { messageId: "message-1", threadId: "thread-1", text: "Add a login", at: "t" };
function rig() {
  const registry = AtomRegistry.make();
  const store = makeAccountStore(registry);
  const release = vi.fn();
  let seen: ((ids: ReadonlyArray<string>) => void) | undefined;
  const receipts = makeSendTurnReceipts(store, registry, (_environment, _thread, callback) => {
    seen = callback;
    return release;
  });
  return {
    registry,
    store,
    receipts,
    release,
    say: (ids: ReadonlyArray<string>) => seen?.(ids),
    read: () => registry.get(receipts.atom("env-1")),
  };
}
describe("pending sent words from turn receipts", () => {
  it("keeps the person's words until their exact message appears, whatever time passes", () => {
    const r = rig();
    r.receipts.requested("env-1", SENT);
    r.receipts.accepted("env-1", SENT.messageId);
    r.say(["another-message-with-the-same-time"]);
    expect(r.read()).toEqual(SENT);
    r.say([SENT.messageId]);
    expect(r.read()).toBeUndefined();
    expect(r.release).toHaveBeenCalledOnce();
  });
  it("a later send replaces the one before it and another message's failure leaves it", () => {
    const r = rig();
    r.receipts.requested("env-1", SENT);
    r.receipts.requested("env-1", { ...SENT, messageId: "message-2" });
    r.receipts.failed("env-1", SENT.messageId);
    expect(r.read()?.messageId).toBe("message-2");
  });
  it("a failed send restores the draft without claiming the owner rejected the request", () => {
    const r = rig();
    r.receipts.requested("env-1", SENT);
    r.receipts.failed("env-1", SENT.messageId);
    expect(r.read()).toBeUndefined();
    expect([...r.store.state().operations.values()][0]?.unresolved?.nextAction).toContain(
      "before sending again",
    );
    r.say([SENT.messageId]);
    expect([...r.store.state().operations.values()][0]?.receipt?.outcome.kind).toBe("succeeded");
  });
  it("holds observation after the originating surface leaves and fences a late answer on account close", () => {
    const r = rig();
    r.receipts.requested("env-1", SENT);
    r.receipts.accepted("env-1", SENT.messageId);
    expect(r.release).not.toHaveBeenCalled();
    r.receipts.close();
    expect(r.read()).toBeUndefined();
    r.store.close();
    r.say([SENT.messageId]);
    expect(r.release).toHaveBeenCalledOnce();
    expect([...r.store.state().operations.values()][0]?.receipt?.outcome.kind).toBe("pending");
  });
});

it("a preflight failure restores the draft and leaves a proven unsent receipt", () => {
  const r = rig();
  r.receipts.requested("env-1", SENT);
  r.receipts.failed("env-1", SENT.messageId, false);
  expect(r.read()).toBeUndefined();
  expect([...r.store.state().operations.values()][0]?.submission).toBe("unsent");
  expect(r.release).toHaveBeenCalledOnce();
});
