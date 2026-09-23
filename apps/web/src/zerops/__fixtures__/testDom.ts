/**
 * The smallest DOM `react-dom` renders into under the node test environment.
 * A node is an `EventTarget`, so listeners a component adds are real; what a
 * person would read off a subtree is its `textContent`.
 */
export class TestNode extends EventTarget {
  parentNode: TestNode | null = null;
  childNodes: TestNode[] = [];
  readonly nodeName: string;
  readonly tagName: string;
  readonly namespaceURI = "http://www.w3.org/1999/xhtml";
  readonly style = {};
  readonly ownerDocument: TestNode | null;
  readonly nodeType: number;
  #text = "";

  constructor(name: string, ownerDocument: TestNode | null = null, nodeType = 1) {
    super();
    this.nodeName = name.toUpperCase();
    this.tagName = this.nodeName;
    this.ownerDocument = ownerDocument;
    this.nodeType = nodeType;
  }

  set textContent(value: string) {
    this.childNodes = [];
    this.#text = value;
  }

  /** React writes a lone text child straight onto `textContent`, so a leaf carries its own. */
  get textContent(): string {
    if (this.nodeType === 3 || this.childNodes.length === 0) return this.#text;
    return this.childNodes.map((child) => child.textContent).join("");
  }

  set nodeValue(value: string) {
    this.#text = value;
  }

  get nodeValue(): string {
    return this.#text;
  }

  appendChild(child: TestNode) {
    this.#text = "";
    child.parentNode = this;
    this.childNodes.push(child);
    return child;
  }

  insertBefore(child: TestNode, before: TestNode | null) {
    if (before === null) return this.appendChild(child);
    child.parentNode = this;
    this.childNodes.splice(this.childNodes.indexOf(before), 0, child);
    return child;
  }

  removeChild(child: TestNode) {
    this.childNodes.splice(this.childNodes.indexOf(child), 1);
    child.parentNode = null;
    return child;
  }

  createElement(name: string) {
    return new TestNode(name, this);
  }

  createTextNode(text: string) {
    const node = new TestNode("#text", this, 3);
    node.nodeValue = text;
    return node;
  }

  get activeElement(): null {
    return null;
  }

  setAttribute() {}
  removeAttribute() {}
}

/** Every element under `root` with this tag, in document order. */
export function elementsOf(root: TestNode, tagName: string): ReadonlyArray<TestNode> {
  return root.childNodes.flatMap((child) => [
    ...(child.tagName === tagName.toUpperCase() ? [child] : []),
    ...elementsOf(child, tagName),
  ]);
}

/** The buttons under `root` whose text is `label`. */
export function buttonsLabelled(root: TestNode, label: string): ReadonlyArray<TestNode> {
  return elementsOf(root, "button").filter((button) => button.textContent.trim() === label);
}

/**
 * Presses a button the way React sees it: the node carries its current props
 * under React's private key, and the test DOM dispatches no synthetic events.
 */
export function press(button: TestNode): void {
  const propsKey = Object.keys(button).find((key) => key.startsWith("__reactProps$"));
  const props = propsKey === undefined ? undefined : (button as never)[propsKey];
  const onClick = (props as { readonly onClick?: () => void } | undefined)?.onClick;
  if (onClick === undefined) throw new Error(`"${button.textContent}" has no click handler.`);
  onClick();
}
