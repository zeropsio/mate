import { expect, it } from "vite-plus/test";
import type { ChatFileAttachment, ChatImageAttachment } from "@t3tools/contracts";
import { opened, play, prepared } from "../testing/scene.ts";

const picture = {
  type: "image",
  id: "img-1",
  name: "screen.png",
  mimeType: "image/png",
  sizeBytes: 2048,
  asset: {
    id: "occ-1",
    threadId: "mate",
    ownerId: "mate/r/1/i/1",
    name: "screen.png",
    provenance: "upload",
    original: {
      status: "ready",
      digest: "a".repeat(64),
      mimeType: "image/png",
      sizeBytes: 2048,
    },
  },
} as unknown as ChatImageAttachment;
const file = {
  type: "file",
  id: "file-1",
  name: "notes.pdf",
  mimeType: "application/pdf",
  sizeBytes: 4096,
} as unknown as ChatFileAttachment;

// witness: apps/server/src/engine/domain/decide.runs.ts | (attachment) => attachment.type === "image" || attachment.type === "file", → (attachment) => attachment.type === "image",
it("ED74: A message's pictures and files are in its record and in its send, by their asset reference and by the id they were uploaded under", () => {
  const rows = [
    { text: "look", attachment: picture },
    { text: "read this", attachment: file },
  ];
  for (const { text, attachment } of rows) {
    const queued = play([{ _tag: "Send", text, attachments: [attachment] }]);
    expect(queued.events[1]).toMatchObject({
      body: { kind: "person", attachments: [attachment] },
    });
    const sending = play([
      { _tag: "Send", text, attachments: [attachment] },
      prepared(1),
      opened(1),
    ]);
    expect(sending.effects[0]).toMatchObject({
      kind: "provider.send",
      payload: { attachments: [attachment] },
    });
  }
});

// witness: apps/server/src/engine/domain/decide.ts | if (command.text.trim() === "" && attachments.length === 0) throw new Rejected("empty-message"); → if (command.text.trim() === "" && attachments.length >= 0) throw new Rejected("empty-message");
it("ED75: A message of pictures alone is not empty", () => {
  expect(play([{ _tag: "Send", text: " ", attachments: [picture] }]).decision._tag).toBe("Accept");
});
