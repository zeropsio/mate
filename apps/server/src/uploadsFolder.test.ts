// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import { agentAttachmentPath, uploadsFileName } from "./uploadsFolder.ts";

describe("uploadsFileName", () => {
  it.each([
    ["a plain name stays", "spec.pdf", "spec.pdf"],
    ["a folder in the name is dropped", "../../etc/passwd", "passwd"],
    ["a Windows folder too", "C:\\Users\\me\\data.csv", "data.csv"],
    ["a leading dot does not hide it", ".env", "env"],
    ["control characters go", "re\u0000port\n.txt", "report.txt"],
    ["nothing left is a file", "..", "file"],
    ["a long stem is cut, the extension kept", `${"a".repeat(300)}.pdf`, `${"a".repeat(200)}.pdf`],
  ])("%s", (_label, name, expected) => {
    expect(uploadsFileName(name)).toBe(expected);
  });
});

describe("agentAttachmentPath", () => {
  let root: string;
  let attachmentsDir: string;
  let uploadsDir: string;

  beforeEach(() => {
    root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "uploads-folder-"));
    attachmentsDir = NodePath.join(root, "attachments");
    uploadsDir = NodePath.join(root, "uploads");
    NodeFS.mkdirSync(attachmentsDir);
  });

  afterEach(() => {
    NodeFS.rmSync(root, { recursive: true, force: true });
  });

  const stored = (id: string, contents: string) => {
    const path = NodePath.join(attachmentsDir, `${id}.pdf`);
    NodeFS.writeFileSync(path, contents);
    return path;
  };
  const file = (name: string, extra: { source?: { _tag: string } } = {}) => ({
    type: "file",
    name,
    ...extra,
  });

  it("keeps a sent file in the uploads folder under its own name", () => {
    const storedPath = stored("thread-a", "spec v1");
    const path = agentAttachmentPath({ uploadsDir, attachment: file("spec.pdf"), storedPath });
    expect(path).toBe(NodePath.join(uploadsDir, "spec.pdf"));
    expect(NodeFS.readFileSync(path, "utf8")).toBe("spec v1");
  });

  it("gives the same file the same place when it is sent again", () => {
    const storedPath = stored("thread-a", "spec v1");
    const first = agentAttachmentPath({ uploadsDir, attachment: file("spec.pdf"), storedPath });
    const again = agentAttachmentPath({ uploadsDir, attachment: file("spec.pdf"), storedPath });
    expect(again).toBe(first);
    expect(NodeFS.readdirSync(uploadsDir)).toEqual(["spec.pdf"]);
  });

  it("numbers another file of the same name, leaving the first alone", () => {
    const first = stored("thread-a", "spec v1");
    const second = stored("thread-b", "spec v2");
    agentAttachmentPath({ uploadsDir, attachment: file("spec.pdf"), storedPath: first });
    const path = agentAttachmentPath({
      uploadsDir,
      attachment: file("spec.pdf"),
      storedPath: second,
    });
    expect(path).toBe(NodePath.join(uploadsDir, "spec-2.pdf"));
    expect(NodeFS.readFileSync(NodePath.join(uploadsDir, "spec.pdf"), "utf8")).toBe("spec v1");
    expect(NodeFS.readFileSync(path, "utf8")).toBe("spec v2");
  });

  it("keeps the conversation's copy when the agent removes its own", () => {
    const storedPath = stored("thread-a", "spec v1");
    const path = agentAttachmentPath({ uploadsDir, attachment: file("spec.pdf"), storedPath });
    NodeFS.rmSync(path);
    expect(NodeFS.readFileSync(storedPath, "utf8")).toBe("spec v1");
  });

  it.each([
    ["a picture", { type: "image", name: "shot.png" }],
    ["folded clipboard text", file("paste.txt", { source: { _tag: "pasted-text" } })],
  ])("leaves %s where it is stored", (_label, attachment) => {
    const storedPath = stored("thread-a", "x");
    expect(agentAttachmentPath({ uploadsDir, attachment, storedPath })).toBe(storedPath);
    expect(NodeFS.existsSync(uploadsDir)).toBe(false);
  });

  it("falls back to the stored file when it cannot be kept", () => {
    const storedPath = NodePath.join(attachmentsDir, "gone.pdf");
    expect(agentAttachmentPath({ uploadsDir, attachment: file("spec.pdf"), storedPath })).toBe(
      storedPath,
    );
  });
});
