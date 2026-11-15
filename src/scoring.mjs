// Scoring shared by the keyword tool and the editorial report. Every weight is written here so the
// ranking is explainable; change weights here, not in the tools.
export const LEVEL = { high: 3, medium: 2, low: 1 };

// Keyword priority, 0–100. Inputs are labelled estimates unless the row says "measured".
//   likelihood (1–5) x4, opportunity (1–5) x3, demand level x3, verifiable now +4 / after launch +2, competition level x-2
export function keywordPriority(k) {
  const raw = k.likelihood * 4 + k.opportunity * 3 + LEVEL[k.demand.level] * 3
    + (k.verifiable === "now" ? 4 : k.verifiable === "after-launch" ? 2 : 0) - LEVEL[k.competition.level] * 2;
  const min = 1 * 4 + 1 * 3 + 1 * 3 + 0 - 3 * 2; // 4
  const max = 5 * 4 + 5 * 3 + 3 * 3 + 4 - 1 * 2; // 46
  return Math.round(((raw - min) / (max - min)) * 100);
}

// Expected organic CTR by average position. A rough benchmark for "is this page under-performing?",
// not a fact. Replace with your own Search Console averages once you have 4+ weeks of data.
export function expectedCtr(position) {
  const table = [[1, 0.28], [2, 0.16], [3, 0.11], [4, 0.08], [5, 0.06], [6, 0.05], [7, 0.04], [8, 0.03], [9, 0.025], [10, 0.02]];
  for (const [p, c] of table) if (position <= p + 0.5) return c;
  return 0.01;
}

// Source weights for reader questions. Search evidence counts most; social buzz least, because social
// popularity is not search demand.
export const SOURCE_WEIGHT = { search: 3, "search-console": 3, email: 2, comments: 2, "site-search": 2, social: 1, reddit: 1, forum: 1 };

const STOP = new Set("the a an and or of to in on for is are do does how what when where why can i my you it gta 6 vi gta6 with from at be this that there".split(" "));
export const tokens = (s) => s.toLowerCase().replace(/gta ?(6|vi)\b/g, " ").replace(/[^a-z0-9$' ]+/g, " ").split(/\s+/).filter((t) => t.length > 1 && !STOP.has(t));
export function overlap(a, b) {
  const A = new Set(tokens(a)), B = new Set(tokens(b));
  if (!A.size || !B.size) return 0;
  let n = 0; for (const t of A) if (B.has(t)) n++;
  return n / Math.min(A.size, B.size);
}
