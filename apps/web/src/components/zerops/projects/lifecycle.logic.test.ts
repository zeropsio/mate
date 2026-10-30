import { expect, it } from "vite-plus/test";

import { lifecycleMain } from "./lifecycle.logic";

it.each([
  {
    title: "Lifecycle keeps unread merged code distinct from an empty main",
    main: { hasCode: undefined, notLive: 0, notLiveAtLeast: false },
    awaiting: false,
    unknown: undefined,
    state: "reading",
    heading: "Reading merged code…",
  },
  {
    title: "Lifecycle says there is no merged code only after main was read",
    main: { hasCode: false, notLive: 0, notLiveAtLeast: false },
    awaiting: false,
    unknown: undefined,
    state: "empty",
    heading: "No merged code yet",
  },
  {
    title: "Lifecycle withholds merged change details while their access is unverified",
    main: { hasCode: true, notLive: 4, notLiveAtLeast: false },
    awaiting: false,
    unknown: "unseen" as const,
    state: "unknown",
    heading: "Merged code cannot be verified",
  },
  {
    title: "Lifecycle shows a failed changes read instead of claiming production is up to date",
    main: { hasCode: true, notLive: 0, notLiveAtLeast: false },
    awaiting: false,
    unknown: "failed" as const,
    state: "unknown",
    heading: "Merged code cannot be verified",
  },
  {
    title: "Lifecycle waits for changes before describing the merged selection",
    main: { hasCode: true, notLive: 4, notLiveAtLeast: false },
    awaiting: true,
    unknown: undefined,
    state: "reading",
    heading: "Reading merged code…",
  },
  {
    title: "Lifecycle does not infer a completed release from zero waiting changes",
    main: { hasCode: true, notLive: 0, notLiveAtLeast: false },
    awaiting: false,
    unknown: undefined,
    state: "merged",
    heading: "Merged code",
  },
])("$title", ({ main, awaiting, unknown, state, heading }) => {
  expect(lifecycleMain({ main: { ...main, head: undefined }, awaiting, unknown })).toMatchObject({
    state,
    heading,
  });
});
