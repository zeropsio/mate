// @vitest-environment happy-dom
import type { ZeropsProposal } from "@t3tools/client-runtime/zerops/model";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { MateFaceAsMark } from "../primitives";
import { ProposalCard, type ProposalCardProps } from "./ProposalCard";
import type { ProposalStage } from "./proposal.logic";

let root: Root | undefined;

afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

const restart: ZeropsProposal = {
  id: "p1",
  kind: "service.restart",
  summary: "Restart medusa in Contoso",
  reason: "It stopped answering an hour ago.",
  projectId: "p-contoso",
  projectName: "Contoso",
  serviceId: "s-medusa",
  serviceName: "medusa",
};

const secret: ZeropsProposal = {
  id: "p2",
  kind: "env.set",
  summary: "Set STRIPE_KEY in Contoso",
  projectId: "p-contoso",
  params: { scope: "project", key: "STRIPE_KEY", value: "sk_live_secret", secret: true },
};

const message: ZeropsProposal = {
  id: "p3",
  kind: "mate.message",
  summary: "Ask Rossy to debug the checkout",
  params: {
    to: { projectId: "p-shop", mateName: "Rossy" },
    words: "These prod logs show checkout failing.",
    attachment: { title: "prod · api · last 40 lines", text: "ERR 500 /checkout" },
  },
};

const askChief: ZeropsProposal = {
  id: "p4",
  kind: "chief.message",
  summary: "Ask your Chief who owns orders",
  projectId: "p-shop",
  projectName: "Shop",
  params: {
    words: "Which project owns the orders table?",
    attachment: { title: "schema diff", text: "ALTER TABLE orders" },
  },
};

async function mount(over: Partial<ProposalCardProps> & { readonly proposal: ZeropsProposal }) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  const pressed: string[] = [];
  await act(async () =>
    root?.render(
      // A Chief's conversation: every face in it is the mark.
      <MateFaceAsMark value>
        <ProposalCard
          mateName="Fen"
          chiefTarget={
            over.proposal.kind === "chief.message"
              ? { kind: "chief", projectId: "chief-project" }
              : undefined
          }
          onApprove={() => pressed.push("approve")}
          onDecline={() => pressed.push("decline")}
          stage="open"
          {...over}
        />
      </MateFaceAsMark>,
    ),
  );
  return { container, pressed };
}

const buttons = (container: HTMLElement) =>
  [...container.querySelectorAll("button")].map((button) => button.textContent);

describe("ProposalCard", () => {
  it("titles itself by the summary and quotes the Mate's reason", async () => {
    const { container } = await mount({ proposal: restart });
    expect(container.textContent).toContain("Restart medusa in Contoso");
    expect(container.querySelector("q")?.textContent).toBe("It stopped answering an hour ago.");
    expect(container.textContent).toContain("Fen: It stopped");
    expect(container.textContent).toContain("medusa · Contoso");
  });

  it.each<[ProposalStage, ReadonlyArray<string>]>([
    ["open", ["Approve", "Decline"]],
    ["running", []],
    ["unseen", []],
    ["done", []],
    ["failed", []],
    ["declined", []],
  ])("offers Approve and Decline only while undecided: %s", async (stage, offered) => {
    const { container } = await mount({ proposal: restart, stage });
    expect(buttons(container)).toEqual(offered);
  });

  it("an approval runs only on the person's press", async () => {
    const { container, pressed } = await mount({ proposal: restart });
    await act(async () => container.querySelector("button")?.click());
    expect(pressed).toEqual(["approve"]);
  });

  it("never draws a secret value: it says the value is hidden", async () => {
    const { container } = await mount({ proposal: secret });
    expect(container.textContent).toContain("STRIPE_KEY");
    expect(container.textContent).not.toContain("sk_live_secret");
    expect(container.textContent).toContain("hidden");
  });

  it("a failed approval says the platform's words", async () => {
    const { container } = await mount({
      proposal: restart,
      stage: "failed",
      failure: "Service stack is not running.",
    });
    expect(container.querySelector("[role=alert]")?.textContent).toBe(
      "Service stack is not running.",
    );
  });

  it("a message's Mate wears its own face where every other face is the mark", async () => {
    const { container } = await mount({
      proposal: message,
      recipient: { name: "Rossy", tint: "coral", shape: "squircle" },
    });
    const face = container.querySelector("[data-proposal-recipient] [data-mate-face-tint]");
    expect(face?.getAttribute("data-mate-face-tint")).toBe("coral");
    expect(container.textContent).toContain("These prod logs show checkout failing.");
  });

  it("keeps a message's attachment folded until the person opens it", async () => {
    const { container } = await mount({ proposal: message });
    expect(container.textContent).not.toContain("ERR 500 /checkout");
    const fold = [...container.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("prod · api · last 40 lines"),
    );
    await act(async () => fold?.click());
    expect(container.textContent).toContain("ERR 500 /checkout");
  });

  it("a sent message says where it went and opens that Mate", async () => {
    let opened = 0;
    const { container } = await mount({
      proposal: message,
      stage: "done",
      onOpenRecipient: () => {
        opened += 1;
      },
    });
    expect(container.textContent).toContain("Sent to Rossy.");
    const open = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Open Rossy",
    );
    await act(async () => open?.click());
    expect(opened).toBe(1);
  });

  it("an ask of the Chief says it goes to your Chief, quoting the words and what it hands along", async () => {
    const { container } = await mount({ proposal: askChief });
    expect(container.textContent).toContain("Ask your Chief");
    expect(container.querySelector("[data-proposal-words]")?.textContent).toBe(
      "Which project owns the orders table?",
    );
    expect(container.textContent).toContain("schema diff");
  });

  it("an ask of the Chief offers to set one up in place of Approve where the person has none", async () => {
    const setUp: string[] = [];
    const { container } = await mount({
      proposal: askChief,
      chiefTarget: { kind: "none" },
      onSetUpChief: () => setUp.push("set up"),
    });
    expect(buttons(container)).toEqual(["schema diff", "Set up your Chief", "Decline"]);
    const offer = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Set up your Chief",
    );
    await act(async () => offer?.click());
    expect(setUp).toEqual(["set up"]);
  });

  it("a reader who is not the Chief's person sees no Approve or Decline", async () => {
    const { container } = await mount({
      proposal: askChief,
      readOnlyReason: "Only this Mate's person can ask their Chief.",
    });
    expect(buttons(container)).toEqual(["schema diff"]);
    expect(container.textContent).toContain("Only this Mate's person can ask their Chief.");
  });

  it("an ask sent to the Chief opens it", async () => {
    const opened: string[] = [];
    const { container } = await mount({
      proposal: askChief,
      stage: "done",
      onOpenRecipient: () => opened.push("chief"),
    });
    expect(container.textContent).toContain("Sent to your Chief.");
    const open = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Open Chief",
    );
    await act(async () => open?.click());
    expect(opened).toEqual(["chief"]);
  });
});
