// Cloudflare Worker for neonatlasguide.com. Static pages are served straight from dist/ (wrangler.jsonc "assets");
// only /api/* reaches this code (run_worker_first), where it handles fan-theory votes (src/votes.mjs).
// Votes live in one SQLite-backed Durable Object, which is on Cloudflare's free plan and is created automatically
// on deploy by the "migrations" entry in wrangler.jsonc: no database to set up by hand.
import { DurableObject } from "cloudflare:workers";
import { handleApi } from "./votes.mjs";

export class VoteCounter extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS votes (voter TEXT NOT NULL, id TEXT NOT NULL, choice TEXT NOT NULL, ip_hash TEXT, day TEXT, PRIMARY KEY (voter, id))`);
    this.sql.exec(`CREATE INDEX IF NOT EXISTS votes_ip ON votes (ip_hash, id, day)`);
  }
  counts() {
    const c = {};
    for (const r of this.sql.exec(`SELECT id, choice, COUNT(*) AS n FROM votes GROUP BY id, choice`)) { c[r.id] ||= { yes: 0, no: 0 }; c[r.id][r.choice] = r.n; }
    return c;
  }
  mine(voter) { return Object.fromEntries([...this.sql.exec(`SELECT id, choice FROM votes WHERE voter = ?`, voter)].map((r) => [r.id, r.choice])); }
  get(voter, id) { return [...this.sql.exec(`SELECT choice FROM votes WHERE voter = ? AND id = ?`, voter, id)][0]?.choice || null; }
  ipCount(ipHash, id, day) { return [...this.sql.exec(`SELECT COUNT(*) AS n FROM votes WHERE ip_hash = ? AND id = ? AND day = ?`, ipHash, id, day)][0].n; }
  put(voter, id, choice, ipHash, day) {
    this.sql.exec(`INSERT INTO votes (voter, id, choice, ip_hash, day) VALUES (?, ?, ?, ?, ?) ON CONFLICT (voter, id) DO UPDATE SET choice = excluded.choice`, voter, id, choice, ipHash, day);
  }
  remove(voter, id) { this.sql.exec(`DELETE FROM votes WHERE voter = ? AND id = ?`, voter, id); }
}

let idsCache = { at: 0, ids: new Set() };
async function theoryIds(env, request) {
  if (Date.now() - idsCache.at < 5 * 60 * 1000 && idsCache.ids.size) return idsCache.ids;
  const r = await env.ASSETS.fetch(new Request(new URL("/theories/ids.json", request.url)));
  idsCache = { at: Date.now(), ids: new Set(r.ok ? await r.json() : []) };
  return idsCache.ids;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);
    const stub = env.VOTES.get(env.VOTES.idFromName("global"));
    const store = {
      counts: () => stub.counts(), mine: (v) => stub.mine(v), get: (v, i) => stub.get(v, i),
      ipCount: (h, i, d) => stub.ipCount(h, i, d), put: (v, i, c, h, d) => stub.put(v, i, c, h, d), remove: (v, i) => stub.remove(v, i),
    };
    try {
      return await handleApi(request, { store, ids: await theoryIds(env, request), ip: request.headers.get("CF-Connecting-IP") || "", secure: url.protocol === "https:" });
    } catch (e) {
      return new Response(JSON.stringify({ error: "Voting is temporarily unavailable." }), { status: 503, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
    }
  },
};
