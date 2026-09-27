import type { ChatAttachment, ThreadCrewOrigin } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { crewMessageCommand } from "./crewComposerSend";

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
