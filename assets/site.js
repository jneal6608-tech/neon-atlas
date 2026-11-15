// Neon Atlas front-end: nav toggle, launch countdown, table-of-contents highlight, search, contact form,
// and privacy-respecting engagement events (sent only if Google Analytics is configured).
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const track = (name, params) => { if (typeof window.gtag === "function") window.gtag("event", name, params || {}); };

  // mobile nav
  const toggle = $(".nav-toggle"), nav = $("#site-nav");
  if (toggle && nav) {
    toggle.addEventListener("click", () => {
      const open = toggle.getAttribute("aria-expanded") !== "true";
      toggle.setAttribute("aria-expanded", String(open));
      nav.classList.toggle("open", open);
    });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && nav.classList.contains("open")) { nav.classList.remove("open"); toggle.setAttribute("aria-expanded", "false"); toggle.focus(); } });
  }

  // live countdown to midnight local time on launch day (the reported unlock time)
  const pad = (n) => String(n).padStart(2, "0");
  const cds = [...document.querySelectorAll(".countdown")];
  if (cds.length) {
    const launch = new Date(cds[0].dataset.launch + "T00:00:00");
    const tick = () => {
      const ms = Math.max(0, launch - new Date());
      const v = { d: Math.floor(ms / 864e5), h: Math.floor(ms / 36e5) % 24, m: Math.floor(ms / 6e4) % 60, s: Math.floor(ms / 1e3) % 60 };
      for (const cd of cds) {
        for (const el of cd.querySelectorAll("[data-u]")) el.textContent = el.dataset.u === "d" ? v.d : pad(v[el.dataset.u]);
        if (ms === 0) { const l = cd.querySelector(".cd-label"); if (l) l.textContent = "GTA VI is out now"; }
      }
    };
    tick(); setInterval(tick, 1000);
  }

  // reading progress bar
  const bar = document.querySelector(".progress span");
  const art = document.querySelector(".article");
  if (bar && art) {
    const upd = () => { const r = art.getBoundingClientRect(); const p = Math.min(1, Math.max(0, -r.top / (r.height - innerHeight))); bar.style.width = (p * 100).toFixed(1) + "%"; };
    addEventListener("scroll", upd, { passive: true }); upd();
  }

  // video facades: the poster is a link to YouTube. On the site we swap it for the player in place; where a page
  // is shown inside another site's frame (previews), embedding is often blocked, so the link opens YouTube instead.
  for (const img of document.querySelectorAll(".yt-play img")) {
    const next = () => { if (img.dataset.altSrc) { img.src = img.dataset.altSrc; img.dataset.altSrc = ""; } else if (img.dataset.fallback) { img.src = img.dataset.fallback; img.dataset.fallback = ""; } };
    img.addEventListener("error", next);
    // YouTube serves a 120px grey placeholder when a size doesn't exist
    img.addEventListener("load", () => { if (img.naturalWidth && img.naturalWidth < 200) next(); });
    if (img.complete && img.naturalWidth === 0 && img.src) next();
  }
  let framed = false;
  try { framed = window.self !== window.top; } catch { framed = true; }
  document.addEventListener("click", (e) => {
    const link = e.target.closest(".yt-play"); if (!link) return;
    const box = link.closest(".yt");
    if (!box.dataset.id) { track("video_play", { video_id: link.href, mode: "rockstar" }); return; } // opens Rockstar's player
    track("video_play", { video_id: box.dataset.id, mode: framed ? "youtube" : "inline" });
    if (framed) return; // let the link open YouTube in a new tab
    e.preventDefault();
    const f = document.createElement("iframe");
    f.src = `https://www.youtube-nocookie.com/embed/${box.dataset.id}?autoplay=1&rel=0&playsinline=1`;
    f.title = link.getAttribute("aria-label");
    f.allow = "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share";
    f.referrerPolicy = "strict-origin-when-cross-origin";
    f.allowFullscreen = true;
    link.replaceWith(f);
  });

  // widget: will it fit?
  for (const w of document.querySelectorAll('[data-widget="storage"]')) {
    const out = $(".widget-out", w);
    $("[data-act=check]", w).addEventListener("click", () => {
      const free = parseFloat($("#w-free", w).value);
      const con = $("#w-console", w).value;
      if (!(free >= 0)) { out.innerHTML = `<span class="warn">Enter your free space in GB first.</span>`; return; }
      const need = 212, buffer = 30;
      const sTip = con === "xss" ? " The Series S has the smallest drive of the supported consoles, so check this early." : "";
      out.innerHTML = free >= need + buffer
        ? `<strong class="ok">You're good.</strong> ${free} GB free covers the reported ${need} GB with room for a launch update.`
        : free >= need
          ? `<strong class="warn">Just enough, but tight.</strong> ${free} GB covers the reported ${need} GB, but a launch update could need more. Free up about ${Math.ceil(need + buffer - free)} GB to be safe.${sTip}`
          : `<strong class="bad">Not enough yet.</strong> You need about ${Math.ceil(need - free)} GB more for the reported ${need} GB, plus room for updates.${sTip} See "How much free space do you need?" below.`;
      track("tool_use", { tool: "storage", result: free >= need ? "fits" : "short" });
    });
  }

  // widget: unlock time by time zone
  for (const w of document.querySelectorAll('[data-widget="unlock"]')) {
    const sel = $("#w-tz", w), out = $(".widget-out", w);
    const here = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const zones = [[here, `My time zone (${here})`], ["America/New_York", "US Eastern"], ["America/Chicago", "US Central"], ["America/Denver", "US Mountain"], ["America/Los_Angeles", "US Pacific"], ["America/Anchorage", "Alaska"], ["Pacific/Honolulu", "Hawaii"], ["America/Toronto", "Toronto"], ["America/Mexico_City", "Mexico City"], ["America/Sao_Paulo", "São Paulo"], ["Europe/London", "UK"], ["Europe/Paris", "Central Europe"], ["Asia/Dubai", "Dubai"], ["Asia/Kolkata", "India"], ["Asia/Tokyo", "Japan"], ["Australia/Sydney", "Sydney"], ["Pacific/Auckland", "New Zealand"]];
    sel.innerHTML = zones.map(([z, l]) => `<option value="${z}">${l}</option>`).join("");
    const fmt = (d, tz) => d.toLocaleString("en-US", { timeZone: tz, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
    const show = () => {
      const tz = sel.value;
      const us = tz.startsWith("America/") && !/Sao_Paulo|Mexico_City|Toronto/.test(tz);
      const eastern = new Date(w.dataset.launch + "T05:00:00Z"); // midnight Eastern (EST, UTC-5)
      out.innerHTML = `<strong>Midnight local time (reported):</strong> Thu, Nov 19, 12:00 AM in your zone.` +
        (us ? `<br><strong>If your US store uses Eastern time (reported for some storefronts):</strong> ${fmt(eastern, tz)} your time.` : "") +
        `<br><span class="muted small">Check the countdown on your console store’s GTA VI page for your exact time.</span>`;
    };
    sel.addEventListener("change", () => { show(); track("tool_use", { tool: "unlock", tz: sel.value }); }); show();
  }

  // shared multiple-choice runner for the edition picker and the character quiz
  function runQuiz(w, questions, finish) {
    const box = $(".quiz-box", w), out = $(".widget-out", w);
    let i = 0; const answers = [];
    const render = () => {
      const q = questions[i];
      box.innerHTML = `<p class="quiz-progress">Question ${i + 1} of ${questions.length}</p><p style="color:var(--text);font-weight:700;font-size:1.05rem">${q.q}</p><div class="choices">${q.a.map((a, k) => `<button type="button" class="choice" data-k="${k}">${a[0]}</button>`).join("")}</div>`;
      box.querySelectorAll(".choice").forEach((b) => b.addEventListener("click", () => {
        answers.push(q.a[+b.dataset.k][1]); i++;
        if (i < questions.length) render(); else { box.innerHTML = ""; finish(answers, out, () => { i = 0; answers.length = 0; out.innerHTML = ""; render(); }); }
      }));
    };
    render();
  }

  for (const w of document.querySelectorAll('[data-widget="edition"]')) {
    runQuiz(w, [
      { q: "Do you want a boxed copy (code in box) to give or display?", a: [["Yes, I want a box", { box: 1 }], ["No, digital is fine", {}]] },
      { q: "Do bonus cars, revolvers, mod shops and outfits matter to you?", a: [["Yes, I love extras", { extra: 1 }], ["Not really, just the game", {}]] },
      { q: "Is the price difference (reported about $20 in the US) a big deal?", a: [["Yes, I'd rather save", { save: 1 }], ["No, I don't mind", {}]] },
    ], (ans, out, again) => {
      const t = Object.assign({}, ...ans);
      const ultimate = t.extra && !t.box && !t.save;
      out.innerHTML = `<strong>Our pick for you: ${ultimate ? "Ultimate Edition" : "Standard Edition"}</strong><br>${t.box ? "Only the Standard Edition comes as a code in a box. " : ""}${ultimate ? "You want the extras and you're buying digitally anyway." : "You get the full game, and you can upgrade to Ultimate later on PlayStation Store or Microsoft Store."} <span class="muted">This is our suggestion, not Rockstar's.</span><br><button type="button" class="btn-ghost btn" style="margin-top:10px">Start again</button>`;
      out.querySelector("button").addEventListener("click", again);
      track("tool_use", { tool: "edition", result: ultimate ? "ultimate" : "standard" });
    });
  }

  const CHAR = {
    jason: ["Jason Duval", "jason-duval", "You want an easy life, but things keep getting harder. Loyal, practical, and always right behind your partner."],
    lucia: ["Lucia Caminos", "lucia-caminos", "A fighter with a plan. You learned your lesson: only smart moves from here, no matter what it takes."],
    cal: ["Cal Hampton", "cal-hampton", "Happiest at home with the radio scanner on. Casually paranoid, and a little bit right about everything."],
    boobie: ["Boobie Ike", "boobie-ike", "All smiles until it's time to talk business. You turn hustle into an empire."],
    dre: ["Dre'Quan Priest", "dre-quan-priest", "More hustler than gangster. The goal was always the music, and you're chasing the next hit."],
    dimez: ["Real Dimez", "real-dimez", "Viral hooks and a relentless social feed. One more hit away from fame."],
    raul: ["Raul Bautista", "raul-bautista", "Confidence, charm and cunning. A professional who adapts, though the stakes keep rising."],
    brian: ["Brian Heder", "brian-heder", "A laid-back beach bum on the outside, a great white shark underneath. You let others do the dirty work."],
  };
  for (const w of document.querySelectorAll('[data-widget="quiz"]')) {
    let imgs = {}; try { imgs = JSON.parse(w.dataset.imgs || "{}"); } catch {}
    runQuiz(w, [
      { q: "Pick your perfect Leonida evening.", a: [["Sunset on a boat in the Keys", ["brian", "jason"]], ["Front row at a packed club", ["boobie", "dimez"]], ["At home with a scanner and snacks", ["cal"]], ["Planning the next big score", ["raul", "lucia"]]] },
      { q: "Your friends would call you…", a: [["Loyal", ["jason"]], ["Determined", ["lucia"]], ["Ambitious", ["dre", "boobie"]], ["A bit paranoid", ["cal"]]] },
      { q: "How do you handle a plan going wrong?", a: [["Improvise. A professional adapts.", ["raul"]], ["Stay calm, I've seen worse", ["brian"]], ["Fight my way out", ["lucia"]], ["Post about it", ["dimez"]]] },
      { q: "Dream job?", a: [["Running a record label", ["dre"]], ["Owning half the city", ["boobie"]], ["Anything quiet and easy", ["jason", "cal"]], ["Going viral", ["dimez"]]] },
      { q: "Pick a ride.", a: [["A boat", ["brian"]], ["A getaway car", ["raul"]], ["Whatever's parked outside", ["jason", "lucia"]], ["Something flashy", ["boobie", "dimez"]]] },
      { q: "Pick a motto.", a: [["Only smart moves from here.", ["lucia"]], ["Experience counts.", ["raul"]], ["It's all about heart.", ["boobie"]], ["What if everything on the internet was true?", ["cal"]]] },
    ], (ans, out, again) => {
      const score = {}; for (const a of ans) for (const c of a) score[c] = (score[c] || 0) + 1;
      const top = Object.entries(score).sort((x, y) => y[1] - x[1])[0][0];
      const [name, slug, blurb] = CHAR[top];
      out.innerHTML = `<div class="quiz-result"><img src="${imgs[slug] || ""}" alt="${name}" width="600" height="750"><div><p class="quiz-progress">You got</p><p style="font:400 2rem/1 var(--display);text-transform:uppercase;margin:0 0 8px" class="grad">${name}</p><p style="color:var(--text)">${blurb}</p><p class="muted small">Based on Rockstar's official character profile. Just for fun.</p><button type="button" class="btn">Take it again</button></div></div>`;
      out.querySelector("button").addEventListener("click", again);
      track("quiz_complete", { result: top });
    });
  }

  // table of contents: highlight the section in view
  const tocLinks = [...document.querySelectorAll(".toc a")];
  if (tocLinks.length && "IntersectionObserver" in window) {
    const map = new Map(tocLinks.map((a) => [a.getAttribute("href").slice(1), a]));
    const io = new IntersectionObserver((entries) => {
      for (const en of entries) if (en.isIntersecting) { tocLinks.forEach((l) => l.classList.remove("active")); map.get(en.target.id)?.classList.add("active"); }
    }, { rootMargin: "-80px 0px -70% 0px" });
    map.forEach((_, id) => { const h = document.getElementById(id); if (h) io.observe(h); });
  }

  // engagement: scroll depth on articles, source clicks
  const article = $(".article");
  if (article) {
    let sent = false;
    const onScroll = () => {
      if (sent) return;
      const r = article.getBoundingClientRect();
      if (r.bottom - window.innerHeight < r.height * 0.25) { sent = true; track("article_read", { slug: article.dataset.slug, category: article.dataset.category }); window.removeEventListener("scroll", onScroll); }
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    document.addEventListener("click", (e) => { const a = e.target.closest(".sources a.ext"); if (a) track("source_click", { url: a.href }); });
  }

  // search
  const results = $("#search-results");
  if (results) {
    const input = $("#sq"), status = $("#search-status");
    const base = document.querySelector('link[rel="stylesheet"][href$="styles.css"]').getAttribute("href").replace(/assets\/styles\.css$/, "");
    const escH = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
    const norm = (s) => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/gta ?(6|vi)\b/g, "gta6");
    let index = null;
    const load = () => index || (index = fetch(base + "search-index.json").then((r) => r.json()));
    // production pages use root-relative links ("/"); preview builds use relative ones with explicit index.html
    const linkFor = (u) => (base.startsWith("/") ? u : base + u.replace(/^\//, "") + (u.endsWith("/") ? "index.html" : ""));
    const run = async (q) => {
      const terms = norm(q).split(/\s+/).filter((t) => t.length > 1 && t !== "gta6");
      if (!q.trim()) { status.textContent = "Type a question or a name."; results.innerHTML = ""; return; }
      const data = await load();
      const scored = data.map((d) => {
        const T = norm(d.t), D = norm(d.d), H = norm(d.h), B = norm(d.b), Q = norm(d.q);
        let s = 0;
        for (const t of terms) { s += (T.includes(t) ? 8 : 0) + (Q.includes(t) ? 5 : 0) + (H.includes(t) ? 4 : 0) + (D.includes(t) ? 3 : 0) + (B.includes(t) ? 1 : 0); if (!(T + D + H + B + Q).includes(t)) s -= 6; }
        return { d, s };
      }).filter((x) => x.s > 0).sort((a, b) => b.s - a.s);
      const seen = new Set(); const top = [];
      for (const x of scored) { const key = x.d.t + x.d.u; if (!seen.has(key)) { seen.add(key); top.push(x); } if (top.length >= 20) break; }
      const hl = (s) => { let h = escH(s); for (const t of terms) h = h.replace(new RegExp(`(${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi"), "<mark>$1</mark>"); return h; };
      results.innerHTML = top.map(({ d }) => `<li><p class="muted small">${escH(d.c)}</p><h2><a href="${escH(linkFor(d.u))}">${hl(d.t)}</a></h2><p>${hl(d.d)}</p></li>`).join("");
      status.textContent = top.length ? `${top.length} result${top.length > 1 ? "s" : ""} for “${q}”` : `No results for “${q}”. We only publish what we can verify, so it may not be covered yet. Ask us on the contact page.`;
      track("search", { search_term: q, results: top.length });
    };
    const q = new URLSearchParams(location.search).get("q") || "";
    input.value = q; run(q);
    $(".search-page-form").addEventListener("submit", (e) => { e.preventDefault(); const v = input.value; history.replaceState(null, "", "?q=" + encodeURIComponent(v)); run(v); });
  }

  // contact form: posts to a configured form endpoint, otherwise opens the visitor's mail app
  const form = $("#contact-form");
  if (form) {
    const st = $(".form-status", form);
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      st.className = "form-status";
      const fd = new FormData(form);
      if (fd.get("website")) return; // honeypot
      const msg = String(fd.get("message") || "").trim();
      const email = String(fd.get("email") || "").trim();
      if (msg.length < 10) { st.textContent = "Please write a message of at least 10 characters."; st.classList.add("err"); $("#cf-msg").focus(); return; }
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { st.textContent = "That email address doesn't look right."; st.classList.add("err"); $("#cf-email").focus(); return; }
      const endpoint = form.dataset.endpoint;
      if (endpoint) {
        try {
          const r = await fetch(endpoint, { method: "POST", body: fd, headers: { Accept: "application/json" } });
          if (!r.ok) throw new Error(String(r.status));
          form.reset(); st.textContent = "Thanks, your message was sent."; st.classList.add("ok"); track("contact_submit", { topic: fd.get("topic") });
        } catch { st.textContent = "Sorry, sending failed. Please try again in a moment."; st.classList.add("err"); }
      } else {
        const body = `Topic: ${fd.get("topic")}\nPage: ${fd.get("page") || "-"}\nName: ${fd.get("name") || "-"}\nReply-to: ${email || "-"}\n\n${msg}`;
        location.href = `mailto:${form.dataset.email}?subject=${encodeURIComponent("[Neon Atlas] " + fd.get("topic"))}&body=${encodeURIComponent(body)}`;
        st.textContent = "Your email app should open with the message ready to send."; st.classList.add("ok");
      }
    });
  }
})();
