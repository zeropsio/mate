import { mateMessageNoticeHeading } from "@t3tools/contracts";
import { expect, it } from "vite-plus/test";
import { noticePersonSentence } from "./MateMessageRow.logic.ts";

// witness: apps/web/src/components/zerops/MateMessageRow.logic.ts | checksGivenUpSentence(reason === undefined ? undefined : { reason }) → checksGivenUpSentence(undefined)
it("MN+1: A delivered check notice names which checks failed and what the Mate or its person must do next, whether the change has a title or only a number; breaks: a Review build failure looks like a GitHub failure or a notice that cannot be worked still says the Mate is fixing it", () => {
  const failures = [
    {
      failed: ["review-build"],
      named: 'Your app did not build with "Guestbook"',
      numbered: 'Your app did not build with "#57"',
    },
    {
      failed: ["github"],
      named: "GitHub's checks failed on Guestbook",
      numbered: "GitHub's checks failed on #57",
    },
    {
      failed: ["review-build", "github"],
      named: "Your app did not build, and GitHub's checks failed, on Guestbook",
      numbered: "Your app did not build, and GitHub's checks failed, on #57",
    },
  ] as const;
  const ends = [
    { reason: undefined, sentence: "Abel is fixing it." },
    {
      reason: "no-agent",
      sentence: "No agent can work on this Mate: sign one in, then ask it to fix the check.",
    },
    {
      reason: "usage-limit",
      sentence:
        "Your agent is at its usage limit, so the failed check waits for you: ask again after the limit resets, or sign in another agent.",
    },
  ] as const;
  for (const failure of failures) {
    for (const end of ends) {
      const about = { number: 57, failed: failure.failed };
      expect({
        named: mateMessageNoticeHeading(about, "Guestbook"),
        numbered: mateMessageNoticeHeading(about),
        sentence: noticePersonSentence("Abel", end.reason),
      }).toEqual({ named: failure.named, numbered: failure.numbered, sentence: end.sentence });
    }
  }
});
