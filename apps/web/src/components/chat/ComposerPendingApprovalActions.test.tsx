import { ApprovalRequestId } from "@t3tools/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const buttonState = vi.hoisted(() => ({
  actions: [] as Array<{
    readonly decision: string;
    readonly onClick: () => void;
    readonly tone: string;
    readonly variant: string;
  }>,
}));

vi.mock("../ui/button", () => ({
  Button: ({
    children,
    className,
    "data-approval-action-tone": tone,
    "data-approval-decision": decision,
    disabled,
    onClick,
    variant,
  }: {
    readonly children: unknown;
    readonly className?: string;
    readonly "data-approval-action-tone": string;
    readonly "data-approval-decision": string;
    readonly disabled?: boolean;
    readonly onClick: (event: never) => void;
    readonly size: string;
    readonly variant: string;
  }) => {
    buttonState.actions.push({
      decision,
      onClick: () => onClick(undefined as never),
      tone,
      variant,
    });
    return (
      <button
        className={className}
        data-approval-action-tone={tone}
        data-approval-decision={decision}
        disabled={disabled}
      >
        {children as string}
      </button>
    );
  },
}));

import { ComposerPendingApprovalActions } from "./ComposerPendingApprovalActions";

describe("ComposerPendingApprovalActions", () => {
  beforeEach(() => {
    buttonState.actions.length = 0;
  });

  it("makes one-shot accept primary without changing advertised decisions", () => {
    const requestId = ApprovalRequestId.make("approval-hierarchy");
    const respond = vi.fn(async () => undefined);

    renderToStaticMarkup(
      <ComposerPendingApprovalActions
        requestId={requestId}
        isResponding={false}
        options={[
          { decision: "cancel", label: "Cancel" },
          { decision: "acceptForSession", label: "Allow for this session" },
          { decision: "decline", label: "Decline" },
          { decision: "accept", label: "Approve once" },
        ]}
        onRespondToApproval={respond}
      />,
    );

    expect(
      buttonState.actions.map(({ decision, tone, variant }) => ({ decision, tone, variant })),
    ).toEqual([
      { decision: "cancel", tone: "quiet", variant: "ghost-muted" },
      { decision: "acceptForSession", tone: "secondary", variant: "secondary" },
      { decision: "decline", tone: "quiet", variant: "ghost-muted" },
      { decision: "accept", tone: "primary", variant: "pill" },
    ]);

    for (const action of buttonState.actions) {
      action.onClick();
    }
    expect(respond.mock.calls).toEqual([
      [requestId, "cancel"],
      [requestId, "acceptForSession"],
      [requestId, "decline"],
      [requestId, "accept"],
    ]);
  });

  it("states that the persistent approval lasts for this session", () => {
    const markup = renderToStaticMarkup(
      <ComposerPendingApprovalActions
        requestId={ApprovalRequestId.make("approval-1")}
        isResponding={false}
        onRespondToApproval={async () => undefined}
      />,
    );

    expect(markup).toContain(">Cancel<");
    expect(markup).toContain("Always allow this session");
    expect(markup).not.toContain(">Always allow<");
    expect(markup).toContain("min-h-7");
    expect(markup).toContain('data-approval-action-tone="primary"');
    expect(markup).toContain('data-approval-action-tone="secondary"');
  });

  it("shows only the approval choices advertised by an MCP server", () => {
    const markup = renderToStaticMarkup(
      <ComposerPendingApprovalActions
        requestId={ApprovalRequestId.make("approval-safari")}
        isResponding={false}
        options={[
          { decision: "decline", label: "Decline" },
          { decision: "acceptAlways", label: "Always allow Safari" },
          { decision: "accept", label: "Approve" },
        ]}
        onRespondToApproval={async () => undefined}
      />,
    );

    expect(markup).toContain("Always allow Safari");
    expect(markup).toContain(">Approve<");
    expect(markup).not.toContain("Always allow this session");
    expect(buttonState.actions.find(({ decision }) => decision === "acceptAlways")).toMatchObject({
      tone: "secondary",
      variant: "secondary",
    });
  });

  it("marks an option that carries a provider warning", () => {
    const markup = renderToStaticMarkup(
      <ComposerPendingApprovalActions
        requestId={ApprovalRequestId.make("approval-1")}
        isResponding={false}
        options={[
          { decision: "accept", label: "Allow once" },
          {
            decision: "acceptForSession",
            label: "Allow for this thread",
            warning: "Untrusted files could re-run this action without asking.",
          },
          { decision: "decline", label: "Deny" },
        ]}
        onRespondToApproval={async () => undefined}
      />,
    );

    expect(markup).toContain(
      'aria-description="Untrusted files could re-run this action without asking."',
    );
    expect(markup).toContain("text-warning");
    expect(markup).toContain("Allow for this thread");
  });

  it("wraps provider-supplied approval labels without hiding their text", () => {
    const label = "Allow ".repeat(40).trim();
    const markup = renderToStaticMarkup(
      <ComposerPendingApprovalActions
        requestId={ApprovalRequestId.make("approval-long-label")}
        isResponding={false}
        options={[{ decision: "acceptAlways", label }]}
        onRespondToApproval={async () => undefined}
      />,
    );

    expect(markup).toContain("max-w-48 whitespace-normal break-words text-center");
    expect(markup).not.toContain("truncate");
    expect(markup).toContain(label);
  });
});
