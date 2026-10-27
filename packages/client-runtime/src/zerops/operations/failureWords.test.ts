import { describe, expect, it } from "vite-plus/test";

import { deployFailureWords } from "./failureWords.ts";

// zcp's likelyCause is written for the agent; the person reads what went
// wrong in plain words, by its category and signals. The specific line is
// the log's (pass 43, R12-13).
describe("deployFailureWords — a deploy's failure in the person's words", () => {
  it.each([
    {
      name: "a build",
      classification: { category: "build", signals: ["build:module-not-found"] },
      words: "Its build failed, so nothing new was deployed.",
    },
    {
      name: "a start-up command",
      classification: { category: "start", signals: ["phase:init"] },
      words: "Its start-up command failed, so the new version didn't go live.",
    },
    {
      name: "a start-up command by its own signal",
      classification: { category: "start", signals: ["init:migration-failed"] },
      words: "Its start-up command failed, so the new version didn't go live.",
    },
    {
      name: "a runtime that failed to prepare",
      classification: { category: "start", signals: ["prepare:missing-sudo"] },
      words: "Preparing its runtime failed, so the new version didn't go live.",
    },
    {
      name: "a runtime that failed to prepare, by its phase",
      classification: { category: "start", signals: ["phase:prepare"] },
      words: "Preparing its runtime failed, so the new version didn't go live.",
    },
    {
      name: "a start with no signal",
      classification: { category: "start" },
      words: "Its start-up command failed, so the new version didn't go live.",
    },
    {
      name: "a check",
      classification: { category: "verify" },
      words: "It deployed, but its checks didn't pass.",
    },
    {
      name: "a connection",
      classification: { category: "network", signals: ["transport:ssh-unreachable"] },
      words: "The deploy couldn't connect, so it never ran.",
    },
    {
      name: "its settings",
      classification: { category: "config", signals: ["phase:preflight"] },
      words: "Its deploy settings were rejected, so it never ran.",
    },
    {
      name: "a sign-in",
      classification: { category: "credential" },
      words: "A sign-in was refused, so the deploy never ran.",
    },
    { name: "anything else", classification: { category: "other" }, words: "The deploy failed." },
    {
      name: "a category this build does not know",
      classification: { category: "quantum" },
      words: "The deploy failed.",
    },
    { name: "no category", classification: {}, words: "The deploy failed." },
  ])("$name", ({ classification, words }) => {
    expect(deployFailureWords(classification)).toBe(words);
  });

  it("is nothing where zcp classified nothing", () => {
    expect(deployFailureWords(undefined)).toBeUndefined();
  });
});
