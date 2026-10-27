// @vitest-environment happy-dom
import { ProjectId, type ProjectCloneSnapshot } from "@t3tools/contracts";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { cloneSendBlockReason, ComposerCloneAsk } from "./ComposerCloneAsk";

vi.mock("~/zerops/useZeropsMates", () => ({ useKnownMate: () => undefined }));

let root: Root | undefined;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  root = createRoot(document.body.appendChild(document.createElement("div")));
});

afterEach(async () => {
  await act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

const LONG_ERROR =
  "fatal: unable to access 'https://github.com/acme/acme-shop.git/': The requested URL returned error: 403 — the token used for this clone has no read access to the repository, ask its owner for access or sign in again";

const clone = (phase: ProjectCloneSnapshot["phase"]): ProjectCloneSnapshot =>
  ({
    projectId: ProjectId.make("project-1"),
    destinationPath: "/home/zerops/acme-shop",
    repository: null,
    phase,
    stage: "receiving",
    percent: 45,
    detail: null,
    error: phase === "failed" ? LONG_ERROR : null,
  }) as unknown as ProjectCloneSnapshot;

// Cloning stops nothing but Send: it stands at the composer's top, the composer stays.
describe("a repository cloning", () => {
  it.each([
    {
      phase: "running" as const,
      says: "Cloning the repository…acme-shop · Receiving objects · 45%",
      buttons: { Cancel: "cancel" },
      send: "Sends once the repository is cloned",
    },
    {
      phase: "failed" as const,
      says: `Failed to clone acme-shop${LONG_ERROR}`,
      buttons: { "Remove project": "remove", Retry: "retry" },
      send: "The repository isn't cloned: retry the clone to send",
    },
    {
      phase: "cancelled" as const,
      says: "Cancelled cloning acme-shopRetry to bring in the repository.",
      buttons: { "Remove project": "remove", Retry: "retry" },
      send: "The repository isn't cloned: retry the clone to send",
    },
  ])(
    "says the $phase clone whole at the composer's top, offers its way on, and holds Send",
    async ({ phase, says, buttons, send }) => {
      const ran: string[] = [];
      await act(() =>
        root!.render(
          <ComposerCloneAsk
            actions={{
              cancel: () => ran.push("cancel"),
              retry: () => ran.push("retry"),
              remove: () => ran.push("remove"),
            }}
            clone={clone(phase)}
          />,
        ),
      );
      const section = document.querySelector('[data-composer-top="clone"]')!;
      expect(section.textContent).toBe(`${says}${Object.keys(buttons).join("")}`);
      for (const button of section.querySelectorAll("button")) {
        await act(() => button.click());
      }
      expect(ran).toEqual(Object.values(buttons));
      expect(cloneSendBlockReason(clone(phase))).toBe(send);
    },
  );

  it.each([{ clone: null }, { clone: clone("done") }])(
    "says nothing and holds nothing once there is no clone to wait on",
    async ({ clone }) => {
      await act(() =>
        root!.render(
          <ComposerCloneAsk actions={{ cancel() {}, retry() {}, remove() {} }} clone={clone} />,
        ),
      );
      expect(document.body.textContent).toBe("");
      expect(cloneSendBlockReason(clone)).toBeNull();
    },
  );
});
