/* ==========================================================
   Discord Mini — Call
   - Waveform memakai mikrofon sungguhan (Web Audio API).
   - Anggota dari tab lain di browser yang sama muncul lewat CallStore.
   - Anggota "Calling" adalah simulasi (dummy). Untuk panggilan
     antar-perangkat sungguhan, sambungkan ke WebRTC + server signaling.
   ========================================================== */
(() => {
  "use strict";

  const $ = (s) => document.querySelector(s);
  const KEY_SESSION = "discordmini:session";
  const CID = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now()) + Math.random();
  const BARS = 41;   // jumlah bar waveform (ganjil agar simetris)
  const BINS = 21;   // bin frekuensi yang dipakai

  /* ---------- Siapa & room mana ---------- */
  const params = new URLSearchParams(location.search);
  const room = getRoom(params.get("id"));
  let name = "";
  try {
    const s = JSON.parse(sessionStorage.getItem(KEY_SESSION) || "null");
    if (s && room && s.room === room.id) name = s.username || "";
  } catch (_) { /* storage diblokir */ }
  if (!name) name = params.get("u") || "";
  if (!room || validateUsername(name)) { location.replace("index.html"); return; }
  try { sessionStorage.setItem(KEY_SESSION, JSON.stringify({ room: room.id, username: name })); } catch (_) {}
  history.replaceState(null, "", location.pathname + "?id=" + encodeURIComponent(room.id));
  document.title = "Call · " + room.name + " — Discord Mini";
  const BACK = "room.html?id=" + encodeURIComponent(room.id) + "&u=" + encodeURIComponent(name);

  /* ---------- Helpers ---------- */
  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function avatar(nm) {
    const a = el("span", "avatar", initialsOf(nm));
    const [a1, a2] = avatarPair(nm);
    a.style.setProperty("--a1", a1); a.style.setProperty("--a2", a2);
    a.setAttribute("aria-hidden", "true");
    return a;
  }
  const toastEl = $("#toast");
  let toastTimer;
  function toast(text) {
    toastEl.textContent = text;
    toastEl.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove("show"), 2800);
  }
  const ICON_MIC_OFF = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3z"/><path d="M19 11a7 7 0 0 1-14 0M12 18v3"/><path d="M4 4l16 16"/></svg>';
  const ICON_DOTS = '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.800"/><circle cx="12" cy="12" r="1.800"/><circle cx="19" cy="12" r="1.800"/></svg>';

  /* ---------- Header ---------- */
  fillThumb($("#rThumb"), room);
  $("#rName").textContent = room.name;
  $("#meName").textContent = "@" + name;
  $("#rMembers").textContent = formatNumber(room.n + 1);
  $("#totalOnline").textContent = formatNumber(ROOMS.reduce((s, r) => s + r.n, 0) + 1);

  const bigAv = $("#bigAv");
  bigAv.textContent = initialsOf(name);
  { const [a1, a2] = avatarPair(name); bigAv.style.setProperty("--a1", a1); bigAv.style.setProperty("--a2", a2); }
  $("#bigName").textContent = name;

  /* ---------- Status call & timer ---------- */
  const existing = CallStore.get(room.id);
  let startedAt = existing ? existing.startedAt : Date.now();
  function tickTimer() { $("#timerText").textContent = formatDuration(Date.now() - startedAt); }
  tickTimer();
  setInterval(tickTimer, 500);

  /* ---------- State ---------- */
  let muted = false;
  let speaking = false;
  let micOk = false;
  const peers = new Map(); // cid -> { name, muted, speaking }  (tab lain)
  const bots = SAMPLE_USERS.map((n, i) => ({
    name: n, state: "ringing", muted: false, talking: false, until: 0, timer: 0,
    willAnswer: i % 3 !== 2, // dua anggota sengaja tidak menjawab agar menu bisa dicoba
  }));
  const botByName = (n) => bots.find((b) => b.name === n);

  /* ---------- Render: In Call ---------- */
  const inList = $("#inList");
  const inRefs = new Map(); // key -> { row, eq: [] }

  function eqNode() {
    const e = el("span", "eq");
    e.setAttribute("aria-hidden", "true");
    for (let i = 0; i < 4; i++) e.append(document.createElement("i"));
    return e;
  }
  function micOffNode() {
    const s = el("span", "mic-off");
    s.setAttribute("role", "img");
    s.setAttribute("aria-label", "Mikrofon dimatikan");
    s.innerHTML = ICON_MIC_OFF; // ikon statis
    return s;
  }
  function inRow(key, nm, o) {
    const row = el("li", "urow" + (o.talking && !o.muted ? " talking" : ""));
    const info = el("div", "uinfo");
    info.append(el("b", null, nm + (o.self ? " (kamu)" : "")), el("small", null, o.muted ? "Mikrofon mati" : "Di dalam panggilan"));
    let eq = [];
    let ind;
    if (o.muted) ind = micOffNode();
    else { ind = eqNode(); eq = [...ind.children]; }
    row.append(avatar(nm), info, ind);
    inRefs.set(key, { row, eq, muted: !!o.muted });
    return row;
  }

  function renderIn() {
    inRefs.clear();
    const rows = [inRow("me", name, { muted, talking: speaking, self: true })];
    for (const [cid, p] of peers) rows.push(inRow("p:" + cid, p.name, { muted: p.muted, talking: p.speaking }));
    for (const b of bots) if (b.state === "incall") rows.push(inRow("b:" + b.name, b.name, { muted: b.muted, talking: b.talking }));
    inList.replaceChildren(...rows);
    $("#inCount").textContent = rows.length;
    $("#inCount2").textContent = rows.length;
  }
  function setTalking(key, on) {
    const r = inRefs.get(key);
    if (r) r.row.classList.toggle("talking", on && !r.muted);
  }

  /* ---------- Render: Calling ---------- */
  const callList = $("#callList");
  const STATUS = {
    ringing: null,
    cancelCall: "Panggilan dibatalkan",
    cancelInvite: "Undangan dibatalkan",
    missed: "Tidak menjawab",
  };

  function callRow(b) {
    const row = el("li", "urow");
    const info = el("div", "uinfo");
    const sub = el("small");
    if (b.state === "ringing") {
      const r = el("span", "ringing", "Memanggil");
      for (let i = 0; i < 3; i++) r.append(el("span", null, "."));
      sub.append(r);
    } else {
      sub.textContent = STATUS[b.state];
      sub.className = "bad";
    }
    info.append(el("b", null, b.name), sub);

    const btn = el("button", "dots");
    btn.type = "button";
    btn.dataset.bot = b.name;
    btn.setAttribute("aria-haspopup", "menu");
    btn.setAttribute("aria-expanded", String(menuBot === b.name));
    btn.setAttribute("aria-label", "Menu untuk @" + b.name);
    btn.innerHTML = ICON_DOTS; // ikon statis
    row.append(avatar(b.name), info, btn);
    return row;
  }

  function renderCalling() {
    const waiting = bots.filter((b) => b.state !== "incall");
    if (waiting.length) callList.replaceChildren(...waiting.map(callRow));
    else callList.replaceChildren(el("li", "empty-row", "Semua anggota sudah bergabung ke panggilan."));
    const ringing = bots.filter((b) => b.state === "ringing").length;
    $("#callingCount").textContent = ringing;
    $("#callingCount2").textContent = ringing;
    refreshMenu();
  }

  function renderAll() { renderIn(); renderCalling(); }

  /* ---------- Simulasi anggota (bots) ---------- */
  function ring(b) {
    clearTimeout(b.timer);
    b.state = "ringing";
    if (b.willAnswer) {
      b.timer = setTimeout(() => answer(b), 2000 + Math.random() * 7000);
    } else {
      b.timer = setTimeout(() => { if (b.state === "ringing") { b.state = "missed"; renderCalling(); } }, 25000);
    }
  }
  function answer(b) {
    if (b.state !== "ringing") return;
    b.state = "incall";
    b.muted = Math.random() < 0.25;
    renderAll();
    toast("@" + b.name + " bergabung ke panggilan");
  }
  setInterval(() => {
    const now = Date.now();
    for (const b of bots) {
      if (b.state !== "incall") continue;
      if (b.muted) { b.talking = false; continue; }
      if (!b.talking && Math.random() < 0.28) { b.talking = true; b.until = now + 1200 + Math.random() * 2600; setTalking("b:" + b.name, true); }
      else if (b.talking && now > b.until) { b.talking = false; setTalking("b:" + b.name, false); }
    }
  }, 500);

  /* ---------- Menu tiga titik ---------- */
  const menu = $("#menu");
  const menuItems = [...menu.querySelectorAll("[data-act]")];
  let menuBot = null;
  let menuBtn = null;

  const RULES = {
    cancelCall:   (b) => b.state === "ringing",
    cancelInvite: (b) => b.state === "ringing" || b.state === "missed",
    invite:       (b) => b.state !== "ringing" && b.state !== "incall",
  };

  function placeMenu() {
    if (!menuBtn) return;
    const r = menuBtn.getBoundingClientRect();
    menu.hidden = false;
    const mw = menu.offsetWidth, mh = menu.offsetHeight;
    const left = Math.min(Math.max(8, r.right - mw), innerWidth - mw - 8);
    let top = r.bottom + 6;
    if (top + mh > innerHeight - 8) top = Math.max(8, r.top - mh - 6);
    menu.style.left = left + "px";
    menu.style.top = top + "px";
  }
  function refreshMenu() {
    if (!menuBot) return;
    const b = botByName(menuBot);
    const btn = b && callList.querySelector('[data-bot="' + CSS.escape(menuBot) + '"]');
    if (!b || !btn) { closeMenu(); return; }
    menuBtn = btn;
    btn.setAttribute("aria-expanded", "true");
    for (const it of menuItems) it.disabled = !RULES[it.dataset.act](b);
    placeMenu();
  }
  function openMenu(b, btn) {
    menuBot = b.name; menuBtn = btn;
    btn.setAttribute("aria-expanded", "true");
    for (const it of menuItems) it.disabled = !RULES[it.dataset.act](b);
    placeMenu();
    void menu.offsetWidth;
    menu.classList.add("open");
    (menuItems.find((i) => !i.disabled) || menuItems[0]).focus();
  }
  function closeMenu(focusBack) {
    if (!menuBot) return;
    const btn = menuBtn;
    menuBot = null; menuBtn = null;
    menu.classList.remove("open");
    menu.hidden = true;
    if (btn) { btn.setAttribute("aria-expanded", "false"); if (focusBack && document.contains(btn)) btn.focus(); }
  }

  callList.addEventListener("click", (e) => {
    const btn = e.target.closest(".dots");
    if (!btn) return;
    const b = botByName(btn.dataset.bot);
    if (!b) return;
    if (menuBot === b.name) closeMenu(true); else { closeMenu(); openMenu(b, btn); }
  });
  menu.addEventListener("click", (e) => {
    const it = e.target.closest("[data-act]");
    if (!it || it.disabled) return;
    const b = botByName(menuBot);
    closeMenu(true);
    if (!b) return;
    clearTimeout(b.timer);
    if (it.dataset.act === "cancelCall") { b.state = "cancelCall"; toast("Panggilan ke @" + b.name + " dibatalkan"); }
    else if (it.dataset.act === "cancelInvite") { b.state = "cancelInvite"; toast("Undangan untuk @" + b.name + " dibatalkan"); }
    else { b.willAnswer = Math.random() < 0.85; ring(b); toast("Memanggil @" + b.name); }
    renderCalling();
  });
  menu.addEventListener("keydown", (e) => {
    const en = menuItems.filter((i) => !i.disabled);
    const idx = en.indexOf(document.activeElement);
    if (e.key === "ArrowDown") { e.preventDefault(); en[(idx + 1) % en.length].focus(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); en[(idx - 1 + en.length) % en.length].focus(); }
    else if (e.key === "Home") { e.preventDefault(); en[0].focus(); }
    else if (e.key === "End") { e.preventDefault(); en[en.length - 1].focus(); }
    else if (e.key === "Escape") { e.preventDefault(); closeMenu(true); }
    else if (e.key === "Tab") { closeMenu(); }
  });
  document.addEventListener("pointerdown", (e) => {
    if (menuBot && !menu.contains(e.target) && !e.target.closest(".dots")) closeMenu();
  });
  callList.addEventListener("scroll", () => closeMenu(), { passive: true });
  window.addEventListener("resize", () => closeMenu());

  /* ---------- Mikrofon & waveform ---------- */
  const wave = $("#wave");
  const bars = [];
  for (let i = 0; i < BARS; i++) { const b = document.createElement("i"); wave.append(b); bars.push(b); }

  let stream = null, ctx = null, analyser = null, data = null;

  async function startMic() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      toast("Browser ini tidak mendukung akses mikrofon.");
      return false;
    }
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch (err) {
      toast(err && err.name === "NotAllowedError"
        ? "Izin mikrofon ditolak. Izinkan mikrofon di browser lalu tekan Unmute."
        : "Mikrofon tidak ditemukan.");
      return false;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    ctx = new AC();
    const src = ctx.createMediaStreamSource(stream);
    analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.72;
    src.connect(analyser); // tidak disambung ke speaker agar tidak echo
    data = new Uint8Array(analyser.frequencyBinCount);
    if (ctx.state === "suspended") ctx.resume().catch(() => {});
    micOk = true;
    return true;
  }
  const wake = () => { if (ctx && ctx.state === "suspended") ctx.resume().catch(() => {}); };
  document.addEventListener("pointerdown", wake);
  document.addEventListener("keydown", wake);

  const muteBtn = $("#muteBtn");
  const meStatus = $("#meStatus");

  function paintSelf() {
    muteBtn.classList.toggle("is-muted", muted);
    muteBtn.querySelector(".i-on").hidden = muted;
    muteBtn.querySelector(".i-off").hidden = !muted;
    $("#muteLabel").textContent = muted ? "Unmute" : "Mute";
    muteBtn.setAttribute("aria-label", muted ? "Nyalakan mikrofon" : "Matikan mikrofon");

    bigAv.classList.toggle("muted", muted);
    bigAv.classList.toggle("speaking", speaking && !muted);
    meStatus.className = "me-status" + (muted ? " off" : speaking ? " speaking" : "");
    meStatus.textContent = muted ? (micOk ? "Mikrofon dimatikan" : "Mikrofon tidak aktif")
                                 : speaking ? "Sedang berbicara" : "Mikrofon aktif";
  }

  let bc = "BroadcastChannel" in window ? new BroadcastChannel("discordmini:callfx:" + room.id) : null;
  function announce() { try { if (bc) bc.postMessage({ cid: CID, name, speaking: speaking && !muted, muted }); } catch (_) {} }

  function setMuted(m) {
    muted = m;
    if (stream) stream.getAudioTracks().forEach((t) => { t.enabled = !m; });
    if (m) speaking = false;
    paintSelf();
    renderIn();
    heartbeat();
    announce();
  }

  muteBtn.addEventListener("click", async () => {
    if (!muted) { setMuted(true); return; }
    if (!micOk && !(await startMic())) { setMuted(true); return; }
    setMuted(false);
  });

  // Loop animasi (waveform & indikator suara sendiri)
  let lastLoud = 0;
  function frame(now) {
    requestAnimationFrame(frame);
    const live = micOk && !muted && analyser && ctx.state === "running";
    let sum = 0;
    if (live) {
      analyser.getByteFrequencyData(data);
      for (let k = 1; k <= BINS; k++) sum += data[k];
    }
    const avg = live ? sum / BINS / 255 : 0;

    for (let i = 0; i < BARS; i++) {
      const k = Math.abs(i - (BARS - 1) / 2) + 1; // 1..21 dari tengah
      const v = live ? data[Math.min(data.length - 1, Math.round(k))] / 255 : 0;
      bars[i].style.transform = "scaleY(" + Math.max(0.05, Math.pow(v, 1.25)).toFixed(3) + ")";
    }

    // indikator suara kecil di baris "kamu"
    const me = inRefs.get("me");
    if (me && me.eq.length) {
      const g = [[1, 3], [4, 8], [9, 14], [15, 21]];
      g.forEach(([a, b], i) => {
        let s = 0; for (let k = a; k <= b; k++) s += live ? data[k] : 0;
        me.eq[i].style.transform = "scaleY(" + Math.max(0.22, Math.min(1, (s / (b - a + 1) / 255) * 1.5)).toFixed(3) + ")";
      });
    }

    // deteksi berbicara (dengan jeda agar tidak berkedip)
    let next = speaking;
    if (!live) next = false;
    else if (!speaking && avg > 0.16) { next = true; lastLoud = now; }
    else if (speaking) { if (avg > 0.1) lastLoud = now; else if (now - lastLoud > 350) next = false; }
    if (next !== speaking) {
      speaking = next;
      paintSelf();
      setTalking("me", speaking);
      announce();
    }
  }

  /* ---------- Peserta lain (tab lain, browser yang sama) ---------- */
  let sig = null;
  function readPeers() {
    const s = CallStore.get(room.id);
    if (s) startedAt = s.startedAt;
    const next = new Map();
    if (s) for (const [cid, m] of Object.entries(s.members)) {
      if (cid === CID) continue;
      const old = peers.get(cid);
      next.set(cid, { name: m.name, muted: !!m.muted, speaking: old ? old.speaking : false });
    }
    const nsig = [...next].map(([c, p]) => c + p.name + p.muted).join("|");
    if (sig !== null) {
      for (const [c, p] of next) if (!peers.has(c)) toast("@" + p.name + " bergabung ke panggilan");
      for (const [c, p] of peers) if (!next.has(c)) toast("@" + p.name + " meninggalkan panggilan");
    }
    peers.clear(); next.forEach((v, k) => peers.set(k, v));
    if (nsig !== sig) { sig = nsig; renderIn(); }
  }
  function heartbeat() { CallStore.beat(room.id, CID, { name, muted }, startedAt); }

  if (bc) {
    bc.onmessage = (e) => {
      const d = e.data;
      if (!d || d.cid === CID) return;
      const p = peers.get(d.cid);
      if (!p) return;
      p.speaking = !!d.speaking;
      if (p.muted !== !!d.muted) { p.muted = !!d.muted; renderIn(); } else setTalking("p:" + d.cid, p.speaking && !p.muted);
    };
  }

  /* ---------- Akhiri panggilan ---------- */
  let ended = false;
  function cleanup() {
    if (ended) return;
    ended = true;
    bots.forEach((b) => clearTimeout(b.timer));
    if (stream) stream.getTracks().forEach((t) => t.stop());
    if (ctx) ctx.close().catch(() => {});
    CallStore.leave(room.id, CID);
  }
  $("#endBtn").addEventListener("click", () => { cleanup(); location.href = BACK; });
  window.addEventListener("pagehide", cleanup);
  window.addEventListener("pageshow", (e) => { if (e.persisted) location.reload(); });
  window.addEventListener("storage", (e) => { if (e.key === CallStore.key(room.id)) readPeers(); });

  /* ---------- Mulai ---------- */
  heartbeat();            // mendaftarkan diri (membuat call jika belum ada)
  readPeers();
  renderAll();
  paintSelf();
  bots.forEach(ring);
  renderCalling();
  setInterval(heartbeat, 3000);
  setInterval(readPeers, 1000);
  requestAnimationFrame(frame);

  (async () => {
    const ok = await startMic();
    if (ok) { setMuted(false); }
    else { setMuted(true); }
    // Jika audio belum "berjalan" (kebijakan autoplay), beri petunjuk
    setTimeout(() => { if (ok && ctx && ctx.state !== "running") toast("Ketuk layar sekali untuk mengaktifkan visualisasi suara."); }, 900);
  })();
})();