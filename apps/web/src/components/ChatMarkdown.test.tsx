import { markupDom } from "../../test/markupDom";
// @vitest-environment happy-dom

import type { ZeropsTopologyService } from "@t3tools/client-runtime/zerops/topology";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { act, type ComponentProps, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { describe, expect, it, vi } from "vite-plus/test";

import * as settingsModule from "../hooks/useSettings";
import { getSyntaxHighlighterPromise } from "../lib/syntaxHighlighting";
import { Button } from "./ui/button";
import { AppLinkContext, ServiceBrowserScope } from "./ServiceBrowserLink";
import { setMarkdownTaskChecked } from "./files/filePreviewMode";

vi.mock("@effect/atom-react", () => ({ useAtomValue: () => null }));
/** The organization's official HQ as a change chip reads it; none until a test names one. */
const official = vi.hoisted(() => ({ hqAddress: undefined as string | undefined }));
vi.mock("../zerops/projectFlows", () => ({
  useHqAddress: () => official.hqAddress,
  useAppsChanges: () => ({ hqAddress: official.hqAddress, changes: new Map() }),
}));
vi.mock("../hooks/useTheme", () => ({ useTheme: () => ({ resolvedTheme: "dark" }) }));
vi.mock("../hooks/useSettings", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../hooks/useSettings")>();
  const settings = actual.getClientSettings();
  return {
    ...actual,
    useClientSettings: (select?: (value: typeof settings) => unknown) =>
      select ? select(settings) : settings,
  };
});
vi.mock("./ui/tooltip", async () => {
  const { cloneElement, isValidElement } = await import("react");
  return {
    Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
    TooltipTrigger({
      render,
      children,
    }: ComponentProps<typeof import("./ui/tooltip").TooltipTrigger>) {
      if (!isValidElement(render)) return <>{children}</>;
      return children === undefined ? render : cloneElement(render, undefined, children);
    },
    TooltipPopup: () => null,
  };
});
vi.mock("../state/use-atom-query-runner", () => ({ useAtomQueryRunner: () => vi.fn() }));
vi.mock("../state/use-atom-command", () => ({ useAtomCommand: () => vi.fn() }));
vi.mock("../state/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../state/session")>()),
  usePreparedConnection: () => ({ _tag: "Loading" }),
}));
vi.mock("../state/entities", () => ({
  readThreadShell: () => null,
  useProjects: () => [],
}));
vi.mock("../remoteOpen", () => ({
  useRemoteOpenResolution: () => ({ state: { mode: "local-exec" }, isResolved: true }),
}));
vi.mock("../editorPreferences", () => ({
  useOpenInPreferredEditor: () => vi.fn(),
  usePreferredEditor: () => [null, vi.fn()],
}));
// A change no flow carries is asked of the forge; here the forge is still answering.
vi.mock("../zerops/useLinkedChange", () => ({
  useLinkedChange: () => ({ kind: "reading" }),
}));
vi.mock("~/lib/openPullRequestLink", () => ({
  findProjectForChangeRequest: () => undefined,
  matchesLinkedPullRequestUrl: () => false,
  parseChangeRequestUrl: () => null,
  useOpenChangeRequestLink: () => vi.fn(),
}));

import ChatMarkdown, {
  canUseMarkdownFileShellActions,
  hasMarkdownFilePrimaryAction,
  MarkdownPictureContext,
  type MarkdownPicture,
} from "./ChatMarkdown";

function codeButton(renderer: ReactTestRenderer, label: string) {
  const button = renderer.root
    .findAllByType(Button)
    .find((instance) => instance.props["aria-label"] === label);
  if (!button) throw new Error(`Missing code button: ${label}`);
  return button.props as ComponentProps<typeof Button>;
}

/** A link's own words, without the destination mark the fork adds after them. */
function linkWords(document: Document): Array<string | null> {
  return [...document.querySelectorAll("a")].map((link) => {
    const words = link.cloneNode(true) as HTMLElement;
    words.querySelectorAll("[data-link-indicator]").forEach((mark) => mark.remove());
    return words.textContent;
  });
}

describe("ChatMarkdown bare anchor placeholders", () => {
  it.each(["<A>", "<a>", "<a >", "<a/>", "<A/>", "<a />"])(
    "preserves unmatched %s without linking later blocks",
    (token) => {
      const text = `- **"From ${token}"** appears in the header.\n\n- **Tests:** cover inheritance.\n\nThe deferred move continues on B.\n\nSee <a href="https://example.com">the link</a>.`;
      const document = new DOMParser().parseFromString(
        renderToStaticMarkup(<ChatMarkdown cwd="/tmp/project" text={text} />),
        "text/html",
      );

      expect(document.querySelector("strong")?.textContent).toBe(`"From ${token}"`);
      expect(linkWords(document)).toEqual(["the link"]);
      expect(document.querySelectorAll("li")).toHaveLength(2);
      expect(
        [...document.querySelectorAll("p")].map((paragraph) => paragraph.textContent),
      ).toContain("The deferred move continues on B.");
    },
  );

  it.each(["</a>  ", "<div>more</div>\n</a>"])(
    "preserves a paired anchor closing in the raw block %s",
    (closing) => {
      const document = new DOMParser().parseFromString(
        renderToStaticMarkup(
          <ChatMarkdown cwd="/tmp/project" text={`See <a>label\n\n${closing}\n\nfinish`} />,
        ),
        "text/html",
      );
      expect(document.querySelector("p")?.textContent).toBe("See label");
    },
  );

  it("preserves a paired anchor after comment-looking raw text", () => {
    const document = new DOMParser().parseFromString(
      renderToStaticMarkup(
        <ChatMarkdown cwd="/tmp/project" text="See <a>label<script><!-- </script> --></a>" />,
      ),
      "text/html",
    );
    expect(document.querySelector("p")?.textContent).toBe("See label -->");
  });

  it.each(["<!-- </a> -->", '<div title="</a>">more</div>', '<script>"</a>"</script>'])(
    "ignores apparent closing anchors inside %s",
    (html) => {
      const document = new DOMParser().parseFromString(
        renderToStaticMarkup(
          <ChatMarkdown cwd="/tmp/project" text={`Before <A>.\n\n${html}\n\nAfter.`} />,
        ),
        "text/html",
      );
      expect(document.querySelector("p")?.textContent).toBe("Before <A>.");
      expect(document.querySelectorAll("a")).toHaveLength(0);
    },
  );

  it("preserves paired HTML anchors, details, markdown links, and inline code", () => {
    const text =
      'Bare <a>label</a>, <a id="section"></a>, `<A>`, and [docs](https://example.com).\n\n<details><summary>More</summary>Details</details>';
    const document = new DOMParser().parseFromString(
      renderToStaticMarkup(<ChatMarkdown cwd="/tmp/project" text={text} />),
      "text/html",
    );

    expect(linkWords(document)).toEqual(["label", "", "docs"]);
    expect(document.querySelector("code")?.textContent).toBe("<A>");
    expect(document.querySelector("[data-markdown-details]")?.textContent).toContain("More");
  });
});

describe("ChatMarkdown streaming", () => {
  it("runs only a complete single-line shell block after a click", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const onRunShellCommand = vi.fn();
    let renderer: ReactTestRenderer | undefined;
    const message = (text: string, isStreaming = false) => (
      <ChatMarkdown
        cwd="/tmp/project"
        text={text}
        isStreaming={isStreaming}
        onRunShellCommand={onRunShellCommand}
      />
    );
    try {
      await act(async () => {
        renderer = create(message("```bash\necho hello\n```", true));
      });
      const mounted = renderer!;
      expect(
        mounted.root
          .findAllByType(Button)
          .some((button) => button.props["aria-label"] === "Run in terminal"),
      ).toBe(false);

      await act(async () => {
        mounted.update(message("```bash\necho hello\n```"));
      });
      await act(async () => {
        codeButton(mounted, "Run in terminal").onClick?.({} as never);
      });
      expect(onRunShellCommand).toHaveBeenCalledExactlyOnceWith("echo hello");

      for (const text of [
        "~~~bash\necho tilde\n~~~",
        "> ```bash\n> echo quote\n> ```",
        "````bash\necho four\n````",
      ]) {
        await act(async () => {
          mounted.update(message(text));
        });
        expect(codeButton(mounted, "Run in terminal")).toBeDefined();
      }

      for (const text of [
        "```bash\necho one\necho two\n```",
        "```typescript\necho hello\n```",
        "```bash\n\n```",
        "```bash\necho hello\n\n```",
        "```bash\necho hello\\\n```",
        "```bash\necho safe \u202e#\n```",
        "```bash\necho incomplete",
        "~~~bash\necho incomplete",
        "````bash\necho incomplete\n```",
        '<pre><code class="language-bash">echo html</code></pre>',
      ]) {
        await act(async () => {
          mounted.update(message(text));
        });
        expect(
          mounted.root
            .findAllByType(Button)
            .some((button) => button.props["aria-label"] === "Run in terminal"),
        ).toBe(false);
      }
    } finally {
      await act(async () => renderer?.unmount());
      vi.unstubAllGlobals();
    }
  });

  it("does not retokenize completed lines when streaming finishes", async () => {
    const highlighter = await getSyntaxHighlighterPromise("typescript");
    const highlight = vi.spyOn(highlighter, "codeToHast");
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    let renderer: ReactTestRenderer | undefined;
    const text = "```typescript\nconst completed = 1;\nconst current = 2;";
    try {
      await act(async () => {
        renderer = create(<ChatMarkdown cwd="/tmp/project" text={text} isStreaming />);
      });
      expect(highlight).toHaveBeenCalled();
      highlight.mockClear();
      await act(async () => {
        renderer!.update(<ChatMarkdown cwd="/tmp/project" text={text + "\n```"} />);
      });
      expect(highlight.mock.calls.every(([code]) => !code.includes("const completed"))).toBe(true);
    } finally {
      await act(async () => renderer?.unmount());
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    }
  });

  it("preserves code controls and details without highlighting an unchanged fence again", async () => {
    const highlighter = await getSyntaxHighlighterPromise("text");
    const highlight = vi.spyOn(highlighter, "codeToHast");
    const writeText = vi.fn(async (_text: string) => {});
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    let renderer: ReactTestRenderer | undefined;
    const text = [
      "```text",
      "First code block",
      "```",
      "",
      "<details><summary>More</summary>",
      "",
      "Details content",
      "",
      "</details>",
      "",
      "Streaming reply",
    ].join("\n");

    try {
      await act(async () => {
        renderer = create(<ChatMarkdown cwd="/tmp/project" text={text} isStreaming />);
      });
      const mounted = renderer!;
      const codeBlock = mounted.root.findByProps({ "data-language": "text" });
      const initialWrap = codeBlock.props["data-wrap"] === "true";
      const wrap = codeButton(mounted, initialWrap ? "Disable line wrap" : "Wrap lines");
      const copy = codeButton(mounted, "Copy code");
      await act(async () => {
        wrap.onClick?.({} as Parameters<NonNullable<typeof wrap.onClick>>[0]);
        copy.onClick?.({} as Parameters<NonNullable<typeof copy.onClick>>[0]);
      });

      const detailsButton = mounted.root.find(
        (instance) =>
          instance.type === "button" && instance.props["data-markdown-details-summary"] === "",
      );
      await act(async () => {
        detailsButton.props.onClick({ nativeEvent: new Event("click") });
      });
      const details = mounted.root.findByProps({ "data-markdown-details": "" });
      expect(details.props["data-markdown-details-open"]).toBe("true");
      expect(writeText).toHaveBeenCalledWith("First code block\n");
      expect(highlight).toHaveBeenCalledTimes(1);

      for (let index = 0; index < 10; index += 1) {
        await act(async () => {
          mounted.update(<ChatMarkdown cwd="/tmp/project" text={`${text} ${index}`} isStreaming />);
        });
      }

      expect(highlight).toHaveBeenCalledTimes(1);
      expect(mounted.root.findByProps({ "data-language": "text" })).toBe(codeBlock);
      expect(codeBlock.props["data-wrap"]).toBe(String(!initialWrap));
      expect(mounted.root.findByProps({ "data-markdown-details": "" })).toBe(details);
      expect(details.props["data-markdown-details-open"]).toBe("true");
      await act(async () => {
        mounted.update(
          <ChatMarkdown
            cwd="/tmp/project"
            text={text.replace("First code block", "Updated code block")}
            isStreaming
          />,
        );
      });
      const copyUpdated = codeButton(mounted, "Copied");
      await act(async () => {
        copyUpdated.onClick?.({} as Parameters<NonNullable<typeof copyUpdated.onClick>>[0]);
      });
      expect(writeText).toHaveBeenLastCalledWith("Updated code block\n");
      expect(highlight).toHaveBeenCalledTimes(2);
    } finally {
      await act(async () => renderer?.unmount());
      vi.useRealTimers();
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    }
  });

  it("edits the current task text and marker after reusing a renderer", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    let renderer: ReactTestRenderer | undefined;
    let editedText: string | undefined;
    const message = (text: string) => (
      <ChatMarkdown
        cwd="/tmp/project"
        text={text}
        onTaskListChange={({ markerOffset, checked }) => {
          editedText = setMarkdownTaskChecked(text, markerOffset, checked);
          renderer!.update(message(editedText));
        }}
      />
    );

    try {
      await act(async () => {
        renderer = create(message("- [ ] First\n- [ ] Second"));
      });
      const mounted = renderer!;
      const originalInput = mounted.root.findAllByType("input")[1]!;
      await act(async () => {
        mounted.update(message("- [ ] A longer first task\n- [ ] Second"));
      });

      const input = mounted.root.findAllByType("input")[1]!;
      const listItem = mounted.root.findAllByType("li")[1]!;
      const { onChange } = input.props as ComponentProps<"input">;
      if (!onChange) throw new Error("Task checkbox has no edit handler");
      await act(async () => {
        onChange({
          currentTarget: {
            checked: true,
            closest: () => ({
              dataset: { taskMarkerOffset: String(listItem.props["data-task-marker-offset"]) },
            }),
          },
        } as unknown as Parameters<typeof onChange>[0]);
      });

      expect(input).toBe(originalInput);
      expect(editedText).toBe("- [ ] A longer first task\n- [x] Second");
      expect(mounted.root.findAllByType("input")[1]!.props.checked).toBe(true);
    } finally {
      await act(async () => renderer?.unmount());
      vi.unstubAllGlobals();
    }
  });
});

describe("canUseMarkdownFileShellActions", () => {
  const environmentId = EnvironmentId.make("environment-1");

  it("allows editor and file manager actions for local environments", () => {
    expect(canUseMarkdownFileShellActions(environmentId, "local-exec", true)).toBe(true);
  });

  it("hides shell actions until the environment mode is resolved", () => {
    expect(canUseMarkdownFileShellActions(environmentId, "local-exec", false)).toBe(false);
  });

  it("hides editor and file manager actions for remote environments", () => {
    expect(canUseMarkdownFileShellActions(environmentId, "remote-links", true)).toBe(false);
    expect(canUseMarkdownFileShellActions(environmentId, "remote-unavailable", true)).toBe(false);
  });

  it("hides shell actions when no environment owns the markdown", () => {
    expect(canUseMarkdownFileShellActions(null, "local-exec", true)).toBe(false);
  });
});

describe("hasMarkdownFilePrimaryAction", () => {
  it("keeps the chip interactive when an editor or panel can open it", () => {
    expect(
      hasMarkdownFilePrimaryAction({
        canOpenInEditor: true,
        canOpenInPanel: false,
      }),
    ).toBe(true);
    expect(
      hasMarkdownFilePrimaryAction({
        canOpenInEditor: false,
        canOpenInPanel: true,
      }),
    ).toBe(true);
  });

  it("removes the link affordance when no primary action can open the file", () => {
    expect(
      hasMarkdownFilePrimaryAction({
        canOpenInEditor: false,
        canOpenInPanel: false,
      }),
    ).toBe(false);
  });
});

describe("ChatMarkdown skill chips", () => {
  it("labels digit-leading skills from the discovered skill list", () => {
    const text = "Use $2spec with a $20k budget.";
    const render = (skills?: ReadonlyArray<{ name: string; displayName: string }>) =>
      renderToStaticMarkup(
        <ChatMarkdown cwd="/tmp/project" text={text} {...(skills ? { skills } : {})} />,
      );

    expect(render()).not.toContain("2Spec");
    const withSkills = render([
      { name: "2spec", displayName: "2Spec" },
      { name: "20k", displayName: "MoneySkill" },
    ]);
    expect(withSkills).toContain("2Spec");
    expect(withSkills).not.toContain("MoneySkill");
    expect(render([])).not.toContain("2Spec");
  });
});

describe("ChatMarkdown file option chips", () => {
  it("keeps the fallback button text selectable", () => {
    const html = renderToStaticMarkup(
      <ChatMarkdown cwd="/tmp/project" text="[Source](/tmp/project/src/main.ts)" />,
    );

    expect(html).toContain("<button");
    expect(html).toContain('aria-haspopup="menu"');
    expect(html).toContain("select-text");
  });
});

describe("ChatMarkdown file link labels", () => {
  const environmentId = EnvironmentId.make("env-labels");
  const render = (text: string) =>
    renderToStaticMarkup(
      <ChatMarkdown cwd="/repo" environmentId={environmentId} text={text} lineBreaks />,
    );

  it("keeps an agent's prose label beside the file chip, and copies the link as written", () => {
    const html = render("See [validates the input](/repo/src/example.ts:12) first.");

    expect(html).toContain("validates the input");
    expect(html).toContain("chat-markdown-file-link");
    expect(html).toContain('data-markdown-copy="[validates the input](/repo/src/example.ts:12)"');
  });

  it.each(["example.ts", "src/example.ts:12", "/repo/src/example.ts"])(
    "shows only the chip when the label %s names the file",
    (label) => {
      const html = render(`See [${label}](/repo/src/example.ts:12) first.`);

      expect(html).toContain("chat-markdown-file-link");
      expect(html).not.toContain(`>${label} <`);
    },
  );
});

describe("ChatMarkdown Windows file links", () => {
  const environmentId = EnvironmentId.make("env-windows");

  it.each([true, false])("preserves drive paths with parseRawHtml=%s", (parseRawHtml) => {
    const html = renderToStaticMarkup(
      <ChatMarkdown
        cwd="C:/Users/shawn/project"
        environmentId={environmentId}
        text="[Open](C:/Users/shawn/project/src/main.ts)"
        lineBreaks={!parseRawHtml}
        parseRawHtml={parseRawHtml}
      />,
    );

    expect(html).toContain('href="C:/Users/shawn/project/src/main.ts"');
    expect(html).toContain("chat-markdown-file-link");
  });

  it.each([true, false])("normalizes backslashes with parseRawHtml=%s", (parseRawHtml) => {
    const html = renderToStaticMarkup(
      <ChatMarkdown
        cwd="C:/Users/shawn/project"
        environmentId={environmentId}
        text={String.raw`[Open](C:\Users\shawn\project\src\main.ts)`}
        lineBreaks={!parseRawHtml}
        parseRawHtml={parseRawHtml}
      />,
    );

    expect(html).toContain('href="C:/Users/shawn/project/src/main.ts"');
    expect(html).toContain("chat-markdown-file-link");
  });

  it.each([true, false])(
    "distinguishes same-named backslash paths with parseRawHtml=%s",
    (parseRawHtml) => {
      const html = renderToStaticMarkup(
        <ChatMarkdown
          cwd="C:/Users/shawn/project"
          environmentId={environmentId}
          text={String.raw`[Source](C:\Users\shawn\project\src\index.ts) and [Test](C:\Users\shawn\project\test\index.ts)`}
          lineBreaks={!parseRawHtml}
          parseRawHtml={parseRawHtml}
        />,
      );

      expect(html).toContain("index.ts · project/src");
      expect(html).toContain("index.ts · project/test");
    },
  );

  it.each([true, false])(
    "does not disambiguate the same file in links and inline code with parseRawHtml=%s",
    (parseRawHtml) => {
      const path = String.raw`C:\Users\shawn\project\src\main.ts`;
      const html = renderToStaticMarkup(
        <ChatMarkdown
          cwd="C:/Users/shawn/project"
          environmentId={environmentId}
          text={`[Source](${path}) and \`${path}\``}
          lineBreaks={!parseRawHtml}
          parseRawHtml={parseRawHtml}
        />,
      );

      expect(html.match(/chat-markdown-file-link/g)).toHaveLength(2);
      expect(html).not.toContain("main.ts ·");
    },
  );

  it.each([true, false])("preserves reference links with parseRawHtml=%s", (parseRawHtml) => {
    const html = renderToStaticMarkup(
      <ChatMarkdown
        cwd="C:/Users/shawn/project"
        environmentId={environmentId}
        text={"[Open][source]\n\n[source]: C:/Users/shawn/project/src/main.ts"}
        lineBreaks={!parseRawHtml}
        parseRawHtml={parseRawHtml}
      />,
    );

    expect(html).toContain('href="C:/Users/shawn/project/src/main.ts"');
    expect(html).toContain("chat-markdown-file-link");
  });

  it.each([true, false])("still rejects unsafe schemes with parseRawHtml=%s", (parseRawHtml) => {
    const html = renderToStaticMarkup(
      <ChatMarkdown
        cwd="C:/Users/shawn/project"
        environmentId={environmentId}
        text="[unsafe](javascript:alert(1)) and [unknown](d:alert(1))"
        lineBreaks={!parseRawHtml}
        parseRawHtml={parseRawHtml}
      />,
    );

    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("d:alert");
    expect(html).not.toContain("chat-markdown-file-link");
  });
});

describe("ChatMarkdown brand link icons", () => {
  it("draws the GitHub mark for github.com links instead of fetching a favicon", () => {
    const markup = renderToStaticMarkup(
      <ChatMarkdown cwd="/tmp/project" text="[PR](https://github.com/zeropsio/mate/pull/1)" />,
    );
    expect(markup).not.toContain("google.com/s2/favicons");
    expect(markup).toContain("<svg");
  });
});

describe("ChatMarkdown pictures its host draws", () => {
  const draw = (picture: MarkdownPicture) => (
    <i
      data-alt={picture.alt}
      data-height={String(picture.height)}
      data-uri={picture.uri}
      data-width={String(picture.width)}
    />
  );

  it.each([
    [
      "a Markdown picture",
      "![The page](https://git.example.test/attachments/5f1c2a)",
      '<i data-alt="The page" data-height="undefined" data-uri="https://git.example.test/attachments/5f1c2a" data-width="undefined"></i>',
    ],
    [
      "an HTML picture, with the size it gives",
      '<img src="https://git.example.test/attachments/5f1c2a" alt="The page" width="640" height="400">',
      '<i data-alt="The page" data-height="400" data-uri="https://git.example.test/attachments/5f1c2a" data-width="640"></i>',
    ],
  ])("hands %s to the host, which draws it", (_case, text, drawn) => {
    const html = renderToStaticMarkup(
      <MarkdownPictureContext value={draw}>
        <ChatMarkdown cwd={undefined} text={text} />
      </MarkdownPictureContext>,
    );
    expect(html).toContain(drawn);
    expect(html).not.toContain("<img");
  });

  it("loads a picture itself where no host draws them", () => {
    const html = renderToStaticMarkup(
      <ChatMarkdown cwd={undefined} text="![The page](https://pictures.example/page.png)" />,
    );
    expect(html).toContain('src="https://pictures.example/page.png"');
  });
});

describe("ChatMarkdown variants", () => {
  it.each([undefined, "log", "answer"] as const)(
    "keeps the reading content in variant=%s",
    (variant) => {
      const html = renderToStaticMarkup(
        <ChatMarkdown cwd="/tmp/project" text="Body" {...(variant ? { variant } : {})} />,
      );
      expect(markupDom(html).body.textContent).toBe("Body");
    },
  );
});

describe("ChatMarkdown wrapping", () => {
  it.each([
    ["a link's own words", "[the Medusa recipe](https://github.com/zerops-recipe-apps/medusa-dtc)"],
    ["a pasted address", "https://github.com/zeropsio/mate/pull/12"],
  ])("breaks %s at word boundaries, not after every letter", (_name, text) => {
    const html = renderToStaticMarkup(<ChatMarkdown cwd="/tmp/project" text={text} />);

    expect(html).not.toContain("<wbr");
    // The favicon holds on to the first letter, so it never ends a line alone.
  });
});

describe("ChatMarkdown bare addresses", () => {
  /** The first link's tag and its visible words, without its favicon or destination hint. */
  function firstLink(html: string): { tag: string; words: string } {
    const [, tag = "", inner = ""] = /(<a [^>]*>)([\s\S]*?)<\/a>/.exec(html) ?? [];
    return {
      tag,
      words: inner.replace(/<span[^>]*data-link-indicator[\s\S]*$/, "").replace(/<[^>]+>/g, ""),
    };
  }

  it.each([
    {
      text: "The PR: https://github.com/zeropsio/mate/pull/12",
      address: "https://github.com/zeropsio/mate/pull/12",
      words: "github.com/zeropsio/mate/pull/12",
    },
    {
      text: "It's in <https://git-4c1a-3000.prg1.zerops.app/garden/group/src/branch/main/environments.yaml>",
      address:
        "https://git-4c1a-3000.prg1.zerops.app/garden/group/src/branch/main/environments.yaml",
      words: "git-4c1a-3000.prg1.zerops.app/…/environments.yaml",
    },
    {
      text: "[https://garden-5b2d-9000.prg1.zerops.app/app](https://garden-5b2d-9000.prg1.zerops.app/app)",
      address: "https://garden-5b2d-9000.prg1.zerops.app/app",
      words: "garden-5b2d-9000.prg1.zerops.app/app",
    },
    {
      text: "Scripted: https://orbitstage-6e3f-3000.prg1.zerops.app/?view=orbit#hud.",
      address: "https://orbitstage-6e3f-3000.prg1.zerops.app/?view=orbit#hud",
      words: "orbitstage-6e3f-3000.prg1.zerops.app",
    },
  ])("shows $address as $words, keeping the whole of it to follow and copy", (link) => {
    const { tag, words } = firstLink(
      renderToStaticMarkup(<ChatMarkdown cwd="/tmp/project" text={link.text} />),
    );

    expect(words).toBe(link.words);
    expect(tag).toContain(`href="${link.address}"`);
    expect(tag).toContain(`data-markdown-copy="${link.address}"`);
  });

  it.each([
    {
      text: "Notes are in [the tier folder](https://github.com/fxck/noola/tree/main/.zerops-recipe).",
      words: "the tier folder",
    },
    { text: "The email is admin@example.com.", words: "admin@example.com" },
  ])("keeps a link's own words: $words", (link) => {
    const { tag, words } = firstLink(
      renderToStaticMarkup(<ChatMarkdown cwd="/tmp/project" text={link.text} />),
    );

    expect(words).toBe(link.words);
    expect(tag).not.toContain("data-markdown-copy");
  });
});

describe("ChatMarkdown callouts", () => {
  function callout(html: string) {
    const note = markupDom(html).querySelector('[role="note"]');
    const label = note?.querySelector("p");
    return {
      open: note?.outerHTML ?? "",
      label: label?.outerHTML ?? "",
      body: Array.from(note?.children ?? [])
        .slice(1)
        .map((node) => node.outerHTML)
        .join(""),
    };
  }
  it.each([
    { marker: "[!NOTE]", kind: "note", word: "Note" },
    { marker: "[!TIP]", kind: "tip", word: "Tip" },
    { marker: "[!IMPORTANT]", kind: "important", word: "Important" },
    { marker: "[!WARNING]", kind: "warning", word: "Warning" },
    { marker: "[!CAUTION]", kind: "caution", word: "Caution" },
    { marker: "[!caution]", kind: "caution", word: "Caution" },
  ])("renders > $marker as a $word callout", ({ marker, kind, word }) => {
    const html = renderToStaticMarkup(
      <ChatMarkdown cwd="/tmp/project" text={`> ${marker}\n> Stripe is empty.`} />,
    );
    const note = markupDom(html).querySelector('[role="note"]');
    expect(note?.getAttribute("data-alert")).toBe(kind);
    const [label, body] = Array.from(note?.querySelectorAll("p") ?? []);
    expect(label?.textContent).toBe(word);
    expect(label?.querySelector("svg")).toBeNull();
    expect(body?.textContent).toBe("Stripe is empty.");
    expect(note?.textContent).not.toContain("[!");
    expect(label?.getAttribute("data-markdown-copy")).toBe(`[!${kind.toUpperCase()}]\n`);
  });

  it("keeps lists and code in a callout's body, in order", () => {
    const html = renderToStaticMarkup(
      <ChatMarkdown
        cwd="/tmp/project"
        text={[
          "> [!WARNING]",
          "> Before Medusa ever comes up:",
          ">",
          "> - set `JWT_SECRET`;",
          "> - set `COOKIE_SECRET`.",
          ">",
          "> ```bash",
          "> openssl rand -hex 32",
          "> ```",
        ].join("\n")}
      />,
    );
    const { body } = callout(html);
    const order = [
      "<p>Before Medusa ever comes up:</p>",
      "<ul>",
      "COOKIE_SECRET",
      "chat-markdown-codeblock",
    ].map((part) => body.indexOf(part));

    expect(order.every((index) => index >= 0)).toBe(true);
    expect(order).toEqual(order.toSorted((left, right) => left - right));
    // Highlighted or not yet, the command reads whole.
    expect(body.replace(/<[^>]+>/g, "")).toContain("openssl rand -hex 32");
  });

  it.each([
    ["a plain quote", "> Just a quote."],
    ["a marker sharing its line", "> [!NOTE] an ordinary quote"],
    ["an unknown kind", "> [!DANGER]\n> Not one of GitHub's."],
  ])("leaves %s a quote", (_name, text) => {
    const html = renderToStaticMarkup(<ChatMarkdown cwd="/tmp/project" text={text} />);

    expect(html).toMatch(/<blockquote>\s*<p>/);
    expect(html).not.toContain("chat-markdown-callout");
    expect(html).not.toContain('role="note"');
  });

  it("does not take a raw alert attribute outside the five kinds for one", () => {
    const html = renderToStaticMarkup(
      <ChatMarkdown
        cwd="/tmp/project"
        text={'<blockquote data-alert="constructor">Hi</blockquote>'}
      />,
    );

    expect(html).not.toContain("chat-markdown-callout");
    expect(html).toContain("Hi");
  });
});

describe("ChatMarkdown tables", () => {
  const TABLE = [
    "| Service | Where it runs | What changed |",
    "| --- | --- | --- |",
    "| api | the dev container | the health check waits for the database; a slow start no longer fails the deploy |",
  ].join("\n");

  it.each([true, false])(
    "wraps its cells with no truncated reading to toggle (word wrap %s)",
    (wordWrap) => {
      vi.spyOn(settingsModule, "getClientSettings").mockReturnValue({
        ...settingsModule.getClientSettings(),
        wordWrap,
      });
      try {
        const html = renderToStaticMarkup(<ChatMarkdown cwd="/tmp/project" text={TABLE} />);

        expect(html).toContain("chat-markdown-table-container");
        expect(html).not.toContain("data-expanded");
        expect(html).not.toContain("table cells");
        expect(html).toContain('aria-label="Copy table"');
        expect(html).toContain("a slow start no longer fails the deploy");
      } finally {
        vi.restoreAllMocks();
      }
    },
  );
});

describe("ChatMarkdown heading levels", () => {
  it("exposes headings below the host heading without changing their tags", () => {
    const html = renderToStaticMarkup(
      <ChatMarkdown
        cwd="/tmp/project"
        text={"# Top\n\n## Section\n\n###### Fine print"}
        headingLevelOffset={3}
      />,
    );

    expect(html).toContain('<h1 aria-level="4">Top</h1>');
    expect(html).toContain('<h2 aria-level="5">Section</h2>');
    expect(html).toContain('<h6 aria-level="6">Fine print</h6>');
  });

  it("leaves heading levels alone when the markdown is not nested", () => {
    const html = renderToStaticMarkup(<ChatMarkdown cwd="/tmp/project" text="# Top" />);

    expect(html).toContain("<h1>Top</h1>");
  });
});

// The Mate's pictures open large, the text's other pictures beside them (the
// owner, 2026-09-27, of a picture in an answer: "why aren't these opening in
// modal?").
describe("ChatMarkdown pictures", () => {
  const text = "Here it is:\n\n![The home page](https://shop.example.dev/home.png)";
  it.each([
    { name: "where something opens them", opens: true },
    { name: "as they are where nothing does", opens: false },
  ])("draws a picture $name", ({ opens }) => {
    const markup = renderToStaticMarkup(
      <ChatMarkdown
        cwd={undefined}
        onOpenImage={opens ? () => undefined : undefined}
        text={text}
      />,
    );
    expect(markup).toContain("data-markdown-image");
    expect(markup.includes('aria-label="Open The home page"')).toBe(opens);
    expect(markup.includes("<button")).toBe(opens);
  });
});

describe("ChatMarkdown links read as part of the sentence", () => {
  const host = "webdev-1a2b-3000.prg1.zerops.app";
  const services: ZeropsTopologyService[] = [
    {
      hostname: "webdev",
      serviceId: "webdev",
      type: "nodejs@22",
      status: "ACTIVE",
      group: "runtimes",
      transient: false,
      ports: [],
      routes: [{ url: `https://${host}`, host, port: 3000 }],
    },
  ];
  function render(text: string) {
    return renderToStaticMarkup(
      <ServiceBrowserScope
        threadRef={{ environmentId: EnvironmentId.make("env-1"), threadId: ThreadId.make("t-1") }}
        services={services}
      >
        <ChatMarkdown cwd="/tmp/project" text={text} />
      </ServiceBrowserScope>,
    );
  }
  /** The first link's markup, and what follows it up to the next tag. */
  function firstLink(html: string) {
    const [, tag = "", inner = "", after = ""] =
      /(<a [^>]*>)([\s\S]*?)<\/a>([^<]*)/.exec(html) ?? [];
    return { tag, inner, after };
  }
  /** What the link draws after its last visible word, its destination's words aside. */
  function drawnAfterWords(inner: string, said: string): string {
    const parts = inner.replace(said, "").split(/(<[^>]+>)/);
    const last = parts.findLastIndex((part) => !part.startsWith("<") && part.trim() !== "");
    return parts.slice(last + 1).join("");
  }

  it.each([
    {
      name: "a service's address, opened beside the conversation",
      text: `It is live: https://${host}/app. Try it.`,
      destination: "preview",
      said: "Open in side panel",
    },
    {
      name: "a named link to a service",
      text: `Open [the guestbook](https://${host}/).`,
      destination: "preview",
      said: "Open in side panel",
    },
    {
      name: "an address on the web",
      text: "See https://docs.example.org/guide.",
      destination: "external",
      said: "Open in new tab",
    },
  ])("$name: its mark leads, the full stop follows its words", (link) => {
    const { tag, inner, after } = firstLink(render(link.text));
    expect(tag).toContain(`data-link-destination="${link.destination}"`);
    // Nothing drawn between the link's last word and the sentence's full stop.
    expect(drawnAfterWords(inner, link.said)).not.toMatch(/<svg|<img/);
    expect(after).toMatch(/^\./);
    // The destination is still said, to whoever cannot see the mark.
    expect(inner).toContain(link.said);
  });

  it("marks a service's address with a drawn globe, never a fetched favicon", () => {
    const { inner } = firstLink(render(`It is live: https://${host}/app.`));
    expect(inner).not.toContain("<img");
    expect(inner).toContain("<svg");
  });
});

describe("ChatMarkdown links to a change of the person's group", () => {
  const HQ = "https://hq-7c1d-8080.prg1.zerops.app";

  it.each([
    {
      name: "a link in the Mate's own words",
      text: `The changes are in the [site change](${HQ}/changes/group-1/site/7), with screenshots.`,
      words: "site change",
    },
    { name: "a bare address", text: `See ${HQ}/changes/group-1/site/7.`, words: "site #7" },
  ])("$name opens the change's review in the app, wearing the change's mark", async (link) => {
    const opened: string[] = [];
    const openChange = (href: string) => () => opened.push(href);
    official.hqAddress = HQ;
    let renderer: ReactTestRenderer | undefined;
    await act(async () => {
      renderer = create(
        <AppLinkContext value={openChange}>
          <ChatMarkdown cwd="/tmp/project" text={link.text} />
        </AppLinkContext>,
      );
    });
    const anchor = renderer!.root.find(
      (node) => node.type === "a" && node.props["data-zerops-change-chip"] !== undefined,
    );
    const words = anchor.findAll((node) => typeof node.props.children === "string");
    expect(words.map((node) => node.props.children).join("")).toBe(link.words);
    const preventDefault = vi.fn();
    anchor.props.onClick({ button: 0, preventDefault });
    expect(preventDefault).toHaveBeenCalled();
    expect(opened).toHaveLength(1);
    await act(async () => renderer!.unmount());
    official.hqAddress = undefined;
  });
});
