import type { ChatAttachment, ThreadCrewOrigin } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { crewSnapshotFixture } from "@t3tools/client-runtime/zerops/crew/testing/fixtures";
import { deriveCrewView } from "@t3tools/client-runtime/zerops/projections/crew";

import { crewComposerMentions, crewMessageCommand } from "./crewComposerSend";

const ATTACHMENTS: ReadonlyArray<ChatAttachment> = [
  {
    type: "image",
    id: "upload-1",
    name: "hud.png",
    mimeType: "image/png",
    sizeBytes: 1024,
  },
];

const BACKEND: ThreadCrewOrigin = { crew: "shop", crewmate: "backend", stint: 2 };

describe("crewMessageCommand", () => {
  it.each<{
    readonly name: string;
    readonly shell: Parameters<typeof crewMessageCommand>[0];
    readonly command: ReturnType<typeof crewMessageCommand>;
  }>([
    {
      name: "a crewmate's chat sends through the crew engine, addressed by handle",
      shell: { crew: BACKEND },
      command: {
        _tag: "message",
        handle: "backend",
        text: "Keep ?offset working for one more release.",
        attachments: ATTACHMENTS,
      },
    },
    { name: "a person's chat keeps its own turn", shell: {}, command: null },
    {
      name: "a thread without a crew origin keeps its own turn",
      shell: { crew: null },
      command: null,
    },
    { name: "a draft not on the server yet keeps its own turn", shell: undefined, command: null },
  ])("$name", ({ shell, command }) => {
    expect(
      crewMessageCommand(shell, {
        text: "Keep ?offset working for one more release.",
        attachments: ATTACHMENTS,
      }),
    ).toEqual(command);
  });
});

describe("crewComposerMentions", () => {
  const snapshot = crewSnapshotFixture();
  const view = deriveCrewView(snapshot, [], () => {
    throw new Error("no shells here");
  });
  const row = (handle: string) =>
    view.crewmates.find(({ crewmate }) => crewmate.handle === handle)!;

  it.each<{
    readonly name: string;
    readonly row: Parameters<typeof crewComposerMentions>[0];
    readonly offered: ReadonlyArray<string> | undefined;
  }>([
    {
      name: "the lead's chat offers the other crewmates on @",
      row: row("lead"),
      offered: ["backend", "frontend", "erik"],
    },
    { name: "a crewmate's chat offers none", row: row("backend"), offered: undefined },
    { name: "a person's chat offers none", row: null, offered: undefined },
  ])("$name", ({ row: chat, offered }) => {
    expect(crewComposerMentions(chat, snapshot.crewmates)?.map((mate) => mate.handle)).toEqual(
      offered,
    );
  });
});
