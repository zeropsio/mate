// @vitest-environment happy-dom
import type { PlaceAddresses } from "@t3tools/client-runtime/data";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import type { AddressWrite } from "./addresses.logic";
import { AddressesSheetBody, type AddressesSheetBodyProps } from "./AddressesSheet";
import { ADDRESSES_FIXTURE } from "./addressesFixture";

let root: Root | undefined;

afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

interface Mounted {
  readonly container: HTMLElement;
  readonly writes: Array<AddressWrite>;
  /** Draws the sheet again with these props changed, as new reads arrive. */
  readonly rerender: (over: Partial<AddressesSheetBodyProps>) => Promise<void>;
}

async function mount(over: Partial<AddressesSheetBodyProps> = {}): Promise<Mounted> {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const writes: Array<AddressWrite> = [];
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  const props: AddressesSheetBodyProps = {
    projectName: "Shop",
    placeName: "Production",
    projectId: "p1",
    places: [],
    onPlace: () => {},
    place: ADDRESSES_FIXTURE,
    othersWaiting: { domains: [], ports: [] },
    ipv4: { state: "known", price: 3, enabled: false },
    busy: new Set(),
    trouble: new Map(),
    unsure: new Set(),
    startAdding: false,
    zeropsUrl: "https://app.zerops.io/project/p1",
    onWrite: async (write) => {
      writes.push(write);
      return true;
    },
    onClose: () => {},
    nowMs: Date.parse("2026-10-14T12:00:00Z"),
    ...over,
  };
  await act(async () => root!.render(<AddressesSheetBody {...props} />));
  const rerender = async (more: Partial<AddressesSheetBodyProps>) => {
    await act(async () => root!.render(<AddressesSheetBody {...props} {...more} />));
  };
  return { container, writes, rerender };
}

const text = (element: Element | null) => element?.textContent?.replace(/\s+/gu, " ").trim() ?? "";

function button(container: Element, label: string): HTMLButtonElement {
  const found = [...container.querySelectorAll<HTMLButtonElement>("button")].find(
    (each) => each.textContent?.trim() === label || each.getAttribute("aria-label") === label,
  );
  if (found === undefined) throw new Error(`No button "${label}" in: ${text(container)}`);
  return found;
}

async function press(element: Element) {
  await act(async () => {
    (element as HTMLElement).click();
  });
}

async function type(input: HTMLInputElement, value: string) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

const part = (container: Element, name: string) =>
  container.querySelector(`[data-addresses-part="${name}"]`)!;

/** A record table's rows as read: type, name, value. */
const recordRows = (table: Element) =>
  [...table.querySelectorAll("[data-record]")].map((row) =>
    [...row.querySelectorAll('[role="cell"]')].slice(0, 3).map(text),
  );

/** The fixture with one service that serves the web: a domain has one thing to open. */
const ONE_SERVICE: PlaceAddresses = {
  ...ADDRESSES_FIXTURE,
  webTargets: ADDRESSES_FIXTURE.webTargets.slice(0, 1),
};

describe("the addresses sheet", () => {
  // witness: apps/web/src/components/zerops/addresses/AddressesSheet.tsx | <AddressesZerops ctx={ctx} mode={web} place={props.place} setMode={setMode} /> → {null}
  it("lists a place's addresses under what each kind is for", async () => {
    const { container } = await mount();
    expect(text(container.querySelector("h2"))).toBe("Shop's addresses");
    expect([...container.querySelectorAll("h3")].map(text)).toEqual([
      "Your domains",
      "Zerops addresses",
      "Direct connections",
      "IP addresses",
    ]);
    expect(text(part(container, "domains"))).toContain("shop.com");
    expect(text(part(container, "zerops"))).toContain("app-4c1e-3000.prg1.zerops.app");
    expect(text(part(container, "direct"))).toContain("Only 2 addresses");
    expect(text(part(container, "ip"))).toContain("2001:db8:4a7:1d::1");
  });

  it("a domain waiting for DNS shows exactly the records it needs", async () => {
    const { container } = await mount();
    const records = container.querySelector('[data-addresses-records="rt-blog"]')!;
    // Each name as a DNS provider's own field takes it: "@" for the domain itself.
    expect(recordRows(records)).toEqual([
      ["A", "@", "93.185.106.128"],
      ["AAAA", "@", "2001:db8:4a7:1d::1"],
      ["A", "www.blog.com", "93.185.106.128"],
      ["AAAA", "www.blog.com", "2001:db8:4a7:1d::1"],
    ]);
    expect(text(records)).toContain("@ means blog.com itself.");
    expect(text(records)).toContain("Each name needs both its A and its AAAA record.");
    expect(text(records)).toContain("New records usually show within 10 minutes");
    // A live domain needs nothing more.
    expect(container.querySelector('[data-addresses-records="rt-shop"]')).toBeNull();
  });

  it("offers one CNAME at the project's zone as the other way to point a domain", async () => {
    const { container } = await mount();
    await press(button(container, "Other ways"));
    const way = container.querySelector(
      '[data-addresses-records="rt-blog"] [data-dns-way="cname"]',
    )!;
    expect(recordRows(way)).toEqual([
      ["CNAME", "@", "k3f9x2.prg1-zerops.zone"],
      ["CNAME", "www.blog.com", "k3f9x2.prg1-zerops.zone"],
    ]);
    expect(text(way)).toContain("One CNAME instead");
  });

  it("checking a domain's DNS again asks Zerops to look it up", async () => {
    const { container, writes } = await mount();
    const records = container.querySelector('[data-addresses-records="rt-blog"]')!;
    expect(text(records)).toContain("Checked 2 minutes ago");
    await press(button(records, "Check now"));
    expect(writes).toEqual([{ kind: "check-domain-dns", projectId: "p1", routingId: "rt-blog" }]);
  });

  it("closing a zerops.app address asks first and says which domains keep working", async () => {
    const { container, writes } = await mount();
    const toggle = container.querySelector<HTMLElement>('[aria-label="app\'s Zerops address"]')!;
    await press(toggle);
    expect(writes).toEqual([]);
    const zerops = text(part(container, "zerops"));
    expect(zerops).toContain("Turn off app-4c1e-3000.prg1.zerops.app?");
    expect(zerops).toContain("shop.com and www.shop.com keep working.");
    expect(zerops).not.toContain("blog.com keep");
    await press(button(container, "Turn it off"));
    expect(writes).toEqual([
      { kind: "disable-subdomain-access", projectId: "p1", serviceId: "svc-app" },
    ]);
  });

  it("an IPv6 port refuses an IPv4 address before anything is sent", async () => {
    const { container, writes } = await mount();
    await press(button(container, "Open a port"));
    const form = container.querySelector('[data-addresses-form="open-port"]')!;
    expect(text(form)).toContain("An IPv6 port is reachable only from networks with IPv6.");
    const port = form.querySelector<HTMLInputElement>('input[inputmode="numeric"]')!;
    await type(port, "7000");
    await type(
      form.querySelector<HTMLInputElement>('input[aria-label="Address 1"]')!,
      "198.51.100.20",
    );
    await press(button(form, "Open port 7000"));
    expect(writes).toEqual([]);
    expect(text(form)).toContain("an IPv6 port can't allow it");

    await type(
      form.querySelector<HTMLInputElement>('input[aria-label="Address 1"]')!,
      "2001:db8::1",
    );
    await press(button(form, "Open port 7000"));
    expect(writes).toEqual([
      {
        kind: "open-port",
        projectId: "p1",
        serviceId: "svc-db",
        publicIpType: "IP_V6",
        publicPort: 7000,
        internalPort: 6432,
        internalProtocol: "tcp",
        firewallPolicy: "WHITELIST",
        firewallIpRanges: ["2001:db8::1/128"],
      },
    ]);
  });

  it("someone else's waiting change is named before ours puts it live", async () => {
    const { container, writes } = await mount({
      place: ONE_SERVICE,
      othersWaiting: {
        domains: [{ id: "rt-api", label: "api.shop.com → api · port 8080" }],
        ports: [],
      },
    });
    await press(button(container, "Add a domain"));
    const form = container.querySelector('[data-addresses-form="add-domain"]')!;
    await type(form.querySelector<HTMLInputElement>("input")!, "https://Docs.Shop.com/");
    await press(button(form, "Add docs.shop.com"));
    expect(writes).toEqual([]);
    expect(text(form)).toContain("Adding docs.shop.com also puts live a change made elsewhere");
    expect(text(form)).toContain("api.shop.com → api · port 8080");
    await press(button(form, "Put both live"));
    expect(writes).toEqual([
      {
        kind: "add-domain",
        projectId: "p1",
        domains: ["docs.shop.com"],
        serviceId: "svc-app",
        port: 3000,
      },
    ]);
  });

  it("offers to put someone else's waiting changes live when nothing of ours is under way", async () => {
    const waiting = {
      domains: [{ id: "rt-api", label: "api.shop.com → api · port 8080" }],
      ports: [],
    };
    const idle = await mount({ othersWaiting: waiting });
    await press(button(idle.container, "Put it live"));
    expect(idle.writes).toEqual([{ kind: "publish-domains", projectId: "p1" }]);
    await act(async () => root?.unmount());

    const busy = await mount({ othersWaiting: waiting, busy: new Set(["add-domain"]) });
    expect(text(part(busy.container, "domains"))).toContain("It goes live with your change.");
    expect(() => button(busy.container, "Put it live")).toThrow();
  });

  it("adding a two-label domain offers its www twin", async () => {
    const { container, writes } = await mount({ startAdding: true, place: ONE_SERVICE });
    const form = container.querySelector('[data-addresses-form="add-domain"]')!;
    await type(form.querySelector<HTMLInputElement>("input")!, "new.com");
    expect(text(form)).toContain("Also www.new.com");
    await press(button(form, "Add new.com"));
    expect(writes).toEqual([
      {
        kind: "add-domain",
        projectId: "p1",
        domains: ["new.com", "www.new.com"],
        serviceId: "svc-app",
        port: 3000,
      },
    ]);
  });

  it("a domain the place already has is not added twice", async () => {
    const { container, writes } = await mount({ startAdding: true });
    const form = container.querySelector('[data-addresses-form="add-domain"]')!;
    await type(form.querySelector<HTMLInputElement>("input")!, "shop.com");
    expect(text(form)).toContain("shop.com is already one of Production's addresses.");
    expect(button(form, "Add domain").disabled).toBe(true);
    expect(writes).toEqual([]);
  });

  it("buying the own IPv4 states the price and renewal before anything is sent", async () => {
    const { container, writes } = await mount();
    await press(button(container, "Get one"));
    expect(writes).toEqual([]);
    const ip = text(part(container, "ip"));
    expect(ip).toContain("Get your own IPv4 for Production · $3 every 30 days");
    expect(ip).toContain("renews on its own");
    expect(ip).toContain("can't be refunded");
    expect(ip).toContain("promo credit doesn't count");
    await press(button(container, "Get it for $3"));
    expect(writes).toEqual([{ kind: "request-ipv4", projectId: "p1" }]);
  });

  it("the own IPv4 is not bought at a price nobody read", async () => {
    const { container } = await mount({ ipv4: { state: "unavailable" } });
    await press(button(container, "Get one"));
    expect(text(part(container, "ip"))).toContain("Its price can't be read here.");
    expect(button(container, "Get it").disabled).toBe(true);
  });

  it("an own IPv4 says how to stop renewing it", async () => {
    const place: PlaceAddresses = {
      ...ADDRESSES_FIXTURE,
      ips: { ...ADDRESSES_FIXTURE.ips, ownV4: "203.0.113.24" },
    };
    const { container } = await mount({ place });
    const ip = text(part(container, "ip"));
    expect(ip).toContain("203.0.113.24");
    expect(ip).toContain("turn it off in Zerops to stop it.");
    expect(container.querySelector('a[href="https://app.zerops.io/project/p1"]')).not.toBeNull();
  });

  it("a refused write says why in a sentence", async () => {
    const sentence = "docs.shop.com is already in use on Zerops.";
    const { container } = await mount({
      startAdding: true,
      trouble: new Map([["add-domain", sentence]]),
    });
    const form = container.querySelector('[data-addresses-form="add-domain"]')!;
    expect(text(form.querySelector("[data-addresses-trouble]"))).toBe(sentence);
  });

  it("removing a domain asks once and keeps the routing's other domains", async () => {
    const { container, writes } = await mount();
    await act(async () => {
      // The row's ··· menu opens its items in a portal; the remove ask is what it leads to.
      button(container, "More for www.shop.com").click();
    });
    const remove = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
      (item) => item.textContent === "Remove www.shop.com",
    )!;
    await press(remove);
    expect(text(part(container, "domains"))).toContain("It stops answering right away.");
    await press(button(container, "Remove www.shop.com"));
    expect(writes).toEqual([
      {
        kind: "remove-domain",
        projectId: "p1",
        routingId: "rt-shop",
        domainName: "www.shop.com",
        keep: ["shop.com"],
        locations: [{ path: "/", port: 3000, serviceStackId: "svc-app" }],
        sslEnabled: true,
      },
    ]);
  });

  it("the switch moves between the project's places", async () => {
    const moved: string[] = [];
    const { container } = await mount({
      places: [
        { projectId: "p1", kind: "production", label: "Production", name: "Production" },
        { projectId: "p2", kind: "stage", label: "Stage", name: "Stage" },
        { projectId: "p3", kind: "mate", label: "Filip", name: "Filip", owner: "Lukas" },
      ],
      onPlace: (projectId) => moved.push(projectId),
    });
    await act(async () => {
      button(container, "Place: Production").click();
    });
    const items = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')];
    expect(items.map((item) => item.textContent)).toEqual([
      "Production",
      "Stage",
      "Filip· Lukas's",
    ]);
    await press(items[2]!);
    expect(moved).toEqual(["p3"]);
  });

  // The live audit (2026-10-28): Larkspur's empty production offered its own IPv4 to buy and
  // a port to open, with nothing deployed there to reach.
  it.each([
    { case: "production", kind: "production", placeName: "Production", alone: true },
    { case: "a stage", kind: "stage", placeName: "Stage", alone: true },
    {
      case: "a Mate's own project, whose workspace runs without a deploy",
      kind: "mate",
      placeName: "Fen",
      alone: false,
    },
  ] as const)(
    "An environment with nothing deployed says one line in its addresses' place: $case",
    async ({ kind, placeName, alone }) => {
      const { container } = await mount({
        placeName,
        places: [{ projectId: "p1", kind, label: placeName, name: placeName }],
        place: { ...ADDRESSES_FIXTURE, nothingDeployed: true, domains: [], ports: [] },
      });
      expect(text(container).includes(`Nothing runs in ${placeName} yet.`)).toBe(alone);
      // What a running place offers sits behind the sheet's last line until asked for.
      const more = container.querySelector("[data-addresses-more]");
      expect(more !== null).toBe(!alone);
      if (more !== null) await press(more);
      const said = text(container);
      expect(said.includes("Get one")).toBe(!alone);
      expect(said.includes("Open a port")).toBe(!alone);
    },
  );

  it("An environment with nothing deployed still lists a domain added before its first release, to see or remove", async () => {
    const { container } = await mount({
      placeName: "Production",
      places: [{ projectId: "p1", kind: "production", label: "Production", name: "Production" }],
      place: { ...ADDRESSES_FIXTURE, nothingDeployed: true, ports: [] },
    });
    const said = text(container);
    expect(said.includes("Nothing runs in Production yet.")).toBe(false);
    expect(said).toContain("shop.com");
  });

  it("a domain of a routing waits to be removed until the other's removal lands", async () => {
    const removing: PlaceAddresses = {
      ...ADDRESSES_FIXTURE,
      domains: ADDRESSES_FIXTURE.domains.map((domain) =>
        domain.domainName === "shop.com" ? { ...domain, face: "removing" } : domain,
      ),
    };
    const { container } = await mount({ place: removing });
    await act(async () => {
      button(container, "More for www.shop.com").click();
    });
    const items = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')];
    const wait = items.find((item) => item.textContent === "Wait until shop.com is removed");
    expect(wait?.getAttribute("aria-disabled")).toBe("true");
    expect(items.some((item) => item.textContent === "Remove www.shop.com")).toBe(false);
  });

  it("changing an IPv4 port keeps it on IPv4", async () => {
    const place: PlaceAddresses = {
      ...ADDRESSES_FIXTURE,
      ports: [
        {
          ...ADDRESSES_FIXTURE.ports[0]!,
          publicIpType: "IP_V4",
          ranges: ["198.51.100.20/32"],
          address: "203.0.113.24:6432",
        },
      ],
    };
    const { container, writes } = await mount({ place });
    await act(async () => {
      button(container, "More for port 6432").click();
    });
    const change = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
      (item) => item.textContent === "Change who can connect",
    )!;
    await press(change);
    await press(button(container, "Save"));
    expect(writes).toMatchObject([
      { kind: "change-port", publicIpType: "IP_V4", firewallIpRanges: ["198.51.100.20/32"] },
    ]);
  });

  it("the own IPv4 is not offered again while it is on its way", async () => {
    const enabled = await mount({ ipv4: { state: "known", price: 3, enabled: true } });
    expect(text(part(enabled.container, "ip"))).toContain("On its way");
    expect(() => button(enabled.container, "Get one")).toThrow();
    await act(async () => root?.unmount());

    const unsure = await mount({ unsure: new Set(["request-ipv4"]) });
    expect(text(part(unsure.container, "ip"))).toContain("may be on its way");
    expect(() => button(unsure.container, "Get one")).toThrow();
  });

  it("an answer does not close a form the person opened meanwhile", async () => {
    let answer: (taken: boolean) => void = () => {};
    const { container } = await mount({
      onWrite: () =>
        new Promise<boolean>((resolve) => {
          answer = resolve;
        }),
    });
    await press(button(container, "Get one"));
    await press(button(container, "Get it for $3"));
    await press(button(container, "Add a domain"));
    await act(async () => answer(true));
    expect(container.querySelector('[data-addresses-form="add-domain"]')).not.toBeNull();
  });

  it("the ask before putting others' changes live goes once they are live", async () => {
    const waiting = {
      domains: [{ id: "rt-api", label: "api.shop.com → api · port 8080" }],
      ports: [],
    };
    const { container, writes, rerender } = await mount({
      place: ONE_SERVICE,
      othersWaiting: waiting,
      startAdding: true,
    });
    const form = container.querySelector('[data-addresses-form="add-domain"]')!;
    await type(form.querySelector<HTMLInputElement>("input")!, "docs.shop.com");
    await press(button(form, "Add docs.shop.com"));
    expect(text(form)).toContain("also puts live a change made elsewhere");
    await rerender({ othersWaiting: { domains: [], ports: [] }, startAdding: true });
    expect(text(form)).not.toContain("made elsewhere");
    await press(button(form, "Add docs.shop.com"));
    expect(writes).toMatchObject([{ kind: "add-domain", domains: ["docs.shop.com"] }]);
  });

  it("changes wait until the place's addresses are read", async () => {
    const { container } = await mount({ place: { ...ADDRESSES_FIXTURE, state: "reading" } });
    expect(text(container)).toContain("Changes wait until it's read.");
    expect(button(container, "Add a domain").disabled).toBe(true);
    expect(button(container, "Get one").disabled).toBe(true);
  });

  // witness: apps/web/src/components/zerops/addresses/AddressesDomains.tsx | targets.length === 1 ? targets[0] : targets.find((each) => targetValue(each) === target); → targets[0];
  it("a domain is not added until the person says which of several services it opens", async () => {
    const { container, writes } = await mount({ startAdding: true });
    const form = container.querySelector('[data-addresses-form="add-domain"]')!;
    await type(form.querySelector<HTMLInputElement>("input")!, "new.com");
    expect(text(form)).toContain("Choose a service");
    expect(button(form, "Add new.com").disabled).toBe(true);
    expect(writes).toEqual([]);
  });

  // witness: apps/web/src/components/zerops/addresses/AddressesDomains.tsx | if (own || hold || !stale || asked.current) return; → if (own || hold || stale || asked.current) return;
  it("a waiting domain not looked up for a while is looked up once as the sheet shows it", async () => {
    const { writes, rerender } = await mount({ nowMs: Date.parse("2026-10-14T13:00:00Z") });
    expect(writes).toEqual([{ kind: "check-domain-dns", projectId: "p1", routingId: "rt-blog" }]);
    await rerender({ nowMs: Date.parse("2026-10-14T13:30:00Z") });
    expect(writes).toHaveLength(1);
  });

  // witness: apps/web/src/components/zerops/addresses/AddressesDomains.tsx | const first = none && inviting; → const first = none;
  it("production with no domain yet shows the field to type one into; a Mate's own workspace offers it as a press", async () => {
    const none: PlaceAddresses = { ...ADDRESSES_FIXTURE, domains: [] };
    const production = await mount({
      place: none,
      places: [{ projectId: "p1", kind: "production", label: "Production", name: "Production" }],
    });
    expect(production.container.querySelector('[data-addresses-form="add-domain"]')).not.toBeNull();
    await act(async () => root?.unmount());

    const mate = await mount({
      place: none,
      placeName: "Fen",
      places: [{ projectId: "p1", kind: "mate", label: "Fen", name: "Fen" }],
    });
    expect(mate.container.querySelector('[data-addresses-form="add-domain"]')).toBeNull();
    expect(text(part(mate.container, "domains"))).toContain("No domain yet.");
    await press(button(mate.container, "Put it on your domain"));
    expect(mate.container.querySelector('[data-addresses-form="add-domain"]')).not.toBeNull();
  });

  // witness: apps/web/src/components/zerops/addresses/AddressesDomains.tsx | const found = recordsFound(domains, records); → const found = recordsFound([], records);
  it("a record the last look-up found is ticked, and the ones still missing keep their copy", async () => {
    const place: PlaceAddresses = {
      ...ADDRESSES_FIXTURE,
      domains: ADDRESSES_FIXTURE.domains.map((domain) =>
        domain.domainName === "blog.com" ? { ...domain, resolvedIps: ["93.185.106.128"] } : domain,
      ),
    };
    const { container } = await mount({ place });
    const records = container.querySelector('[data-addresses-records="rt-blog"]')!;
    expect(records.querySelectorAll("[data-record-found]")).toHaveLength(1);
    expect(text(records.querySelector("[data-record-found]"))).toContain("Found");
    expect(text(records.querySelector("[data-addresses-checked]"))).toBe(
      "Checked 2 minutes ago: 1 of 4 found.",
    );
  });

  // witness: apps/web/src/components/zerops/addresses/AddressesDomains.tsx | place.domains.every((domain) => domain.routingId.startsWith("own:")) → place.domains.length === 0
  it("production's first domain form stays, with what was typed, while its own add is under way", async () => {
    const none: PlaceAddresses = { ...ONE_SERVICE, domains: [] };
    const places = [
      { projectId: "p1", kind: "production", label: "Production", name: "Production" },
    ] as const;
    const { container, rerender } = await mount({ place: none, places });
    const input = () =>
      container.querySelector<HTMLInputElement>('[data-addresses-form="add-domain"] input');
    await type(input()!, "new.com");
    // The add under way is drawn as a domain of the place at once; a refusal takes it back.
    const underWay: PlaceAddresses = {
      ...none,
      domains: [
        {
          ...ADDRESSES_FIXTURE.domains[0]!,
          routingId: "own:new.com",
          domainName: "new.com",
          routingDomains: ["new.com"],
          face: "going-live",
        },
      ],
    };
    await rerender({ place: underWay, places, busy: new Set(["add-domain"]) });
    expect(input()?.value).toBe("new.com");
    await rerender({ place: none, places, trouble: new Map([["add-domain", "Refused."]]) });
    expect(input()?.value).toBe("new.com");
  });

  // witness: apps/web/src/components/zerops/addresses/AddressesDomains.tsx | {failed !== undefined ? ( → {failed !== undefined && waiting.length === 0 ? (
  it("a refused certificate says why even while another domain of its setup waits for records", async () => {
    const place: PlaceAddresses = {
      ...ADDRESSES_FIXTURE,
      domains: ADDRESSES_FIXTURE.domains.map((domain) =>
        domain.domainName === "blog.com"
          ? { ...domain, face: "certificate-failed", sslError: "The challenge answered 403." }
          : domain,
      ),
    };
    const { container } = await mount({ place });
    const said = text(part(container, "domains"));
    expect(said).toContain("Zerops couldn't get blog.com its https certificate");
    expect(said).toContain("The challenge answered 403.");
    // The waiting sibling's records are still asked for, with their one check.
    expect(recordRows(container.querySelector('[data-addresses-records="rt-blog"]')!)).toEqual([
      ["A", "www.blog.com", "93.185.106.128"],
      ["AAAA", "www.blog.com", "2001:db8:4a7:1d::1"],
    ]);
    expect(() => button(container, "Try again")).toThrow();
  });

  // witness: apps/web/src/components/zerops/addresses/AddressesSheet.tsx | props.place.ports.length > 0 || →
  it("open ports and IP addresses are one line until asked for, and in the open once a port is", async () => {
    const quiet = await mount({ place: { ...ADDRESSES_FIXTURE, ports: [] } });
    expect(quiet.container.querySelector('[data-addresses-part="direct"]')).toBeNull();
    expect(text(quiet.container)).toContain("Show direct connections and IP addresses");
    await press(quiet.container.querySelector("[data-addresses-more]")!);
    expect(text(part(quiet.container, "ip"))).toContain("2001:db8:4a7:1d::1");
    await act(async () => root?.unmount());

    const open = await mount();
    expect(open.container.querySelector("[data-addresses-more]")).toBeNull();
    expect(text(part(open.container, "direct"))).toContain("Only 2 addresses");
  });
});
