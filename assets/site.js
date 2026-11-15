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

  // countdown (days only; the exact unlock time varies by region, see the release-time guide)
  const cd = $(".countdown");
  if (cd) {
    const launch = new Date(cd.dataset.launch + "T00:00:00");
    const days = Math.ceil((launch - new Date()) / 86400000);
    const left = $(".cd-left", cd);
    if (left) left.textContent = days > 1 ? `${days} days to go` : days === 1 ? "Tomorrow" : days === 0 ? "Today" : "Out now";
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
