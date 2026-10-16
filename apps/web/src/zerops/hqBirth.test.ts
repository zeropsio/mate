import { describe, expect, it } from "vite-plus/test";

import { watchHqBirth, type HqBirthView, type HqBirthWatch } from "./hqBirth";

const RUNNING: HqBirthView = { kind: "running", step: "deploy" };
const DONE: HqBirthView = { kind: "running", step: "done" };
const FAILED: HqBirthView = { kind: "failed", step: "deploy", reason: "offline." };

describe("the finished HQ setup on screen", () => {
  it.each<{
    title: string;
    from: HqBirthWatch;
    birth: HqBirthView | undefined;
    menuSettled: boolean;
    to: HqBirthWatch;
  }>([
    {
      title: "a setup this page watches running is watched",
      from: "unseen",
      birth: RUNNING,
      menuSettled: false,
      to: "running",
    },
    {
      title: "a setup that finished before the page loaded is never held",
      from: "unseen",
      birth: DONE,
      menuSettled: false,
      to: "unseen",
    },
    {
      title: "a watched setup that finishes stays on screen while the menu reads the new HQ",
      from: "running",
      birth: DONE,
      menuSettled: false,
      to: "born",
    },
    {
      title: "the finished setup gives way once the menu has read the new HQ",
      from: "born",
      birth: DONE,
      menuSettled: true,
      to: "released",
    },
    {
      title: "a watched setup that finishes with the menu already read is not held",
      from: "running",
      birth: DONE,
      menuSettled: true,
      to: "released",
    },
    {
      title: "a setup that stopped keeps being watched for its next try",
      from: "running",
      birth: FAILED,
      menuSettled: false,
      to: "running",
    },
    {
      title: "once given way, the finished setup never comes back",
      from: "released",
      birth: DONE,
      menuSettled: false,
      to: "released",
    },
  ])("$title", ({ from, birth, menuSettled, to }) => {
    expect(watchHqBirth(from, { birth, menuSettled })).toBe(to);
  });
});
