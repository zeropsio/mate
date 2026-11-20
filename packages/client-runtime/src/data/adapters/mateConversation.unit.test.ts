import { expect, it } from "vite-plus/test";
import { conversationsListed } from "./mateConversation.ts";

// witness: packages/client-runtime/src/data/adapters/mateConversation.ts | rows.phase === "live" || rows.lostAt !== undefined → rows.phase === "live" || rows.phase === "baselining"
it("AD25: A conversation's absence is read off its Mate's conversation list only once the list answered whole", () => {
  const engine = { kind: "engine", protocol: 1 } as const;
  expect(conversationsListed({ kind: "unknown" }, null)).toBe(false);
  expect(conversationsListed(engine, null)).toBe(false);
  expect(conversationsListed(engine, { phase: "baselining" })).toBe(false);
  expect(conversationsListed(engine, { phase: "live" })).toBe(true);
  expect(conversationsListed(engine, { phase: "recovering", lostAt: 5 })).toBe(true);
});
