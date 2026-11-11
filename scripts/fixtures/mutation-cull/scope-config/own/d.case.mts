// A worker another test file already ran in still holds that file's globals.
import { expect, it } from "vite-plus/test";

const shared = (globalThis as { caseRan?: boolean }).caseRan === true;
(globalThis as { caseRan?: boolean }).caseRan = true;

it("starts in a worker no other test file ran in", () => {
  expect(shared).toBe(false);
});
