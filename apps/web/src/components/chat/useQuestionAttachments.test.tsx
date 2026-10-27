// @vitest-environment happy-dom
import { EnvironmentId } from "@t3tools/contracts";
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

import { useQuestionAttachments } from "./useQuestionAttachments";

vi.mock("../../lib/attachmentUploadQueue", () => ({
  useAttachmentUploadStore: () => ({}),
  releaseAttachmentUploads: () => {},
}));

function Question(props: { readonly supported: boolean | null }) {
  const [error, setError] = useState<string | null>(null);
  const attachments = useQuestionAttachments({
    scope: "request-one",
    environmentId: EnvironmentId.make("mate-one"),
    questionId: "question-one",
    supported: props.supported,
    onError: setError,
  });
  return (
    <>
      <button onClick={() => void attachments.add([new File(["hello"], "answer.txt")])}>
        Attach answer
      </button>
      {error && <p role="alert">{error}</p>}
      <p>{attachments.current.length} attachments</p>
    </>
  );
}

beforeEach(() => vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true));
afterEach(() => vi.unstubAllGlobals());

it.each([
  [null, "This Mate's attachment support is still being read. Try again once it is ready."],
  [false, "This Mate cannot take question attachments yet."],
] as const)("explains attachment readiness when support is %s", async (supported, message) => {
  const container = document.createElement("div");
  const root = createRoot(container);
  try {
    await act(async () => root.render(<Question supported={supported} />));
    await act(async () => container.querySelector("button")!.click());
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(message);
    expect(container.textContent).toContain("0 attachments");
  } finally {
    await act(async () => root.unmount());
  }
});
