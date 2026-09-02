import { Children, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

import { ZEROPS_AGENT_TYPE_CANONICAL_ORDER } from "@t3tools/client-runtime/zerops";

import {
  ZEROPS_NEW_PROJECT_AGENTS_DEFAULT_SELECTION,
  ZeropsNewProjectAgents,
} from "./ZeropsNewProjectAgents";

const noop = () => undefined;

type RowProps = {
  readonly children?: ReactNode;
  readonly onClick?: () => void;
};

function findRow(node: ReactNode, agentType: string): ReactElement<RowProps> {
  if (isValidElement<RowProps & Record<string, unknown>>(node)) {
    if (node.props["data-zerops-agent-row"] === agentType && node.props.onClick !== undefined) {
      return node as ReactElement<RowProps>;
    }
    if (typeof node.type === "function") {
      const renderComponent = node.type as (props: unknown) => ReactNode;
      const rendered = renderComponent(node.props);
      try {
        return findRow(rendered, agentType);
      } catch {
        // Continue into the element's declared children below.
      }
    }
    for (const child of Children.toArray(node.props.children)) {
      try {
        return findRow(child, agentType);
      } catch {
        // Keep searching sibling nodes.
      }
    }
  }
  if (Array.isArray(node)) {
    for (const child of node) {
      try {
        return findRow(child, agentType);
      } catch {
        // Keep searching sibling nodes.
      }
    }
  }
  throw new Error(`Row not found: ${agentType}`);
}

describe("ZeropsNewProjectAgents", () => {
  it("renders every agent in the canonical order", () => {
    const markup = renderToStaticMarkup(
      <ZeropsNewProjectAgents
        selected={ZEROPS_NEW_PROJECT_AGENTS_DEFAULT_SELECTION}
        onChange={noop}
      />,
    );

    const positions = ZEROPS_AGENT_TYPE_CANONICAL_ORDER.map((agentType) =>
      markup.indexOf(`data-zerops-agent-row="${agentType}"`),
    );
    for (const position of positions) {
      expect(position).toBeGreaterThanOrEqual(0);
    }
    for (let index = 1; index < positions.length; index++) {
      expect(positions[index]).toBeGreaterThan(positions[index - 1] as number);
    }
  });

  it("adds an unselected agent to the selection without mutating the input array", () => {
    const onChange = vi.fn();
    const selected = ["claude-code"] as const;

    const row = findRow(ZeropsNewProjectAgents({ selected, onChange, disabled: false }), "codex");
    row.props.onClick?.();

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(["claude-code", "codex"]);
    expect(selected).toEqual(["claude-code"]);
  });

  it("removes a selected agent from the selection without mutating the input array", () => {
    const onChange = vi.fn();
    const selected = ["claude-code", "codex"] as const;

    const row = findRow(
      ZeropsNewProjectAgents({ selected, onChange, disabled: false }),
      "claude-code",
    );
    row.props.onClick?.();

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(["codex"]);
    expect(selected).toEqual(["claude-code", "codex"]);
  });

  it("marks the different sign-in phrase only for agents outside ZeropsAgentId", () => {
    const markup = renderToStaticMarkup(
      <ZeropsNewProjectAgents
        selected={ZEROPS_NEW_PROJECT_AGENTS_DEFAULT_SELECTION}
        onChange={noop}
      />,
    );

    const claudeCodeRow = markup.slice(
      markup.indexOf('data-zerops-agent-row="claude-code"'),
      markup.indexOf('data-zerops-agent-row="codex"'),
    );
    const codexRow = markup.slice(
      markup.indexOf('data-zerops-agent-row="codex"'),
      markup.indexOf('data-zerops-agent-row="antigravity"'),
    );
    const antigravityRow = markup.slice(
      markup.indexOf('data-zerops-agent-row="antigravity"'),
      markup.indexOf('data-zerops-agent-row="grok"'),
    );
    const grokRow = markup.slice(
      markup.indexOf('data-zerops-agent-row="grok"'),
      markup.indexOf('data-zerops-agent-row="cursor"'),
    );
    const cursorRow = markup.slice(markup.indexOf('data-zerops-agent-row="cursor"'));

    expect(claudeCodeRow).not.toContain("container&#x27;s terminal");
    expect(codexRow).not.toContain("container&#x27;s terminal");
    expect(antigravityRow).toContain("container&#x27;s terminal");
    expect(grokRow).toContain("container&#x27;s terminal");
    expect(cursorRow).toContain("container&#x27;s terminal");
  });

  it("defaults the selection to claude-code alone", () => {
    expect(ZEROPS_NEW_PROJECT_AGENTS_DEFAULT_SELECTION).toEqual(["claude-code"]);
  });
});
