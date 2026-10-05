import { describe, expect, it } from "vite-plus/test";

import {
  GONE_PICTURE_MEMORY_PATHS,
  GONE_PICTURE_MEMORY_THREADS,
  withGonePicture,
  type GonePictureMemory,
} from "./gonePictureMemory";

// A reload paints nothing it takes back: a result picture whose file was gone is remembered, so
// the next paint leaves it out before its read answers; one that loads again is forgotten.
describe("the gone result pictures' memory", () => {
  const many = (count: number, prefix: string) =>
    Array.from({ length: count }, (_, index) => `${prefix}${index}`);
  it.each<{
    readonly case: string;
    readonly memory: GonePictureMemory;
    readonly thread: string;
    readonly path: string;
    readonly gone: boolean;
    readonly after: GonePictureMemory;
  }>([
    {
      case: "a picture found gone is remembered under its conversation",
      memory: {},
      thread: "t1",
      path: "/s/a.png",
      gone: true,
      after: { t1: ["/s/a.png"] },
    },
    {
      case: "one remembered already is kept once",
      memory: { t1: ["/s/a.png"] },
      thread: "t1",
      path: "/s/a.png",
      gone: true,
      after: { t1: ["/s/a.png"] },
    },
    {
      case: "one that loads again is forgotten, and its conversation with its last",
      memory: { t1: ["/s/a.png"], t2: ["/s/b.png"] },
      thread: "t1",
      path: "/s/a.png",
      gone: false,
      after: { t2: ["/s/b.png"] },
    },
    {
      case: "a conversation keeps its newest paths only",
      memory: { t1: many(GONE_PICTURE_MEMORY_PATHS, "/p") },
      thread: "t1",
      path: "/new.png",
      gone: true,
      after: { t1: [...many(GONE_PICTURE_MEMORY_PATHS, "/p").slice(1), "/new.png"] },
    },
    {
      case: "the least recent conversation goes first",
      memory: Object.fromEntries(
        many(GONE_PICTURE_MEMORY_THREADS, "t").map((key) => [key, ["/a"]]),
      ),
      thread: "fresh",
      path: "/a",
      gone: true,
      after: Object.fromEntries([
        ...many(GONE_PICTURE_MEMORY_THREADS, "t")
          .slice(1)
          .map((key) => [key, ["/a"]]),
        ["fresh", ["/a"]],
      ]),
    },
  ])("$case", ({ memory, thread, path, gone, after }) => {
    expect(withGonePicture(memory, thread, path, gone)).toEqual(after);
  });

  it("returns the same memory where nothing changes", () => {
    const memory = { t1: ["/s/a.png"] };
    expect(withGonePicture(memory, "t1", "/s/a.png", true)).toBe(memory);
    expect(withGonePicture(memory, "t1", "/s/b.png", false)).toBe(memory);
  });
});
