import { expect, it } from "vite-plus/test";

import { isRecordKeptAsk } from "./state.ts";

// witness: apps/server/src/engine/domain/state.ts | request.dismissible === true → false
it("ED4: A question asked by message, like an ask on a card, is an ask the record keeps and no turn waits on; a question or approval its turn waits on and a helper's ask are not. Breaks: read as waited on, one unanswered question holds every update of its Mate back for days.", () => {
  expect(isRecordKeptAsk({ kind: "question", dismissible: true })).toBe(true);
  expect(isRecordKeptAsk({ kind: "vault" })).toBe(true);
  expect(isRecordKeptAsk({ kind: "question" })).toBe(false);
  const helperAsk = { kind: "question", byHelper: true } as const;
  expect(isRecordKeptAsk(helperAsk)).toBe(false);
});
