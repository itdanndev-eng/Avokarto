/**
 * Store name ideas for /start: short, brandable names that read like real
 * dropshipping stores (trending gadgets, home, beauty, pets, gifts, fashion),
 * or - once the seller types a word or their own name - ideas built around it
 * ("Riya" -> "Riya Trends", "Shop Riya"). Deterministic for a given input and
 * round, so a shuffle is just round + 1.
 */

export const STORE_NAME_EXAMPLES = [
  // trending / general
  "Trendora", "Shopnova", "Trendvibe", "Cartella", "Zestify", "Sparkd", "OddBox Finds", "Daily Drift",
  // home & decor
  "Nestify", "Urban Nook", "Cozy Cart", "Brightnest", "Hello Hygge", "Decorista", "Lumora",
  // tech & gadgets
  "Gadgetry", "TechNest", "Gizmo Garage", "Snaply", "Pixel & Pine",
  // beauty & fashion
  "Glowberry", "Glamourly", "Velvetly", "LuxeLoop", "Vibe Haus", "Bloomly",
  // pets, kids, fitness
  "PawPerks", "Pawsome Picks", "Kiddo Corner", "FitFuel", "Wanderwise",
  // gifts & creative
  "The Gift Lab", "Craftnest", "Muse & Make", "Nookly", "Wonder Crate",
];

const PATTERNS: ((word: string) => string)[] = [
  (word) => `${word} Trends`,
  (word) => `Shop ${word}`,
  (word) => `${word} Finds`,
  (word) => `${word}Cart`,
  (word) => `${word} Hub`,
  (word) => `The ${word} Store`,
  (word) => `${word} & Co.`,
  (word) => `${possessive(word)} Picks`,
  (word) => `${word} Lab`,
  (word) => `${word}verse`,
];

/** The smallest step from 3 up that shares no factor with `size`, so stepping visits every name. */
function strideFor(size: number) {
  const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
  let stride = 3;
  while (gcd(stride, size) !== 1) stride += 1;
  return stride;
}

function possessive(word: string) {
  return /s$/i.test(word) ? `${word}'` : `${word}'s`;
}

/** The typed word to build on, title-cased - or null if there isn't a usable one. */
export function nameSeed(typed: string) {
  const word = typed.trim().split(/\s+/)[0] ?? "";
  if (!/^[\p{L}]{2,14}$/u.test(word)) return null;
  // Ideas built on "The" or "Shop" would read badly ("House of The").
  if (/^(the|shop|store|my|and)$/i.test(word)) return null;
  return word[0].toLocaleUpperCase() + word.slice(1).toLocaleLowerCase();
}

/**
 * `typed` is what the seller wrote themselves (ideas build on it); `current`
 * is the name in the field now, which is never suggested back.
 */
export function storeNameIdeas(typed: string, current: string, round: number, count = 3, isUnavailable?: (name: string) => boolean) {
  const { pool, seed } = storeNamePool(typed);
  // Names whose store link is already taken are never offered.
  const usable = isUnavailable ? pool.filter((name) => !isUnavailable(name)) : pool;
  return { ideas: pickIdeas(usable, current, round, count), seed };
}

/** Every name the ideas for this input can come from, to check their links in one go. */
export function storeNamePool(typed: string) {
  // A name picked from the list keeps the list (not "Maple & Co." for "Maple & Moss").
  const seed = STORE_NAME_EXAMPLES.some((name) => name.toLowerCase() === typed.trim().toLowerCase()) ? null : nameSeed(typed);
  return { pool: seed ? PATTERNS.map((pattern) => pattern(seed)) : STORE_NAME_EXAMPLES, seed };
}

/** Short, believable taglines for a dropshipping store - no promises the seller can't keep. */
export const TAGLINE_EXAMPLES = [
  "Trending finds, shipped to your door.",
  "Viral products at fair prices.",
  "Smart gadgets for everyday life.",
  "Cozy home upgrades, delivered.",
  "Glow-up essentials you'll love.",
  "Happy pets, happy homes.",
  "Gifts they'll actually use.",
  "Little luxuries, big smiles.",
  "Everyday essentials, made better.",
  "Style that ships to your door.",
  "Clever finds for curious minds.",
  "The things you didn't know you needed.",
];

export function taglineIdeas(current: string, round: number, count = 2) {
  return pickIdeas(TAGLINE_EXAMPLES, current, round, count);
}

/** `count` ideas from `pool` for this shuffle round, never the one already in the field. */
function pickIdeas(pool: readonly string[], current: string, round: number, count: number) {
  const currentKey = current.trim().toLowerCase();
  const ideas: string[] = [];
  if (!pool.length) return ideas;
  // Coprime with the pool size: walks every idea before repeating.
  const stride = strideFor(pool.length);
  for (let index = 0; ideas.length < count && index < pool.length; index += 1) {
    const idea = pool[(round * count * stride + index * stride) % pool.length];
    if (idea.toLowerCase() !== currentKey && !ideas.includes(idea)) ideas.push(idea);
  }
  return ideas;
}
