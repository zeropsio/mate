import { expect, it } from "vite-plus/test";

import { strandedTakes } from "./takenConversation.ts";

const REPOT = { id: "task-repot", title: "Repot the ferns" };
const WRAP = { id: "task-wrap", title: "Offer gift wrapping" };

// witness: packages/client-runtime/src/zerops/takenConversation.ts | if (!conversations.listed || !conversations.namesTaken) return NONE; → if (!conversations.listed) return NONE;
it("ZV221: A task the reader took for their Mate is stranded, offering Open its conversation, only where that Mate's conversations are read whole here from a server that names each one's taken task; breaks: a Mate on an older server, or one whose rows are still arriving, offers a second conversation for every task it took", () => {
  const carried = ["task-other"];
  expect(strandedTakes([REPOT], undefined)).toEqual([]);
  expect(strandedTakes([REPOT], { listed: true, namesTaken: false, carried })).toEqual([]);
  expect(strandedTakes([REPOT], { listed: false, namesTaken: true, carried })).toEqual([]);
  expect(strandedTakes([REPOT], { listed: true, namesTaken: true, carried })).toEqual([REPOT]);
});

// witness: packages/client-runtime/src/zerops/takenConversation.ts | const stranded = taken.filter((task) => !carried.has(task.id)); → const stranded = taken.filter((task) => carried.has(task.id));
it("ZV222: A taken task one of its Mate's conversations carries is not stranded, and one none of them carries is; breaks: a task whose conversation opened still offers to open it again, or a Take whose conversation never opened offers no way to open it", () => {
  const conversations = {
    listed: true,
    namesTaken: true,
    carried: [WRAP.id],
  };
  expect(strandedTakes([REPOT, WRAP], conversations)).toEqual([REPOT]);
  expect(strandedTakes([WRAP], conversations)).toEqual([]);
});
