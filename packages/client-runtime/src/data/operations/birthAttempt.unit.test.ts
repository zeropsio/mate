import { expect, it } from "vite-plus/test";
import { birthAttempt } from "./birthAttempt.ts";

// witness: packages/client-runtime/src/data/operations/birthAttempt.ts | return async (step, send) => { → return async (step, start) => { const pending = start(); const send = () => pending;
it("OP42: A birth never sends a write after another device holds its claim", async () => {
  const refused = new Error("attempt_taken");
  const writes: string[] = [];
  const attempt = birthAttempt(
    async () => {
      throw refused;
    },
    "org",
    "birth",
    () => true,
  );
  const answer = attempt("import", async () => {
    writes.push("import");
  });
  await expect(answer).rejects.toBe(refused);
  expect(writes).toEqual([]);
});
