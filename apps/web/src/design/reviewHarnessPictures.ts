/**
 * A change's description with its screenshots, as the harness's Gitea hands them over: drawn
 * here, never fetched, each after the delay its address names — so a review shows its pictures
 * arriving slowly, settled, and one that cannot be read. Fixtures only.
 */
import type { GiteaPictureSource } from "~/zerops/useGiteaPicture";

/** The harness's Gitea: an address no browser resolves. */
export const HARNESS_GITEA = "https://git.example.test";

/** A wide screenshot of the /status page, 1280 × 800. */
function wideScreenshot(): string {
  const card = (x: number, label: string, value: string, tone: string) =>
    `<g transform="translate(${String(x)} 170)"><rect width="352" height="180" rx="16" fill="#ffffff" stroke="#e4e4e7"/>` +
    `<text x="28" y="52" font-family="system-ui, sans-serif" font-size="22" fill="#71717a">${label}</text>` +
    `<text x="28" y="118" font-family="system-ui, sans-serif" font-size="48" font-weight="600" fill="${tone}">${value}</text></g>`;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="800" viewBox="0 0 1280 800">` +
    `<rect width="1280" height="800" fill="#f4f4f5"/>` +
    `<rect width="1280" height="72" fill="#18181b"/>` +
    `<text x="48" y="46" font-family="system-ui, sans-serif" font-size="24" font-weight="600" fill="#fafafa">Snap admin · Status</text>` +
    `<text x="48" y="134" font-family="system-ui, sans-serif" font-size="30" font-weight="600" fill="#18181b">Everything is running</text>` +
    card(48, "Uptime", "14 d 6 h", "#16a34a") +
    card(464, "Version", "v0.1.57", "#18181b") +
    card(880, "Last deploy", "4 min ago", "#18181b") +
    `<rect x="48" y="390" width="1184" height="360" rx="16" fill="#ffffff" stroke="#e4e4e7"/>` +
    `<polyline points="88,690 248,640 408,660 568,560 728,590 888,500 1048,520 1192,450" fill="none" stroke="#2563eb" stroke-width="6" stroke-linejoin="round"/>` +
    `<text x="88" y="440" font-family="system-ui, sans-serif" font-size="22" fill="#71717a">Requests, the last hour</text>` +
    `</svg>`
  );
}

/** The same page on a phone, 390 × 844: a picture much taller than the column's shape. */
function phoneScreenshot(): string {
  const card = (y: number, label: string, value: string) =>
    `<g transform="translate(20 ${String(y)})"><rect width="350" height="150" rx="18" fill="#ffffff" stroke="#e4e4e7"/>` +
    `<text x="24" y="48" font-family="system-ui, sans-serif" font-size="20" fill="#71717a">${label}</text>` +
    `<text x="24" y="108" font-family="system-ui, sans-serif" font-size="40" font-weight="600" fill="#18181b">${value}</text></g>`;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="390" height="844" viewBox="0 0 390 844">` +
    `<rect width="390" height="844" fill="#f4f4f5"/>` +
    `<rect width="390" height="96" fill="#18181b"/>` +
    `<text x="20" y="66" font-family="system-ui, sans-serif" font-size="24" font-weight="600" fill="#fafafa">Status</text>` +
    card(126, "Uptime", "14 d 6 h") +
    card(296, "Version", "v0.1.57") +
    card(466, "Last deploy", "4 min ago") +
    `</svg>`
  );
}

const DRAWN = new Map<string, string>([
  ["status-wide", wideScreenshot()],
  ["status-phone", phoneScreenshot()],
]);

/**
 * `${HARNESS_GITEA}/attachments/<drawing>?after=<ms>`: the drawing, handed over after `ms`; an
 * address naming no drawing fails as a browser's read of Gitea's own attachment does today — its
 * preflight answered 303, a network error with no status.
 */
export const HARNESS_PICTURES: GiteaPictureSource = {
  ready: true,
  read: (address) => {
    const url = new URL(address);
    const drawing = DRAWN.get(url.pathname.split("/").at(-1) ?? "");
    const after = Number(url.searchParams.get("after") ?? "0");
    return new Promise((resolve, reject) => {
      setTimeout(() => {
        if (drawing === undefined) {
          reject(new TypeError("Failed to fetch"));
          return;
        }
        resolve(new Blob([drawing], { type: "image/svg+xml" }));
      }, after);
    });
  },
};

/**
 * A description in full, its two screenshots read after `after` ms: `missing` makes the second
 * unreadable, `unreadable` both — as every picture is from a browser today.
 */
export function harnessDescription(options: {
  readonly after: number;
  readonly missing?: boolean;
  readonly unreadable?: boolean;
}): string {
  const at = (drawing: string) =>
    `${HARNESS_GITEA}/attachments/${options.unreadable === true ? `${drawing}-refused` : drawing}?after=${String(options.after)}`;
  return [
    "Adds a **/status** page an admin opens to see whether the app is healthy without reading its logs.",
    "",
    "## What changed",
    "",
    "- `GET /status` answers the uptime, the running version and the last deploy.",
    "- The page refreshes every 30 seconds and stays behind the sign-in, like the other admin pages.",
    "- `.nvmrc` moves to Node 22, which the new `performance.timeOrigin` read needs.",
    "",
    "## How it was checked",
    "",
    "Opened on the dev service, signed in as an admin:",
    "",
    `![The status page on a wide screen](${at("status-wide")})`,
    "",
    "and on a phone, where the cards stack:",
    "",
    `![The status page on a phone](${at(options.missing === true ? "status-gone" : "status-phone")})`,
    "",
    "The build passes, and `/status` answers in 12 ms. The old `/health` route stays for the load balancer.",
  ].join("\n");
}
