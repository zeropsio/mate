import {
  makeConnectionAdmission,
  type ConnectionAdmission,
} from "@t3tools/client-runtime/connection";
import { EnvironmentId } from "@t3tools/contracts";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { TestNode } from "./__fixtures__/testDom";
import { usePreferredConnection } from "./mateConnectionPreference";

const ENV = EnvironmentId.make("env-coming");

function Page(props: {
  readonly environmentId: EnvironmentId | null;
  readonly admission: Pick<ConnectionAdmission, "hold">;
}) {
  usePreferredConnection(props.environmentId, props.admission);
  return null;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("a Mate coming up is the one whose socket goes first", () => {
  it("holds its environment once known, and leaving keeps the route a conversation named", () => {
    const document = new TestNode("#document", null, 9);
    vi.stubGlobal("document", document);
    vi.stubGlobal("window", {
      document,
      HTMLIFrameElement: TestNode,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    });
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const admission = makeConnectionAdmission();
    const root = createRoot(document.createElement("div") as unknown as Element);
    act(() => root.render(<Page environmentId={null} admission={admission} />));
    act(() => root.render(<Page environmentId={ENV} admission={admission} />));
    expect(admission.preferred()).toBe(ENV);
    // The hand-over: the conversation's route names the same Mate before the page leaves.
    admission.prefer(ENV);
    act(() => root.unmount());
    expect(admission.preferred()).toBe(ENV);
    admission.prefer(null);
    expect(admission.preferred()).toBeNull();
  });
});
