import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { serializeRenderedMarkdownFragment } from "./markdown-clipboard";

const TEXT_NODE = 3;
const ELEMENT_NODE = 1;

class FakeText {
  readonly nodeType = TEXT_NODE;
  readonly childNodes: ReadonlyArray<never> = [];

  constructor(readonly textContent: string) {}
}

class FakeElement {
  readonly nodeType = ELEMENT_NODE;
  checked = false;
  readonly childNodes: Array<FakeElement | FakeText> = [];
  readonly classList = {
    contains: (name: string) => this.classNames.includes(name),
  };

  constructor(
    readonly tagName: string,
    private readonly classNames: ReadonlyArray<string> = [],
    private readonly attributes: Readonly<Record<string, string>> = {},
  ) {}

  get localName(): string {
    return this.tagName.toLowerCase();
  }

  get textContent(): string {
    return this.childNodes.map((child) => child.textContent).join("");
  }

  get children(): ReadonlyArray<FakeElement> {
    return this.childNodes.filter((child): child is FakeElement => child instanceof FakeElement);
  }

  append(...children: Array<FakeElement | FakeText>): this {
    this.childNodes.push(...children);
    return this;
  }

  getAttribute(name: string): string | null {
    return this.attributes[name] ?? null;
  }

  hasAttribute(name: string): boolean {
    return Object.hasOwn(this.attributes, name);
  }

  /** Supports only the selectors markdown-clipboard actually asks for. */
  querySelector(selector: string): FakeElement | null {
    if (selector.includes(", ")) {
      for (const part of selector.split(", ")) {
        const match = this.querySelector(part);
        if (match) return match;
      }
      return null;
    }
    const childOnly = selector.startsWith(":scope > ");
    const [target, ...rest] = (childOnly ? selector.slice(":scope > ".length) : selector).split(
      " > ",
    );
    const matches = (element: FakeElement): boolean => {
      if (target === 'input[type="checkbox"]') {
        return element.tagName === "INPUT" && element.getAttribute("type") === "checkbox";
      }
      return element.tagName === target?.toUpperCase();
    };
    const search = (parent: FakeElement): FakeElement | null => {
      for (const child of parent.childNodes) {
        if (!(child instanceof FakeElement)) continue;
        if (matches(child)) {
          if (rest.length === 0) return child;
          const nested = child.querySelector(`:scope > ${rest.join(" > ")}`);
          if (nested) return nested;
        }
        if (!childOnly) {
          const nested = search(child);
          if (nested) return nested;
        }
      }
      return null;
    };
    return search(this);
  }
}

function asNode(element: FakeElement): Node {
  return element as unknown as Node;
}

function shikiCodeLine(text: string): FakeElement {
  const token = new FakeElement("SPAN").append(new FakeText(text));
  return new FakeElement("SPAN", ["line"]).append(token);
}

describe("serializeRenderedMarkdownFragment", () => {
  beforeEach(() => {
    vi.stubGlobal("Node", { TEXT_NODE, ELEMENT_NODE });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("wraps inline code in backticks", () => {
    const paragraph = new FakeElement("P").append(
      new FakeText("run "),
      new FakeElement("CODE").append(new FakeText("git status")),
      new FakeText(" first"),
    );
    const container = new FakeElement("DIV").append(paragraph);

    expect(serializeRenderedMarkdownFragment(asNode(container))).toBe("run `git status` first");
  });

  describe.each([
    { parentLayout: "tight", childLayout: "tight" },
    { parentLayout: "tight", childLayout: "loose" },
    { parentLayout: "loose", childLayout: "tight" },
    { parentLayout: "loose", childLayout: "loose" },
  ])("$parentLayout parent with $childLayout child", ({ parentLayout, childLayout }) => {
    it.each([
      { parentChecked: null, childChecked: true, parent: "- Parent", child: "  - [x] Child" },
      {
        parentChecked: false,
        childChecked: true,
        parent: "- [ ] Parent",
        child: "      - [x] Child",
      },
      {
        parentChecked: true,
        childChecked: false,
        parent: "- [x] Parent",
        child: "      - [ ] Child",
      },
    ])("copies $parent with $child", ({ parentChecked, childChecked, parent, child }) => {
      const parentContent = parentLayout === "loose" ? new FakeElement("P") : new FakeElement("LI");
      if (parentChecked !== null) {
        const checkbox = new FakeElement("INPUT", [], { type: "checkbox" });
        checkbox.checked = parentChecked;
        parentContent.append(checkbox, new FakeText(" "));
      }
      parentContent.append(new FakeText("Parent"));
      const parentItem =
        parentLayout === "loose" ? new FakeElement("LI").append(parentContent) : parentContent;
      const checkbox = new FakeElement("INPUT", [], { type: "checkbox" });
      checkbox.checked = childChecked;
      const childContent = new FakeElement(childLayout === "loose" ? "P" : "LI").append(
        checkbox,
        new FakeText(" Child"),
      );
      const childItem =
        childLayout === "loose" ? new FakeElement("LI").append(childContent) : childContent;
      parentItem.append(new FakeText("\n"), new FakeElement("UL").append(childItem));
      const container = new FakeElement("DIV").append(
        new FakeElement("P").append(new FakeText("Before")),
        new FakeElement("UL").append(parentItem),
        new FakeElement("P").append(new FakeText("After")),
      );

      expect(serializeRenderedMarkdownFragment(asNode(container))).toBe(
        `Before\n\n${parent}${parentLayout === "loose" ? "\n\n" : "\n"}${child}\n\nAfter`,
      );
    });
  });

  it("keeps a highlighted block code selection plain when its pre wrapper is outside the range", () => {
    const code = new FakeElement("CODE").append(
      shikiCodeLine("git show-ref --verify refs/remotes/origin/opt/deploy/dev"),
    );
    const container = new FakeElement("DIV").append(code);

    expect(serializeRenderedMarkdownFragment(asNode(container))).toBe(
      "git show-ref --verify refs/remotes/origin/opt/deploy/dev",
    );
  });

  it("keeps a multi-line code selection plain instead of inline-wrapping it", () => {
    const code = new FakeElement("CODE").append(new FakeText("first line\nsecond line"));
    const container = new FakeElement("DIV").append(code);

    expect(serializeRenderedMarkdownFragment(asNode(container))).toBe("first line\nsecond line");
  });
});
