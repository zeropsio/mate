/**
 * What a new Mate costs, as far as anything here knows it: no read the client makes prices a
 * Mate's computer (the platform's only price read is a project's IPv4 addon), so the line says
 * what is true — it runs on its own computer, billed by Zerops by use — and links Zerops's prices
 * rather than inventing a number. Pure: the words.
 */
export const ZEROPS_PRICING_URL = "https://zerops.io/pricing";

export function newMateCost(botName: string): string {
  const name = botName.trim();
  return `${name === "" ? "It" : name} runs on its own computer, which Zerops bills by use while it runs.`;
}
