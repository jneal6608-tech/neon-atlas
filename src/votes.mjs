// Fan-theory votes ("Believe it" / "Doubt it"): the API shared by the Cloudflare Worker (src/worker.mjs, storage in a
// SQLite Durable Object) and the local dev/test server (tools/serve.mjs, storage in memory). No accounts and no
// personal data: a random voter id in a first-party cookie lets people change their vote, and a salted hash of the
// IP address caps how many new votes one connection can add to a theory per day.
//
//   GET  /api/votes                      -> { counts: { id: { yes, no } }, mine: { id: "yes"|"no" } }
//   POST /api/vote  { id, choice }       -> same shape; choice "yes" | "no" | null (null removes your vote)

export const MAX_NEW_VOTES_PER_IP_PER_DAY = 25; // generous: phone networks put many people behind one shared IP
const COOKIE = "na_vid";
const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers } });
const readCookie = (req, name) => (req.headers.get("Cookie") || "").split(/;\s*/).map((c) => c.split("=")).find(([k]) => k === name)?.[1];
const day = () => new Date().toISOString().slice(0, 10);

async function sha256(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
}

// store: async counts(), mine(voter), get(voter, id), ipCount(ipHash, id, day), put(voter, id, choice, ipHash, day), remove(voter, id)
// ids: Set of valid theory ids. ip: client IP (may be ""). secure: set the Secure cookie flag.
export async function handleApi(request, { store, ids, ip = "", secure = true }) {
  const url = new URL(request.url);
  let voter = readCookie(request, COOKIE);
  const fresh = !voter || !/^[a-f0-9-]{36}$/.test(voter);
  if (fresh) voter = crypto.randomUUID();
  const setCookie = fresh ? { "Set-Cookie": `${COOKIE}=${voter}; Path=/; Max-Age=31536000; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}` } : {};
  const state = async () => ({ counts: await store.counts(), mine: await store.mine(voter) });

  if (url.pathname === "/api/votes" && request.method === "GET") return json(await state(), 200, setCookie);

  if (url.pathname === "/api/vote" && request.method === "POST") {
    let body;
    try { body = await request.json(); } catch { return json({ error: "Send JSON: { id, choice }" }, 400); }
    const { id, choice } = body || {};
    if (typeof id !== "string" || !ids.has(id)) return json({ error: "Unknown theory" }, 400);
    if (!["yes", "no", null].includes(choice)) return json({ error: "choice must be yes, no or null" }, 400);
    const previous = await store.get(voter, id);
    if (choice === null) { if (previous) await store.remove(voter, id); return json(await state(), 200, setCookie); }
    const ipHash = await sha256(`${ip}|${day()}|neon-atlas-votes`);
    if (!previous && ip && (await store.ipCount(ipHash, id, day())) >= MAX_NEW_VOTES_PER_IP_PER_DAY) {
      return json({ error: "Too many votes from this connection today. Try again tomorrow." }, 429, setCookie);
    }
    if (previous !== choice) await store.put(voter, id, choice, previous ? null : ipHash, day());
    return json(await state(), 200, setCookie);
  }
  return json({ error: "Not found" }, 404);
}

// In-memory store for local development and tests.
export function memoryStore() {
  const votes = new Map(); // `${voter}|${id}` -> { voter, id, choice, ipHash, day }
  const all = () => [...votes.values()];
  return {
    async counts() { const c = {}; for (const v of all()) { c[v.id] ||= { yes: 0, no: 0 }; c[v.id][v.choice]++; } return c; },
    async mine(voter) { return Object.fromEntries(all().filter((v) => v.voter === voter).map((v) => [v.id, v.choice])); },
    async get(voter, id) { return votes.get(`${voter}|${id}`)?.choice || null; },
    async ipCount(ipHash, id, d) { return all().filter((v) => v.ipHash === ipHash && v.id === id && v.day === d).length; },
    async put(voter, id, choice, ipHash, d) { const old = votes.get(`${voter}|${id}`); votes.set(`${voter}|${id}`, { voter, id, choice, ipHash: old ? old.ipHash : ipHash, day: old ? old.day : d }); },
    async remove(voter, id) { votes.delete(`${voter}|${id}`); },
  };
}
