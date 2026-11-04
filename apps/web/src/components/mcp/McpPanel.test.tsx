import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { McpPanelBody, MCP_WORDS } from "./McpPanel";
import { MCP_TAB_START, type McpTabState } from "./McpServers.logic";
import { CLAUDE, MCP_SERVERS_FIXTURE } from "./mcpServersFixture";

const render = (state: McpTabState, extra: Partial<Parameters<typeof McpPanelBody>[0]> = {}) =>
  renderToStaticMarkup(
    <McpPanelBody
      act={async () => ({ ok: true })}
      driver={CLAUDE}
      mateName="Juno"
      onRetry={() => undefined}
      signIn={async () => ({ ok: false, message: "" })}
      state={state}
      {...extra}
    />,
  ).replaceAll("&#x27;", "'");

const groupOf = (html: string, group: string) =>
  [...html.matchAll(new RegExp(`data-mcp-group="${group}" data-mcp-server="([^"]+)"`, "gu"))].map(
    (match) => match[1],
  );

describe("McpPanelBody — what the Tools tab shows", () => {
  it("groups the tools by what needs you: waiting on you, then ready, then off", () => {
    const html = render({ ...MCP_TAB_START, list: MCP_SERVERS_FIXTURE });
    expect(groupOf(html, "waiting")).toEqual(["github", "postgres"]);
    expect(groupOf(html, "ready")).toEqual(["zerops", "playwright", "linear", "context7"]);
    expect(groupOf(html, "off")).toEqual(["sentry"]);
    expect(html.indexOf(MCP_WORDS.groups.waiting)).toBeLessThan(
      html.indexOf(MCP_WORDS.groups.ready),
    );
    expect(html.indexOf(MCP_WORDS.groups.ready)).toBeLessThan(html.indexOf(MCP_WORDS.groups.off));
  });

  it("a row's right column holds its one action when it needs you, else its state", () => {
    const html = render({ ...MCP_TAB_START, list: MCP_SERVERS_FIXTURE });
    const right = (name: string) =>
      html
        .split(`data-mcp-server="${name}"`)[1]!
        .split("data-mcp-right")[1]!
        .split("</span></span>")[0]!;
    expect(right("github")).toContain(MCP_WORDS.signIn);
    expect(right("postgres")).toContain(MCP_WORDS.tryAgain);
    expect(right("zerops")).toContain("2 tools");
    expect(right("sentry")).toContain("Off");
  });

  it("the Mate's proposal waits on you with Review, named as the Mate's", () => {
    const html = render(
      { ...MCP_TAB_START, list: MCP_SERVERS_FIXTURE },
      {
        proposals: [
          { id: "p1", name: "notion", reason: "To read the product notes", card: <p>card</p> },
        ],
      },
    );
    expect(html).toContain('data-mcp-proposal="p1"');
    expect(html).toContain("Proposed by Juno");
    expect(html).toContain(MCP_WORDS.review);
    expect(html.indexOf('data-mcp-proposal="p1"')).toBeLessThan(
      html.indexOf('data-mcp-server="github"'),
    );
  });

  it("a Mate too old to sign in from the tab says it needs an update, offering no Sign in or Edit", () => {
    const html = render({ ...MCP_TAB_START, list: MCP_SERVERS_FIXTURE }, { mateCanSignIn: false });
    const github = html.split('data-mcp-server="github"')[1]!.split("</li>")[0]!;
    expect(github).toContain(MCP_WORDS.needsUpdate);
    expect(github).toContain(MCP_WORDS.updateToSignIn);
    expect(github).not.toContain(`>${MCP_WORDS.signIn}<`);
  });

  it("paints nothing but its heading while the first read is out", () => {
    const html = render({ ...MCP_TAB_START, busy: true, inFlight: [1] });
    expect(html).toContain('data-mcp-busy="true"');
    expect(html).not.toContain("data-mcp-server");
    expect(html).not.toContain("data-mcp-add");
    expect(html).not.toContain(MCP_WORDS.none);
  });

  it("says why a read failed, and keeps the list it had", () => {
    const first = render({ ...MCP_TAB_START, error: "Not built yet." });
    expect(first).toContain(`${MCP_WORDS.readFailed} Not built yet.`);
    expect(first).toContain(MCP_WORDS.tryAgain);
    expect(first).not.toContain("data-mcp-server");

    const later = render({ ...MCP_TAB_START, list: MCP_SERVERS_FIXTURE, error: "Not built yet." });
    expect(later).toContain("Not built yet.");
    expect(later.match(/data-mcp-server=/gu)).toHaveLength(MCP_SERVERS_FIXTURE.servers.length);
  });

  it("says so when the Mate has no servers", () => {
    const html = render({
      ...MCP_TAB_START,
      list: { agents: MCP_SERVERS_FIXTURE.agents, servers: [] },
    });
    expect(html).toContain(MCP_WORDS.none);
  });
});
