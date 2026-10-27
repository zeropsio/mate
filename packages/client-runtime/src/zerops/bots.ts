/**
 * The agent's own name.
 *
 * One environment is one container and one agent, which may hold several
 * chats over the same tree and is the same somebody in each — so the thing a
 * person talks to is not "beviro-crm-dev", it is somebody. In a menu already
 * nested under its group and badged with its role, the project name says the
 * same thing three times; a name says the one thing the row is missing, and it
 * gives the user something to address ("ask Ada to take the migration").
 *
 * The name is its Zerops project's: HQ reads it from the project, never keeps
 * one of its own, so it survives the container being rebuilt and every surface
 * reads the one name.
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
 *
 * Large enough that an organisation is never offered a numbered name while a
 * plain one is free: twenty-five ran out in an organisation of about thirty
 * Mates, and every proposal read "Uma 2", "Sana 2" (pass 30, 2026-10-02). At
 * most 256, because a choice draws one random byte (`pick`); names that read
 * alike side by side ("Uma"/"Una", "Rio"/"Ryo") are left out.
 */
const BOT_NAMES = [
  "Abel",
  "Ada",
  "Aiko",
  "Alba",
  "Alma",
  "Amos",
  "Anya",
  "Ari",
  "Arlo",
  "Asha",
  "Axel",
  "Aya",
  "Basil",
  "Bea",
  "Bex",
  "Bodhi",
  "Bram",
  "Bruno",
  "Cai",
  "Cal",
  "Cara",
  "Cato",
  "Cleo",
  "Cora",
  "Cyra",
  "Dag",
  "Dara",
  "Dax",
  "Demi",
  "Dino",
  "Dora",
  "Dov",
  "Drew",
  "Edda",
  "Eli",
  "Ellis",
  "Emil",
  "Ena",
  "Enzo",
  "Esme",
  "Ezio",
  "Ezra",
  "Faye",
  "Felix",
  "Fen",
  "Fern",
  "Fia",
  "Finn",
  "Flo",
  "Gael",
  "Gita",
  "Gus",
  "Gwen",
  "Hal",
  "Hana",
  "Hedy",
  "Heidi",
  "Hugo",
  "Ida",
  "Ilse",
  "Ines",
  "Inka",
  "Iris",
  "Ivo",
  "Ivy",
  "Jada",
  "Jago",
  "Jai",
  "Jalen",
  "Jem",
  "Jona",
  "Jory",
  "Jude",
  "Juno",
  "Kai",
  "Kara",
  "Kei",
  "Kian",
  "Kip",
  "Kit",
  "Koa",
  "Lark",
  "Lars",
  "Leif",
  "Lena",
  "Levi",
  "Lior",
  "Liv",
  "Lou",
  "Luca",
  "Lumi",
  "Lux",
  "Mae",
  "Mara",
  "Mavi",
  "Mika",
  "Milo",
  "Mira",
  "Nadia",
  "Nell",
  "Neve",
  "Nico",
  "Nils",
  "Nola",
  "Nova",
  "Nyx",
  "Obi",
  "Oda",
  "Odin",
  "Olga",
  "Omar",
  "Oona",
  "Opal",
  "Orla",
  "Otto",
  "Pax",
  "Penn",
  "Petra",
  "Pia",
  "Pip",
  "Quinn",
  "Rafe",
  "Raya",
  "Rex",
  "Rhea",
  "Rio",
  "Ronan",
  "Rosa",
  "Ruby",
  "Rumi",
  "Rune",
  "Sage",
  "Sana",
  "Seb",
  "Selma",
  "Sia",
  "Skye",
  "Sol",
  "Suki",
  "Taj",
  "Tali",
  "Tam",
  "Tavi",
  "Tess",
  "Theo",
  "Tim",
  "Toby",
  "Tova",
  "Ugo",
  "Uma",
  "Uri",
  "Vale",
  "Vera",
  "Vida",
  "Vik",
  "Viola",
  "Wade",
  "Willa",
  "Wim",
  "Wren",
  "Xavi",
  "Yan",
  "Yara",
  "Yuki",
  "Yves",
  "Zane",
  "Zara",
  "Zeke",
  "Zeno",
  "Zia",
  "Zoe",
  "Zola",
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
