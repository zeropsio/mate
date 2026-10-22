/**
 * A repository's markdown, untrusted: raw HTML keeps only what chat's sanitize allowlist keeps, a
 * relative link opens that path in the browser at the same commit, and a relative image is drawn
 * from that commit's bytes (at most {@link REPO_IMAGES} a document). No image outside the
 * repository is ever loaded — each shows as a link, so the reader's address never reaches a host
 * the document names.
 */
import { createContext, use, type ComponentProps, type MouseEvent } from "react";
import { useGitRaw } from "~/zerops/useGitRaw";
import ReactMarkdown from "react-markdown";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import { MARKDOWN_SANITIZE_SCHEMA } from "../../markdownSanitizeSchema";

/** A path of the repository a README link opens. */
export interface RepoPathTarget {
  readonly path: string;
  readonly kind: "tree" | "file";
}

const SCHEME = /^[a-z][a-z0-9+.-]*:/iu;
const WEB = /^(?:https?|mailto):/iu;

/**
 * Where a README link goes: a repository path, resolved from the README's own folder (a leading
 * `/` from the repository's root); an outside web address; or nowhere this page can open.
 */
export const readmeLink = (
  href: string,
  from: string,
):
  | { readonly kind: "repo"; readonly target: RepoPathTarget }
  | { readonly kind: "web"; readonly href: string }
  | { readonly kind: "anchor" }
  | { readonly kind: "none" } => {
  if (href.startsWith("#")) return { kind: "anchor" };
  if (href.startsWith("//") || SCHEME.test(href))
    return WEB.test(href) ? { kind: "web", href } : { kind: "none" };
  const bare = href.replace(/[?#].*$/su, "");
  let decoded: string;
  try {
    decoded = decodeURIComponent(bare);
  } catch {
    return { kind: "none" };
  }
  const base = decoded.startsWith("/") ? [] : from.split("/").slice(0, -1);
  const segments: Array<string> = [];
  for (const segment of [...base, ...decoded.split("/")]) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") segments.pop();
    else segments.push(segment);
  }
  const path = segments.join("/");
  return {
    kind: "repo",
    target: { path, kind: path === "" || decoded.endsWith("/") ? "tree" : "file" },
  };
};

type HastNode = {
  type?: string;
  value?: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: Array<HastNode>;
};

/** Images of the repository a document draws; any further one shows as a link. */
export const REPO_IMAGES = 20;

/**
 * The first {@link REPO_IMAGES} images of the repository kept, marked to be drawn from its bytes;
 * every other image a link to where it is, its alt text its words; inside a link, just its words.
 */
function rehypeImagesAsLinks() {
  return (tree: HastNode) => {
    let kept = 0;
    const visit = (node: HastNode, inLink: boolean) => {
      if (node.children === undefined) return;
      node.children = node.children.map((child) => {
        if (child.type !== "element" || child.tagName !== "img") {
          visit(child, inLink || child.tagName === "a");
          return child;
        }
        const src = typeof child.properties?.src === "string" ? child.properties.src : "";
        const alt = typeof child.properties?.alt === "string" ? child.properties.alt : "";
        const words: HastNode = { type: "text", value: alt || src || "image" };
        if (src !== "" && !src.startsWith("#") && kept < REPO_IMAGES) {
          const at = readmeLink(src, "");
          if (at.kind === "repo" && at.target.kind === "file") {
            kept++;
            return {
              type: "element",
              tagName: "img",
              properties: { dataRepoImage: src, alt },
              children: [],
            };
          }
        }
        return inLink || src === ""
          ? words
          : {
              type: "element",
              tagName: "a",
              properties: { href: src, dataImage: "" },
              children: [words],
            };
      });
    };
    visit(tree, false);
  };
}

const REMARK_PLUGINS = [remarkGfm];
const REHYPE_PLUGINS = [
  rehypeRaw,
  [rehypeSanitize, MARKDOWN_SANITIZE_SCHEMA],
  rehypeImagesAsLinks,
] satisfies NonNullable<ComponentProps<typeof ReactMarkdown>["rehypePlugins"]>;

/** Markdown by its extension; a README without one, or `.txt`, is text. */
const isMarkdown = (path: string) => /\.(?:md|markdown)$/iu.test(path);

const plainClick = (event: MouseEvent) =>
  event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;

interface ReadmeLinks {
  /** The README's path in the repository: relative links resolve from its folder. */
  readonly path: string;
  /** The commit the document was read at, whose bytes its images are drawn from. */
  readonly appId: string;
  readonly repo: string;
  readonly sha: string;
  readonly hrefOf: (target: RepoPathTarget) => string;
  readonly onOpen: (target: RepoPathTarget) => void;
}
const ReadmeLinksContext = createContext<ReadmeLinks | null>(null);

function ReadmeAnchor({
  node: _node,
  href,
  children,
  ...props
}: ComponentProps<"a"> & { readonly node?: unknown }) {
  const links = use(ReadmeLinksContext)!;
  const link = readmeLink(typeof href === "string" ? href : "", links.path);
  if (link.kind === "repo")
    return (
      <a
        {...props}
        href={links.hrefOf(link.target)}
        onClick={(event) => {
          if (!plainClick(event)) return;
          event.preventDefault();
          links.onOpen(link.target);
        }}
      >
        {children}
      </a>
    );
  if (link.kind === "web")
    return (
      <a {...props} href={link.href} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    );
  if (link.kind === "anchor")
    return (
      <a {...props} href={href}>
        {children}
      </a>
    );
  return <span>{children}</span>;
}
/** An image of the repository, drawn from the commit's bytes; a link where they are not an image. */
function RepoImage({ node: _node, ...props }: ComponentProps<"img"> & { readonly node?: unknown }) {
  const links = use(ReadmeLinksContext)!;
  const src = (props as Record<string, unknown>)["data-repo-image"];
  const link = readmeLink(typeof src === "string" ? src : "", links.path);
  const path = link.kind === "repo" ? link.target.path : "";
  const raw = useGitRaw(
    { appId: links.appId, repo: links.repo, sha: links.sha, path },
    link.kind === "repo",
  );
  if (link.kind !== "repo") return null;
  if (raw.url !== null && raw.type?.startsWith("image/"))
    return <img className="inline max-w-full" src={raw.url} alt={props.alt ?? ""} />;
  // Still reading: nothing yet. Read and not an image, or not read: the link it was.
  return raw.view.state === "unread" || (raw.view.state === "known" && raw.url === null) ? null : (
    <a
      href={links.hrefOf(link.target)}
      onClick={(event) => {
        if (!plainClick(event)) return;
        event.preventDefault();
        links.onOpen(link.target);
      }}
    >
      {props.alt || path}
    </a>
  );
}
const COMPONENTS = { a: ReadmeAnchor, img: RepoImage };

export function RepoMarkdown({
  content,
  ...links
}: ReadmeLinks & {
  readonly content: string;
}) {
  if (!isMarkdown(links.path))
    return (
      <pre className="overflow-auto whitespace-pre-wrap break-words font-mono text-xs text-foreground">
        {content}
      </pre>
    );
  return (
    <ReadmeLinksContext value={links}>
      <div className="chat-markdown w-full min-w-0">
        <ReactMarkdown
          remarkPlugins={REMARK_PLUGINS}
          rehypePlugins={REHYPE_PLUGINS}
          components={COMPONENTS}
        >
          {content}
        </ReactMarkdown>
      </div>
    </ReadmeLinksContext>
  );
}
