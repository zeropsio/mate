/**
 * The agent's own name.
 *
 * One environment is one container, one agent, one conversation — so the thing
 * a person talks to is not "beviro-crm-dev", it is somebody. In a menu already
 * nested under its group and badged with its role, the project name says the
 * same thing three times; a name says the one thing the row is missing, and it
 * gives the user something to address ("ask Ada to take the migration").
 *
 * The name lives in the project's `mate:bot:` tag (`groups.ts`), for the same
 * reasons the group does: it survives the container being rebuilt, it needs no
 * store, and it is visible in the Zerops GUI, where a project's tags are how a
 * person recognises it.
 *
 * Names are assigned at creation and are the user's to change. Nothing here
 * decides what an agent is *doing* — that is `resolveThreadStatus`, the one
 * status resolver, and it is knowable only for an environment mate is
 * connected to.
 */
import type { RandomBytes } from "./newProject.ts";

/**
 * Short, easy to say, and easy to tell apart at a glance in a menu. Kept
 * deliberately plain: a name is an address, not a personality, and a pool of
 * jokes gets old on the fiftieth environment.
 */
const BOT_NAMES = [
  "Ada",
  "Bruno",
  "Cleo",
  "Dara",
  "Enzo",
  "Fen",
  "Gita",
  "Hugo",
  "Iris",
  "Juno",
  "Kai",
  "Lena",
  "Milo",
  "Nova",
  "Otto",
  "Pia",
  "Quinn",
  "Rune",
  "Sana",
  "Theo",
  "Uma",
  "Vera",
  "Wren",
  "Yuki",
  "Zane",
] as const;

export const ZEROPS_BOT_NAME_POOL: ReadonlyArray<string> = BOT_NAMES;

/**
 * A name no sibling is using.
 *
 * Randomised rather than sequential so two environments created at once do not
 * race for the same name, and so a group does not read as Ada/Bruno/Cleo in
 * creation order — which invites people to think the order means something.
 *
 * Randomness is a parameter: this package is platform-free (R1) and may not
 * reach for a global crypto.
 */
export function generateBotName(taken: ReadonlyArray<string>, randomBytes: RandomBytes): string {
  const used = new Set(taken.map((name) => name.trim().toLowerCase()));
  const free = BOT_NAMES.filter((name) => !used.has(name.toLowerCase()));

  if (free.length > 0) return free[pick(free.length, randomBytes)] ?? free[0]!;

  // Every name is spoken for. Suffixing beats failing: a person can rename it,
  // but they cannot create an environment that refuses to be named.
  for (let suffix = 2; ; suffix += 1) {
    const candidates = BOT_NAMES.map((name) => `${name} ${suffix}`).filter(
      (name) => !used.has(name.toLowerCase()),
    );
    if (candidates.length > 0)
      return candidates[pick(candidates.length, randomBytes)] ?? candidates[0]!;
  }
}

/**
 * Rejection sampling, so a pool size that does not divide 256 does not make the
 * first names likelier than the last.
 */
function pick(size: number, randomBytes: RandomBytes): number {
  const limit = Math.floor(256 / size) * size;
  for (;;) {
    for (const byte of randomBytes(new Uint8Array(16))) {
      if (byte < limit) return byte % size;
    }
  }
}

/**
 * What to call this environment in a menu row: its agent's name, falling back
 * to the project's own name for an environment created before names existed or
 * by something that does not know about them.
 */
export function botDisplayName(input: {
  readonly bot: string | undefined;
  readonly projectName: string;
}): string {
  const bot = input.bot?.trim();
  return bot !== undefined && bot.length > 0 ? bot : input.projectName;
}

/** Whether this row is showing a real agent name or falling back. */
export function hasBotName(bot: string | undefined): boolean {
  return bot !== undefined && bot.trim().length > 0;
}
