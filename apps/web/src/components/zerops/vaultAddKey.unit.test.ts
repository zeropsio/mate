import type { VaultScope } from "@t3tools/client-runtime/data";
import { expect, it } from "vite-plus/test";
import { addKeyProblem } from "./vault/vault.logic";

const scope = (id: string, keys: ReadonlyArray<string>): VaultScope => ({
  ref: { kind: "service", serviceId: id },
  id,
  hostname: id,
  kind: "mate",
  serviceType: "zcp@1",
  editable: true,
  values: keys.map((key) => ({
    id: `${id}-${key}`,
    key,
    sensitive: true,
    value: null,
    createdAt: null,
    changedAt: null,
    madeByZerops: false,
    readers: [],
  })),
  reads: [],
  startedAt: null,
  running: true,
  deploying: false,
});

// witness: apps/web/src/components/zerops/vault/vault.logic.ts | sent?.key === key && sent.scopeId === scope.id ? null : keyProblem → false ? null : keyProblem
it("MN+1: The add card never reads the key it has sent to a vault as already there, while the vault shows that write before it ends, and still reads any other key, or the same key in another vault, against what each holds; breaks: adding a key to a message says it already exists while it saves, then puts it in the message anyway", () => {
  const holding = scope("fia", ["email"]);
  const other = scope("api", ["email"]);
  const rows = [
    // Its own write, shown before it ends.
    [holding, "email", { key: "email", scopeId: "fia" }, null],
    // Nothing sent: the key is there.
    [holding, "email", null, "email already exists"],
    // Another key sent.
    [holding, "email", { key: "token", scopeId: "fia" }, "email already exists"],
    // The same key sent to another vault.
    [other, "email", { key: "email", scopeId: "fia" }, "email already exists"],
  ] as const;
  for (const [into, key, sent, problem] of rows)
    expect(addKeyProblem(key, into, sent)).toBe(problem);
});
