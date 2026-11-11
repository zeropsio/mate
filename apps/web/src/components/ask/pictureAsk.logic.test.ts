import { describe, expect, it } from "vite-plus/test";

import type { ChatMessage } from "~/types";
import {
  parsePictureAsk,
  pictureAnswerName,
  pictureAnswerOf,
  pictureAnswersOf,
  pictureAnswerWords,
  pictureAskSource,
  pictureAsksPassed,
  pictureAskSteps,
} from "./pictureAsk.logic";

const hero = JSON.stringify({
  do: "generate",
  title: "Make the homepage hero",
  why: "The hero is still a grey box.",
  for: "public/images/hero.jpg",
  prompt: "Morning light over a roastery counter",
  shape: "widescreen",
  styleLike: "/srv/shop/public/images/about.jpg",
});
const cutOuts = JSON.stringify({
  do: "edit",
  title: "Cut out the coffee bags",
  for: "public/products/",
  tool: "remove-background",
  pictures: ["/srv/shop/public/products/kenya.jpg", "/srv/shop/public/products/guji.jpg"],
});
const launch = JSON.stringify({
  do: "design",
  title: "Design the link preview",
  for: "public/og.png",
  templates: "coffee shop",
  size: "link-preview",
  startWith: "/srv/shop/shots/home.png",
  words: "Fresh roast at your door.",
});

describe("a Mate's picture ask", () => {
  it.each([
    ["a picture from words, with its shape and a picture to match", hero, "generate", 1],
    ["pictures to edit, one press each", cutOuts, "edit", 2],
    ["a design on a canvas, starting from a screenshot", launch, "design", 1],
  ])("sets up %s", (_, source, kind, steps) => {
    const ask = parsePictureAsk(source);
    expect(ask?.kind).toBe(kind);
    expect(pictureAskSteps(ask!)).toBe(steps);
  });

  it.each([
    ["words that are not JSON", "make me a hero"],
    ["an ask with no title", JSON.stringify({ do: "generate", prompt: "x" })],
    ["a picture with no prompt", JSON.stringify({ do: "generate", title: "Hero" })],
    [
      "an edit with a tool Adobe lacks",
      JSON.stringify({ do: "edit", title: "Fix", tool: "teleport", pictures: ["/a.jpg"] }),
    ],
    [
      "an edit with no pictures",
      JSON.stringify({ do: "edit", title: "Fix", tool: "erase", pictures: [] }),
    ],
    ["something else to do", JSON.stringify({ do: "dance", title: "Dance" })],
  ])("sets up nothing from %s", (_, source) => {
    expect(parsePictureAsk(source)).toBeNull();
  });

  it.each([
    ["link-preview", "link-preview"],
    ["logo", "logo"],
    ["instagram-post", undefined],
  ])("makes a design at the size of the place it goes in the app (%s)", (size, canvas) => {
    const ask = parsePictureAsk(JSON.stringify({ ...JSON.parse(launch), size }));
    expect(ask?.kind === "design" ? ask.canvas : null).toBe(canvas);
  });

  it("starts each step from its own picture", () => {
    const edit = parsePictureAsk(cutOuts)!;
    expect(pictureAskSource(edit, 1)).toBe("/srv/shop/public/products/guji.jpg");
    expect(pictureAskSource(parsePictureAsk(hero)!, 0)).toBe("/srv/shop/public/images/about.jpg");
  });

  it("is the same ask each time the conversation is read", () => {
    expect(parsePictureAsk(hero)?.key).toBe(parsePictureAsk(`\n${hero}\n`)?.key);
    expect(parsePictureAsk(hero)?.key).not.toBe(parsePictureAsk(launch)?.key);
  });
});

describe("an answer to a picture ask", () => {
  it("tells the Mate what came back, where it goes and what it came from", () => {
    const ask = parsePictureAsk(hero)!;
    expect(
      pictureAnswerWords(ask, 0, {
        kind: "express",
        prompt: "Morning light over a roastery counter",
      }),
    ).toBe(
      "Here's the picture for “Make the homepage hero” from Adobe Express. It goes to public/images/hero.jpg.",
    );
    expect(pictureAnswerWords(ask, 0, { kind: "express", prompt: "A roastery at dusk" })).toContain(
      "I changed the prompt to: A roastery at dusk",
    );
    expect(pictureAnswerWords(ask, 0, { kind: "upload" })).toBe(
      "Here's the picture for “Make the homepage hero”. It goes to public/images/hero.jpg.",
    );
    expect(pictureAnswerWords(parsePictureAsk(cutOuts)!, 1, { kind: "upload" })).toBe(
      "Here's guji.jpg, edited: remove the background (2 of 2). Its source is /srv/shop/public/products/guji.jpg. It goes to public/products/.",
    );
  });

  it("counts a step answered once the person sent its picture, after a reload too", () => {
    const ask = parsePictureAsk(cutOuts)!;
    const name = pictureAnswerName(ask.key, 1, "adobe-express-1.png");
    expect(pictureAnswerOf(name)).toEqual({ key: ask.key, step: 1 });
    expect(pictureAnswerOf("adobe-express-1.png")).toBeNull();
    const messages = [
      { role: "user", attachments: [{ type: "image", id: "a", name }] },
      { role: "user", attachments: [{ type: "image", id: "b", name: "photo.png" }] },
    ] as unknown as ReadonlyArray<ChatMessage>;
    expect([...(pictureAnswersOf(messages).get(ask.key) ?? [])]).toEqual([1]);
  });
});

describe("a picture ask the conversation moved past", () => {
  const asking = (source: string) => ({
    role: "assistant",
    text: `One press and it's set up.\n\n\`\`\`picture-ask\n${source}\n\`\`\``,
  });
  const answering = (source: string, step: number) => ({
    role: "user",
    text: "Here it is.",
    attachments: [
      {
        type: "image",
        id: `a${step}`,
        name: pictureAnswerName(parsePictureAsk(source)!.key, step, "x.png"),
      },
    ],
  });
  const writing = { role: "user", text: "Make the menu bar darker instead." };

  it.each([
    ["ends once the person writes about something else", [asking(cutOuts), writing], true],
    ["stays open while the person has not written since", [asking(cutOuts)], false],
    [
      "stays open while the person answers it one picture at a time",
      [asking(cutOuts), answering(cutOuts, 0)],
      false,
    ],
    [
      "ends once the person answers a picture, then writes about something else",
      [asking(cutOuts), answering(cutOuts, 0), writing],
      true,
    ],
  ])("%s", (_, messages, ended) => {
    const passed = pictureAsksPassed(messages as unknown as ReadonlyArray<ChatMessage>);
    expect(passed.has(parsePictureAsk(cutOuts)!.key)).toBe(ended);
  });
});
