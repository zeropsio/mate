import { mateMessageNoticeHeading } from "@t3tools/contracts";
import { expect, it } from "vite-plus/test";
import { noticePersonSentence } from "./MateMessageRow.logic.ts";

// witness: packages/contracts/src/mateMessage.ts | if (reviewBuild && github) → if (reviewBuild || github)
it("MN116: A delivered check notice names which checks failed and that the Mate is fixing them, whether the change has a title or only a number; breaks: a Review build failure looks like a GitHub failure", () => {
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
  for (const failure of failures) {
    const about = { number: 57, failed: failure.failed };
    expect({
      named: mateMessageNoticeHeading(about, "Guestbook"),
      numbered: mateMessageNoticeHeading(about),
      sentence: noticePersonSentence("Abel"),
    }).toEqual({
      named: failure.named,
      numbered: failure.numbered,
      sentence: "Abel is fixing it.",
    });
  }
});
