// Content loading shared by the site builder and the editorial tools.
// Articles live in content/articles/*.md (front matter + Markdown). Nothing here touches the network.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import matter from "gray-matter";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const readJSON = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), "utf8"));

// The six editorial statuses. Only the last two are visible on the public site.
export const STATUSES = ["research", "drafting", "fact-checking", "review", "published", "needs-updating"];
export const PUBLIC_STATUSES = new Set(["published", "needs-updating"]);
// How sure we are about the page as a whole. Individual claims also carry callouts in the body.
export const CONFIDENCE = {
  confirmed: { label: "Confirmed", note: "Every key claim is backed by an official Rockstar source." },
  mixed: { label: "Confirmed + reported", note: "Official facts plus clearly labeled reports from other outlets." },
  unconfirmed: { label: "Unconfirmed", note: "Not yet confirmed by Rockstar. Treat as provisional." },
  predicted: { label: "Prediction", note: "Our expectation, not a fact. Clearly marked as a prediction." },
  theory: { label: "Fan theory", note: "A popular idea from the community, not a fact. Shown with the evidence for and against it." },
};
export const SOURCE_TYPES = { official: "Official", reported: "Reported", community: "Community", platform: "Platform holder" };

export const config = () => readJSON("site.config.json");
export const categories = () => readJSON("content/categories.json").categories;

const toDate = (v) => (v instanceof Date ? v : v ? new Date(v) : null);
const iso = (d) => (d ? d.toISOString().slice(0, 10) : null);

export function loadArticles() {
  const dir = path.join(ROOT, "content/articles");
  const cats = new Set(categories().map((c) => c.slug));
  const out = [];
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".md")).sort()) {
    const raw = fs.readFileSync(path.join(dir, file), "utf8");
    const { data, content } = matter(raw);
    const slug = data.slug || file.replace(/\.md$/, "");
    const problems = [];
    for (const k of ["title", "description", "category", "status"]) if (!data[k]) problems.push(`missing ${k}`);
    if (data.category && !cats.has(data.category)) problems.push(`unknown category "${data.category}"`);
    if (data.status && !STATUSES.includes(data.status)) problems.push(`unknown status "${data.status}"`);
    if (data.confidence && !CONFIDENCE[data.confidence]) problems.push(`unknown confidence "${data.confidence}"`);
    if (PUBLIC_STATUSES.has(data.status) && !(data.sources || []).length) problems.push("published without sources");
    if (problems.length) throw new Error(`${file}: ${problems.join(", ")}`);
    out.push({
      file,
      slug,
      title: data.title,
      seoTitle: data.seoTitle || data.title,
      description: data.description,
      category: data.category,
      status: data.status,
      confidence: data.confidence || "unconfirmed",
      targetQuery: data.targetQuery || "",
      publishDate: iso(toDate(data.publishDate)),
      updated: iso(toDate(data.updated || data.publishDate)),
      lastVerified: iso(toDate(data.lastVerified || data.updated || data.publishDate)),
      reviewBy: iso(toDate(data.reviewBy)),
      featured: !!data.featured,
      image: data.image || "",
      imageAlt: data.imageAlt || "",
      sources: data.sources || [],
      faqs: data.faqs || [],
      related: data.related || [],
      updateLog: data.updateLog || [],
      answer: data.answer || "",
      updatedAt: data.updatedAt ? new Date(data.updatedAt).toISOString() : null,
      author: data.author || "Neon Atlas Editors",
      body: content,
      url: `/${data.category}/${slug}/`,
    });
  }
  const seen = new Map();
  for (const a of out) {
    if (seen.has(a.slug)) throw new Error(`duplicate slug "${a.slug}" in ${a.file} and ${seen.get(a.slug)}`);
    seen.set(a.slug, a.file);
  }
  return out;
}

// Live = public status and a publish date that has arrived (future dates are "scheduled").
export function isLive(a, now = new Date()) {
  return PUBLIC_STATUSES.has(a.status) && !!a.publishDate && new Date(a.publishDate + "T00:00:00Z") <= now;
}
export const isScheduled = (a, now = new Date()) =>
  PUBLIC_STATUSES.has(a.status) && a.publishDate && new Date(a.publishDate + "T00:00:00Z") > now;

export function loadPages() {
  const dir = path.join(ROOT, "content/pages");
  return fs.readdirSync(dir).filter((f) => f.endsWith(".md")).map((f) => {
    const { data, content } = matter(fs.readFileSync(path.join(dir, f), "utf8"));
    const slug = f.replace(/\.md$/, "");
    return { slug, title: data.title, description: data.description, updated: iso(toDate(data.updated)), body: content, url: `/${slug}/`, noindex: !!data.noindex };
  });
}

export const wordCount = (md) => md.replace(/[#>*_`\[\]()!-]/g, " ").split(/\s+/).filter(Boolean).length;
export const slugify = (s) => s.toLowerCase().replace(/['’]/g, "").replace(/&#?[a-z0-9]+;/g, "").replace(/<[^>]+>/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
