import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { ComposerStashMenu } from "./ComposerStashMenu";

describe("ComposerStashMenu", () => {
  it("renders saved prompts as an attached composer drawer", () => {
    const markup = renderToStaticMarkup(
      <ComposerStashMenu
        entries={[]}
        onRestore={() => {}}
        onDelete={() => {}}
        onClose={() => {}}
      />,
    );

    expect(markup).toContain('data-composer-stash-drawer="true"');
    expect(markup).toContain("chat-composer-drawer-surface");
    expect(markup).toContain("chat-composer-drawer-attached");
    expect(markup).toContain('aria-label="Close stash"');
    expect(markup).not.toContain("dropdown-glass");
    expect(markup).not.toContain("Stashed prompts");
  });

  it.each([
    ["words around a picture show without its place", "\uFFFBCompare\uFFFB these", "Compare these"],
    ["a picture alone shows as a picture", "\uFFFB", "(1 image)"],
  ])("quotes a stashed prompt: %s", (_label, prompt, expected) => {
    const markup = renderToStaticMarkup(
      <ComposerStashMenu
        entries={[
          {
            id: "with-a-picture",
            createdAt: new Date(0).toISOString(),
            prompt,
            attachments: [
              {
                id: "picture-one",
                name: "shot.png",
                mimeType: "image/png",
                sizeBytes: 128,
                dataUrl: "data:image/png;base64,AA==",
              },
            ],
            droppedImageNames: [],
            unreadableImageNames: [],
            pendingImageCount: 0,
          },
        ]}
        onRestore={() => {}}
        onDelete={() => {}}
        onClose={() => {}}
      />,
    );
    expect(markup).toContain(expected);
    expect(markup).not.toContain("\uFFFB");
  });

  it("shows saved image thumbnails and incomplete image states", () => {
    const markup = renderToStaticMarkup(
      <ComposerStashMenu
        entries={[
          {
            id: "with-images",
            createdAt: new Date(0).toISOString(),
            prompt: "Compare these screenshots",
            attachments: [
              {
                id: "image-one",
                name: "before.png",
                mimeType: "image/png",
                sizeBytes: 128,
                dataUrl: "data:image/png;base64,AA==",
              },
            ],
            droppedImageNames: ["after.png"],
            unreadableImageNames: [],
            pendingImageCount: 0,
          },
          {
            id: "saving-images",
            createdAt: new Date(0).toISOString(),
            prompt: "Save this image",
            attachments: [],
            droppedImageNames: [],
            unreadableImageNames: [],
            pendingImageCount: 1,
          },
        ]}
        onRestore={() => {}}
        onDelete={() => {}}
        onClose={() => {}}
      />,
    );

    expect(markup).toContain('src="data:image/png;base64,AA=="');
    expect(markup).toContain("1 image dropped");
    expect(markup).toContain("saving 1 image");
    expect(markup).not.toContain("absolute top-1/2 right-2");
    expect(markup).toContain("pointer-events-none");

    expect(markup).toContain("[--control-icon-color:currentColor]");
  });
});
