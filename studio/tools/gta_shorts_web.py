"""gta_shorts_web.py: the local studio page for gta_shorts.py (drop an MP4, choose the model, review, render, download).

Start it with:  python3 tools/gta_shorts.py serve   then open http://localhost:8765
Standard library only. It listens on 127.0.0.1 by default, so only this computer can reach it.
"""
from __future__ import annotations

import io
import json
import mimetypes
import re
import shutil
import threading
import time
import zipfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import gta_shorts as gs

_running: dict[str, threading.Thread] = {}


def _start(job: str, target, *args):
    if job in _running and _running[job].is_alive():
        raise gs.ShortsError("This job is already working; wait for it to finish.")
    t = threading.Thread(target=_safe, args=(target, *args), daemon=True)
    _running[job] = t
    t.start()


def _safe(fn, *args):
    try:
        fn(*args)
    except Exception:  # noqa: BLE001 - analyze/render already wrote the error into job.json
        pass


def resume_interrupted():
    """A job left mid-way by closing the app is marked so the page offers to run that step again."""
    for j in gs.list_jobs():
        if j["status"] in ("analyzing", "rendering"):
            st = gs.load_job(j["id"])
            gs.update(st, status="interrupted", step="", error="The app was closed while this job was working.")


class Handler(BaseHTTPRequestHandler):
    server_version = "GTAShorts/1"

    def log_message(self, *a):
        pass

    # --- helpers
    def _json(self, obj, code=200):
        body = json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("content-type", "application/json; charset=utf-8")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _err(self, msg, code=400):
        self._json({"error": msg}, code)

    def _body_json(self):
        n = int(self.headers.get("content-length") or 0)
        return json.loads(self.rfile.read(n) or b"{}") if n else {}

    # --- routes
    def do_GET(self):
        u = urlparse(self.path)
        parts = [p for p in u.path.split("/") if p]
        try:
            if not parts:
                body = PAGE.replace("__MODELS__", json.dumps(
                    {m: {"in": v[0], "out": v[1]} for m, v in gs.MODELS.items()})).replace(
                    "__HASKEY__", "true" if gs.load_env_key() else "false").encode()
                self.send_response(200)
                self.send_header("content-type", "text/html; charset=utf-8")
                self.send_header("content-length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
            elif parts == ["api", "jobs"]:
                self._json(gs.list_jobs())
            elif len(parts) == 3 and parts[:2] == ["api", "job"]:
                self._json(gs.load_job(parts[2]))
            elif len(parts) == 4 and parts[:2] == ["api", "job"] and parts[3] == "zip":
                self._zip(parts[2])
            elif len(parts) >= 3 and parts[0] == "files":
                self._file(parts[1], "/".join(parts[2:]))
            else:
                self._err("not found", 404)
        except gs.ShortsError as e:
            self._err(str(e), 404)

    def do_POST(self):
        u = urlparse(self.path)
        parts = [p for p in u.path.split("/") if p]
        q = {k: v[0] for k, v in parse_qs(u.query).items()}
        try:
            if parts == ["api", "upload"]:
                self._upload(q)
            elif len(parts) == 4 and parts[:2] == ["api", "job"]:
                job, action = parts[2], parts[3]
                state = gs.load_job(job)
                if action == "edit":
                    self._edit(state, self._body_json())
                elif action == "render":
                    body = self._body_json()
                    for p in state["picks"]:
                        p["selected"] = p["n"] in body.get("picks", [])
                    gs.save_job(state)
                    _start(job, gs.render, state, None, body.get("frame", "zoom"))
                    self._json({"ok": True})
                elif action == "analyze":
                    body = self._body_json()
                    _start(job, gs.analyze, state, body.get("model", gs.DEFAULT_MODEL), body.get("effort", "medium"),
                           int(body.get("count", 4)), int(body.get("candidates", 10)), bool(body.get("transcribe")))
                    self._json({"ok": True})
                elif action == "delete":
                    if job in _running and _running[job].is_alive():
                        raise gs.ShortsError("This job is still working.")
                    shutil.rmtree(gs.job_dir(job))
                    self._json({"ok": True})
                else:
                    self._err("unknown action", 404)
            else:
                self._err("not found", 404)
        except gs.ShortsError as e:
            self._err(str(e))
        except (ValueError, json.JSONDecodeError) as e:
            self._err(f"Bad request: {e}")

    # --- actions
    def _upload(self, q):
        name = Path(q.get("name") or "gameplay.mp4").name
        size = int(self.headers.get("content-length") or 0)
        if size <= 0:
            return self._err("Empty upload.")
        gs.JOBS.mkdir(parents=True, exist_ok=True)
        free = shutil.disk_usage(gs.JOBS).free
        if size * 1.3 > free:
            return self._err(f"Not enough disk space: the video is {size / 1e9:.1f} GB, {free / 1e9:.1f} GB free.")
        tmp = gs.JOBS / f".upload-{time.time_ns()}.mp4"
        left = size
        with tmp.open("wb") as f:
            while left > 0:
                chunk = self.rfile.read(min(left, 1 << 20))
                if not chunk:
                    break
                f.write(chunk)
                left -= len(chunk)
        if left:
            tmp.unlink(missing_ok=True)
            return self._err("The upload was cut off; try again.")
        state = gs.new_job(tmp, Path(name).stem, move=True)
        state["name"] = name
        gs.save_job(state)
        _start(state["id"], gs.analyze, state, q.get("model", gs.DEFAULT_MODEL), q.get("effort", "medium"),
               int(q.get("count", 4)), int(q.get("candidates", 10)), q.get("transcribe") == "1")
        self._json({"job": state["id"]})

    def _edit(self, state, body):
        dur = state["video"]["duration"]
        d = gs.job_dir(state["id"])
        by_n = {p["n"]: p for p in state["picks"]}
        for e in body.get("picks", []):
            p = by_n.get(int(e.get("n", -1)))
            if not p:
                continue
            before = (p["caption"], p["start"], p["end"], p["hook_time"])
            p["caption"] = gs.tidy_caption(e.get("caption", p["caption"]))
            p["title"] = str(e.get("title", p["title"]))[:100]
            p["description"] = gs.tidy_description(e.get("description", p["description"]))
            p["hashtags"] = gs.tidy_hashtags(re.split(r"[\s,]+", e["hashtags"]) if isinstance(e.get("hashtags"), str)
                                             else e.get("hashtags", p["hashtags"]))
            p["selected"] = bool(e.get("selected", p.get("selected", True)))
            if all(k in e for k in ("start", "end", "hook_time")):
                p["start"], p["end"], p["hook_time"] = gs.clamp_window(e["start"], e["end"], e["hook_time"], dur)
            if (p["caption"], p["start"], p["end"], p["hook_time"]) != before:
                p["storyboard"] = gs.storyboard(d, d / "source.mp4", p)
                p["edited"] = True
                (state.get("renders") or {}).pop(str(p["n"]), None)
        gs.save_job(state)
        gs.write_package(state)
        self._json(state)

    def _file(self, job, rel):
        d = gs.job_dir(job).resolve()
        path = (d / rel).resolve()
        if d not in path.parents or not path.is_file() or path.name == "source.mp4":
            return self._err("not found", 404)
        size = path.stat().st_size
        ctype = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
        rng = re.match(r"bytes=(\d*)-(\d*)", self.headers.get("range") or "")
        start, end = 0, size - 1
        if rng and (rng.group(1) or rng.group(2)):
            if rng.group(1):
                start = int(rng.group(1))
                end = int(rng.group(2)) if rng.group(2) else end
            else:
                start = max(0, size - int(rng.group(2)))
            end = min(end, size - 1)
            self.send_response(206)
            self.send_header("content-range", f"bytes {start}-{end}/{size}")
        else:
            self.send_response(200)
        self.send_header("content-type", ctype)
        self.send_header("accept-ranges", "bytes")
        self.send_header("content-length", str(end - start + 1))
        if "download" in (urlparse(self.path).query or ""):
            self.send_header("content-disposition", f'attachment; filename="{path.name}"')
        self.end_headers()
        with path.open("rb") as f:
            f.seek(start)
            left = end - start + 1
            while left > 0:
                chunk = f.read(min(left, 1 << 20))
                if not chunk:
                    break
                try:
                    self.wfile.write(chunk)
                except (BrokenPipeError, ConnectionResetError):
                    return
                left -= len(chunk)

    def _zip(self, job):
        state = gs.load_job(job)
        d = gs.job_dir(job)
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_STORED) as z:
            for r in (state.get("renders") or {}).values():
                z.write(d / r["file"], Path(r["file"]).name)
            if (d / "package.md").exists():
                z.write(d / "package.md", "package.md")
        data = buf.getvalue()
        self.send_response(200)
        self.send_header("content-type", "application/zip")
        self.send_header("content-disposition", f'attachment; filename="gta-shorts-{job}.zip"')
        self.send_header("content-length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


def serve(host="127.0.0.1", port=8765):
    gs.need_tools()
    resume_interrupted()
    srv = ThreadingHTTPServer((host, port), Handler)
    print(f"GTA Shorts studio: http://localhost:{port}  (Ctrl+C to stop)")
    if not gs.load_env_key():
        print("No ANTHROPIC_API_KEY yet: add it to studio/.env to let Claude pick (offline scorer until then).")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")


PAGE = r"""<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>GTA Shorts Studio</title>
<style>
:root{--bg:#0d1016;--panel:#151a22;--raise:#1d2430;--line:#2b3442;--fg:#ece8df;--muted:#9aa3b0;--accent:#ff4fa3;
--accent2:#ffb02e;--ok:#5fc48a;--bad:#ff6b6b;font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;color-scheme:dark}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg)}
.wrap{max-width:1100px;margin:0 auto;padding:24px 16px 80px;display:grid;gap:22px}
h1{margin:0;font-size:30px;letter-spacing:-.5px}h1 b{color:var(--accent)}h2{margin:0;font-size:20px}
.muted{color:var(--muted)}.panel{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:18px}
.drop{border:2px dashed var(--line);border-radius:12px;padding:34px 16px;text-align:center;cursor:pointer;transition:.15s}
.drop.on{border-color:var(--accent);background:#1f1420}.drop b{color:var(--accent)}
.row{display:flex;flex-wrap:wrap;gap:12px;align-items:end}label{display:grid;gap:4px;font-size:13px;color:var(--muted)}
select,input,textarea{background:var(--raise);color:var(--fg);border:1px solid var(--line);border-radius:8px;padding:8px 10px;font:inherit}
textarea{width:100%;min-height:70px;resize:vertical}input[type=number]{width:90px}
button{background:var(--accent);color:#1a0610;border:0;border-radius:8px;padding:10px 16px;font:700 14px system-ui;cursor:pointer}
button.ghost{background:var(--raise);color:var(--fg);border:1px solid var(--line)}button:disabled{opacity:.45;cursor:default}
.bar{height:6px;background:var(--raise);border-radius:4px;overflow:hidden}.bar i{display:block;height:100%;background:var(--accent);width:0}
.jobs a{color:var(--fg);text-decoration:none;display:flex;justify-content:space-between;gap:12px;padding:8px 0;border-top:1px solid var(--line)}
.pill{font:600 11px ui-monospace,monospace;padding:2px 8px;border-radius:99px;background:var(--raise);color:var(--muted)}
.pill.review{color:var(--accent2)}.pill.done{color:var(--ok)}.pill.error,.pill.interrupted{color:var(--bad)}
.pick{display:grid;grid-template-columns:minmax(0,1.2fr) minmax(0,1fr);gap:16px;border-top:1px solid var(--line);padding-top:16px}
@media(max-width:800px){.pick{grid-template-columns:1fr}}
.pick img{width:100%;border-radius:8px;display:block}.pick video{width:100%;max-height:560px;border-radius:8px;background:#000}
.fields{display:grid;gap:10px;min-width:0}.fields input[type=text]{width:100%}
.scores{font:12px ui-monospace,monospace;color:var(--muted)}.qc.ok{color:var(--ok)}.qc.bad{color:var(--bad)}
.notes li{margin:4px 0}.err{color:var(--bad);font-weight:600}.copy{padding:2px 10px;font-size:12px;justify-self:start;margin-left:6px}
.title-row{display:flex;justify-content:space-between;gap:12px;align-items:center;flex-wrap:wrap}
</style></head><body><div class="wrap">
<header><h1>GTA <b>Shorts</b> Studio</h1>
<p class="muted">Drop in your GTA 6 gameplay. Claude finds the funniest moments and writes a caption, title and description
for each. You check them, then the studio cuts them into vertical Shorts.</p></header>

<section class="panel" id="new">
  <div class="drop" id="drop"><b>Drop an MP4 here</b> or click to choose one<br><span class="muted" id="dropinfo">Your video stays on this computer; only still frames go to Claude.</span></div>
  <input type="file" id="file" accept="video/*" hidden>
  <div class="row" style="margin-top:14px">
    <label>Model<select id="model">
      <option value="claude-opus-5-5">Claude Opus 5.5 (recommended)</option>
      <option value="claude-sonnet-5-5">Claude Sonnet 5.5 (cheaper)</option>
      <option value="claude-haiku-5-5">Claude Haiku 5.5 (cheapest)</option>
      <option value="claude-fable-5-2">Claude Fable 5.2 (most capable, priciest)</option>
      <option value="offline">Offline (free, no Claude)</option></select></label>
    <label>Effort<select id="effort"><option>low</option><option selected>medium</option><option>high</option></select></label>
    <label>Shorts<select id="count"><option>3</option><option selected>4</option><option>5</option></select></label>
    <label>Moments Claude looks at<select id="cands"><option>6</option><option>8</option><option selected>10</option><option>12</option><option>16</option></select></label>
    <label><span><input type="checkbox" id="transcribe"> Transcribe my mic</span></label>
  </div>
  <p class="muted" id="estimate"></p>
  <p class="err" id="keywarn" hidden>No Claude API key found: add ANTHROPIC_API_KEY to studio/.env and restart, or use Offline.</p>
  <div class="bar" id="upbar" hidden><i></i></div>
</section>

<section class="panel" id="jobview" hidden></section>

<section class="panel"><h2>Recent jobs</h2><div class="jobs" id="jobs"></div></section>
</div>
<script>
const MODELS=__MODELS__, HASKEY=__HASKEY__;
const $=s=>document.querySelector(s); let current=null, poll=null;
const esc=s=>String(s??"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const fmt=t=>{t=Math.max(0,+t);const m=Math.floor(t/60);return m+":"+(t-m*60).toFixed(1).padStart(4,"0")};
function estimate(){const m=$("#model").value,n=+$("#cands").value;$("#keywarn").hidden=HASKEY||m==="offline";
  if(m==="offline"){$("#estimate").textContent="Offline: free. Picks the loudest, busiest moments and uses stock captions; it doesn't watch them.";return}
  const p=MODELS[m],inTok=(n+2)*1000+4000,outTok={low:2500,medium:5000,high:10000}[$("#effort").value];
  const c=inTok/1e6*p.in+outTok/1e6*p.out;
  $("#estimate").textContent=`About ${(inTok/1000).toFixed(0)}K tokens in, up to ${(outTok/1000).toFixed(0)}K out: roughly $${c<0.01?c.toFixed(4):c.toFixed(2)} per video (${p.in}/${p.out} $ per million tokens).`}
["model","effort","cands"].forEach(i=>$("#"+i).onchange=estimate);estimate();
const drop=$("#drop");drop.onclick=()=>$("#file").click();
drop.ondragover=e=>{e.preventDefault();drop.classList.add("on")};drop.ondragleave=()=>drop.classList.remove("on");
drop.ondrop=e=>{e.preventDefault();drop.classList.remove("on");if(e.dataTransfer.files[0])upload(e.dataTransfer.files[0])};
$("#file").onchange=e=>e.target.files[0]&&upload(e.target.files[0]);
function upload(f){const q=new URLSearchParams({name:f.name,model:$("#model").value,effort:$("#effort").value,
  count:$("#count").value,candidates:$("#cands").value,transcribe:$("#transcribe").checked?"1":"0"});
  const x=new XMLHttpRequest();x.open("POST","/api/upload?"+q);$("#upbar").hidden=false;
  $("#dropinfo").textContent=`Uploading ${f.name} (${(f.size/1e9).toFixed(2)} GB)...`;
  x.upload.onprogress=e=>{$("#upbar i").style.width=(100*e.loaded/e.total)+"%"};
  x.onload=()=>{$("#upbar").hidden=true;const r=JSON.parse(x.responseText);
    if(r.error){$("#dropinfo").textContent=r.error;return}$("#dropinfo").textContent="Uploaded. Analyzing...";open(r.job);loadJobs()};
  x.onerror=()=>{$("#dropinfo").textContent="Upload failed: is the studio still running?"};x.send(f)}
async function loadJobs(){const js=await (await fetch("/api/jobs")).json();
  $("#jobs").innerHTML=js.length?js.map(j=>`<a href="#${j.id}" onclick="open('${j.id}');return false"><span>${esc(j.name||j.id)}</span>
  <span><span class="pill ${j.status}">${j.status}</span> ${j.picks} picks · ${j.renders} rendered</span></a>`).join(""):'<p class="muted">None yet.</p>'}
async function open(id){current=id;location.hash=id;clearInterval(poll);await refresh();poll=setInterval(refresh,2000)}
async function refresh(){if(!current)return;const r=await fetch("/api/job/"+current);if(!r.ok){$("#jobview").hidden=true;return}
  const j=await r.json();const busy=j.status==="analyzing"||j.status==="rendering";
  if(!busy){clearInterval(poll);poll=null}
  if(document.activeElement&&$("#jobview").contains(document.activeElement)&&!busy&&$("#jobview").dataset.v===String(j.updated))return;
  $("#jobview").dataset.v=j.updated;render(j,busy);if(!busy)loadJobs()}
function render(j,busy){const v=$("#jobview");v.hidden=false;const u=j.usage;
  const files=id=>`/files/${j.id}/${id}`;
  let h=`<div class="title-row"><h2>${esc(j.name||j.id)}</h2><span class="pill ${j.status}">${j.status}</span></div>`;
  if(j.video)h+=`<p class="muted">${fmt(j.video.duration)} · ${j.video.width}x${j.video.height} · ${Math.round(j.video.fps)} fps</p>`;
  if(busy)h+=`<p><b>${esc(j.step)}</b>...</p><div class="bar"><i style="width:100%;animation:none;opacity:.6"></i></div>`;
  if(j.error)h+=`<p class="err">${esc(j.error)}</p>`;
  if(u)h+=`<p class="muted">Picked by ${esc(u.model)}: ${u.input_tokens.toLocaleString()} input + ${u.output_tokens.toLocaleString()} output tokens, about $${u.cost_usd.toFixed(3)}.</p>`;
  if(j.notes&&j.notes.length)h+=`<ul class="notes muted">${j.notes.map(n=>`<li>${esc(n)}</li>`).join("")}</ul>`;
  (j.picks||[]).forEach(p=>{const rd=(j.renders||{})[p.n];const s=p.scores||{};
    h+=`<div class="pick" data-n="${p.n}"><div>${rd?`<video src="${files(rd.file)}" controls playsinline preload="metadata"></video>`
      :`<img src="${files(p.storyboard)}?v=${j.updated}" alt="Storyboard for Short ${p.n}">`}
      ${rd?`<p class="qc ${rd.qc.pass?"ok":"bad"}">${rd.qc.pass?"Checks passed":"Check: "+esc(rd.qc.problems.join("; "))} · ${rd.qc.size} · ${(rd.qc.duration||0).toFixed(1)} s · ${rd.qc.lufs??"?"} LUFS</p>
      <p><a href="${files(rd.file)}?download"><button class="ghost">Download MP4</button></a></p>`:""}</div>
      <div class="fields"><div class="title-row"><b>Short ${p.n}</b><label style="display:inline"><input type="checkbox" class="sel" ${p.selected?"checked":""}> include</label></div>
      <p class="muted" style="margin:0">${esc(p.moment)}<br><i>${esc(p.why)}</i></p>
      <p class="scores">read ${s.instant_read} · surprise ${s.surprise} · payoff ${s.payoff} · loop ${s.loop} · standalone ${s.standalone} = ${p.total}/50 · ${p.picked_by}</p>
      <label>Caption (on screen)<input type="text" class="caption" value="${esc(p.caption)}"></label>
      <div class="row"><label>Start (s)<input type="number" step="0.1" class="start" value="${p.start}"></label>
      <label>Payoff (s)<input type="number" step="0.1" class="hook" value="${p.hook_time}"></label>
      <label>End (s)<input type="number" step="0.1" class="end" value="${p.end}"></label>
      <span class="muted">${fmt(p.start)}-${fmt(p.end)} · ${(p.end-p.start).toFixed(1)} s</span></div>
      <label>Title <button class="ghost copy" data-c="title">copy</button><input type="text" class="title" value="${esc(p.title)}"></label>
      <label>Description <button class="ghost copy" data-c="description">copy</button><textarea class="description">${esc(p.description)}</textarea></label>
      <label>Hashtags <button class="ghost copy" data-c="hashtags">copy</button><input type="text" class="hashtags" value="${esc(p.hashtags.join(" "))}"></label>
      </div></div>`});
  if((j.picks||[]).length&&!busy){const any=Object.keys(j.renders||{}).length;
    h+=`<div class="row" style="border-top:1px solid var(--line);padding-top:16px">
      <button class="ghost" id="save">Save edits</button>
      <label>Framing<select id="frame"><option value="zoom">Zoomed (fills more of the phone)</option><option value="fit">Whole picture</option></select></label>
      <button id="go">Approve and render selected</button>
      ${any?`<a href="/api/job/${j.id}/zip"><button class="ghost">Download all (ZIP)</button></a>`:""}</div>`}
  if(!busy)h+=`<div class="row" style="margin-top:14px"><button class="ghost" id="again">Analyze again with the settings above</button>
    <button class="ghost" id="del">Delete this job (frees disk)</button></div>`;
  v.innerHTML=h;
  v.querySelectorAll(".copy").forEach(b=>b.onclick=e=>{e.preventDefault();const el=b.closest(".fields").querySelector("."+b.dataset.c);
    navigator.clipboard.writeText(el.value).then(()=>{b.textContent="copied";setTimeout(()=>b.textContent="copy",1200)})});
  const edits=()=>[...v.querySelectorAll(".pick")].map(el=>({n:+el.dataset.n,selected:el.querySelector(".sel").checked,
    caption:el.querySelector(".caption").value,title:el.querySelector(".title").value,description:el.querySelector(".description").value,
    hashtags:el.querySelector(".hashtags").value,start:+el.querySelector(".start").value,end:+el.querySelector(".end").value,
    hook_time:+el.querySelector(".hook").value}));
  const post=(a,b)=>fetch(`/api/job/${j.id}/${a}`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(b)}).then(r=>r.json());
  if($("#save"))$("#save").onclick=async()=>{const r=await post("edit",{picks:edits()});if(r.error)alert(r.error);render(r,false)};
  if($("#go"))$("#go").onclick=async()=>{const e=edits();const r1=await post("edit",{picks:e});if(r1.error)return alert(r1.error);
    const r=await post("render",{picks:e.filter(x=>x.selected).map(x=>x.n),frame:$("#frame").value});if(r.error)return alert(r.error);open(j.id)};
  if($("#again"))$("#again").onclick=async()=>{const r=await post("analyze",{model:$("#model").value,effort:$("#effort").value,
    count:+$("#count").value,candidates:+$("#cands").value,transcribe:$("#transcribe").checked});if(r.error)return alert(r.error);open(j.id)};
  if($("#del"))$("#del").onclick=async()=>{if(!confirm("Delete this job and its renders?"))return;await post("delete",{});
    current=null;v.hidden=true;loadJobs()}}
loadJobs();if(location.hash.length>1)open(location.hash.slice(1));
</script></body></html>
"""
