/**
 * The design harness's one page (`design/index.html`, `vite.config.ts`): every `design*.html`
 * address answers with it, and it loads the harness that page names, alone, under its title. Any
 * other address — `/design/` — lists every harness. Each `design*.html` stays what names a harness:
 * its title and its module.
 */
const sources = import.meta.glob<string>("/design*.html", {
  query: "?raw",
  import: "default",
  eager: true,
});
const modules = import.meta.glob("/src/design/*Harness.tsx");

const harnesses = Object.entries(sources).map(([path, source]) => ({
  path,
  title: /<title>([^<]*)<\/title>/u.exec(source)?.[1] ?? path,
  load: modules[/<script[^>]*\bsrc="([^"]+)"/u.exec(source)?.[1] ?? ""],
  // A page names states worth a link of their own in `<meta name="design-states">`: entries split
  // by `;`, each its query and its words (`?empty=owner Empty organization, Owner`).
  states: (/<meta\s+name="design-states"\s+content="([^"]*)"/u.exec(source)?.[1] ?? "")
    .split(";")
    .map((entry) => /^\s*(\?\S+)\s+(.+?)\s*$/u.exec(entry))
    .flatMap((match) => (match === null ? [] : [{ query: match[1]!, words: match[2]! }])),
}));

const here = harnesses.find(
  ({ path }) => path === `/${location.pathname.slice(import.meta.env.BASE_URL.length)}`,
);

if (here?.load) {
  document.title = here.title;
  void here.load();
} else {
  listHarnesses();
}

/** Every harness by its title. Plain HTML in the browser's own light and dark. */
function listHarnesses() {
  document.documentElement.style.colorScheme = "light dark";
  const style = document.createElement("style");
  style.textContent = `
    body { font: 15px/1.5 system-ui, sans-serif; max-width: 44rem; margin: 3rem auto; padding: 0 1rem; }
    h1 { font-size: 1.4rem; }
    p, code { color: GrayText; }
    li { margin: 0.3rem 0; }
    code { font-size: 0.8rem; }
  `;
  document.head.append(style);
  const heading = document.createElement("h1");
  heading.textContent = "Mate — design harness";
  const about = document.createElement("p");
  about.textContent =
    "Every state of each surface over made-up data. No account and no Mate; nothing here is real.";
  const list = document.createElement("ul");
  const named = harnesses.map((harness) => ({
    ...harness,
    name: harness.title.replace(/^Mate — /u, "").replace(/ harness$/u, ""),
  }));
  for (const { path, name, states } of named.toSorted((left, right) =>
    left.name.localeCompare(right.name),
  )) {
    const link = document.createElement("a");
    link.href = `${import.meta.env.BASE_URL}${path.slice(1)}`;
    link.textContent = name;
    const file = document.createElement("code");
    file.textContent = path.slice(1);
    const item = document.createElement("li");
    item.append(link, " ", file);
    if (states.length > 0) {
      const nested = document.createElement("ul");
      for (const { query, words } of states) {
        const state = document.createElement("a");
        state.href = `${link.href}${query}`;
        state.textContent = words;
        const shown = document.createElement("code");
        shown.textContent = query;
        const row = document.createElement("li");
        row.append(state, " ", shown);
        nested.append(row);
      }
      item.append(nested);
    }
    list.append(item);
  }
  document.getElementById("design")?.append(heading, about, list);
}
