/* ==========================================================
   Discord Mini — Room Chat
   Pesan antar-tab (browser yang sama) disinkronkan lewat
   BroadcastChannel sebagai simulasi. Ganti bagian `post()` dan
   `bc.onmessage` dengan WebSocket / backend saat sudah siap.
   ========================================================== */
(() => {
  "use strict";

  const $ = (s) => document.querySelector(s);
  const KEY_SESSION = "discordmini:session";
  const MAX_BYTES = 25 * 1024 * 1024; // 25 MB
  const CID = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now()) + Math.random();

  /* ---------- Siapa & room mana ---------- */
  const params = new URLSearchParams(location.search);
  const room = getRoom(params.get("id"));

  let name = "";
  try {
    const s = JSON.parse(sessionStorage.getItem(KEY_SESSION) || "null");
    if (s && room && s.room === room.id) name = s.username || "";
  } catch (_) { /* storage diblokir */ }
  if (!name) name = params.get("u") || "";

  // Tanpa room / username yang valid → kembali ke daftar room
  if (!room || validateUsername(name)) {
    location.replace("index.html");
    return;
  }
  try { sessionStorage.setItem(KEY_SESSION, JSON.stringify({ room: room.id, username: name })); } catch (_) {}
  history.replaceState(null, "", location.pathname + "?id=" + encodeURIComponent(room.id));
  document.title = room.name + " — Discord Mini";

  /* ---------- Elemen ---------- */
  const chat = $("#chat");
  const stream = $("#stream");
  const composer = $("#composer");
  const msg = $("#msg");
  const sendBtn = $("#send");
  const fileInput = $("#file");
  const pendingBox = $("#pending");
  const toastEl = $("#toast");

  /* ---------- Helpers ---------- */
  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  const PAIRS = [
    ["#cfe6ff", "#e3d4ff"], ["#ffd3e6", "#ffe6c9"], ["#c9f3e4", "#cfe6ff"],
    ["#e3d4ff", "#ffd3e6"], ["#ffe6c9", "#c9f3e4"], ["#d8c8ff", "#cfe6ff"],
  ];
  function hash(s) { let h = 0; for (const c of s) h = (h * 31 + c.codePointAt(0)) >>> 0; return h; }
  function initials(n) {
    const parts = n.split(/[._-]+/).filter(Boolean);
    const first = (s) => [...s][0] || "";
    const out = parts.length >= 2 ? first(parts[0]) + first(parts[1]) : [...n].slice(0, 2).join("");
    return out.toUpperCase();
  }
  function fmtTime(ts) {
    return new Date(ts).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false });
  }
  function fmtSize(b) {
    if (b < 1024) return b + " B";
    if (b < 1024 * 1024) return Math.round(b / 1024) + " KB";
    return (b / 1024 / 1024).toFixed(1) + " MB";
  }
  function kindOf(f) {
    const t = (f.type || "").toLowerCase();
    const n = (f.name || "").toLowerCase();
    if (/^image\/(png|jpe?g|gif|webp|avif|bmp)$/.test(t)) return "image"; // SVG sengaja dianggap file biasa
    if (t.startsWith("audio/")) return "audio";
    if (!t) {
      if (/\.(png|jpe?g|gif|webp|avif|bmp)$/.test(n)) return "image";
      if (/\.(mp3|m4a|wav|ogg|oga|opus|aac|flac|weba)$/.test(n)) return "audio";
    }
    return "file";
  }

  let toastTimer;
  function toast(text) {
    toastEl.textContent = text;
    toastEl.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove("show"), 2600);
  }

  /* ---------- Scroll ---------- */
  let pinned = true;
  chat.addEventListener("scroll", () => {
    pinned = chat.scrollHeight - chat.scrollTop - chat.clientHeight < 90;
  }, { passive: true });
  function toBottom() { chat.scrollTop = chat.scrollHeight; pinned = true; }

  /* ---------- Render pesan ---------- */
  const ICON_FILE = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.800" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/></svg>';
  const ICON_DL = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v11M7 11l5 5 5-5M5 20h14"/></svg>';

  function mediaNode(m, kind) {
    if (kind === "image") {
      const a = el("a", "media-link");
      a.href = m.url; a.target = "_blank"; a.rel = "noopener";
      a.setAttribute("aria-label", "Buka foto " + m.fname);
      const img = new Image();
      img.alt = m.fname; img.decoding = "async"; img.src = m.url;
      img.addEventListener("load", () => { if (pinned) toBottom(); });
      a.append(img);
      return a;
    }
    if (kind === "audio") {
      const w = el("div", "audio");
      const au = document.createElement("audio");
      au.controls = true; au.preload = "metadata"; au.src = m.url;
      w.append(au, el("p", "fname", m.fname));
      return w;
    }
    const a = el("a", "filecard");
    a.href = m.url; a.download = m.fname;
    a.setAttribute("aria-label", "Unduh " + m.fname);
    const ico = el("span", "f-ico"); ico.innerHTML = ICON_FILE; // ikon statis (bukan input user)
    const txt = el("span", "f-text");
    txt.append(el("b", null, m.fname), el("small", null, fmtSize(m.size)));
    const dl = el("span", "f-dl"); dl.innerHTML = ICON_DL;
    a.append(ico, txt, dl);
    return a;
  }

  function addMessage(m) {
    const mine = m.cid === CID;
    const kind = m.file ? kindOf({ type: m.mime, name: m.fname }) : "text";

    const row = el("div", "msg" + (mine ? " me" : ""));
    const av = el("span", "avatar", initials(m.name));
    const [a1, a2] = PAIRS[hash(m.name) % PAIRS.length];
    av.style.setProperty("--a1", a1); av.style.setProperty("--a2", a2);
    av.setAttribute("aria-hidden", "true");

    const col = el("div", "col");
    const bubble = el("div", "bubble" + (kind !== "text" ? " media" : ""));
    if (kind !== "text") bubble.append(mediaNode(m, kind));
    if (m.text) bubble.append(el("div", kind === "text" ? "txt" : "caption", m.text));

    col.append(el("p", "who", m.name), bubble, el("p", "time", fmtTime(m.ts)));
    row.append(av, col);
    stream.append(row);
    if (mine || pinned) toBottom();
  }

  function addNote(text) {
    const n = el("div", "note");
    n.append(el("span", null, text));
    stream.append(n);
    if (pinned) toBottom();
  }

  /* ---------- Header & hitungan ---------- */
  const peers = new Map(); // cid -> username (tab lain di room ini)

  function updateCounts() {
    const members = room.n + 1 + peers.size;
    const total = ROOMS.reduce((s, r) => s + r.n, 0) + 1 + peers.size;
    $("#rMembers").textContent = formatNumber(members);
    $("#totalOnline").textContent = formatNumber(total);
  }

  fillThumb($("#rThumb"), room);
  $("#rName").textContent = room.name;
  $("#meName").textContent = "@" + name;
  updateCounts();

  /* ---------- Channel (simulasi realtime antar-tab) ---------- */
  const bc = "BroadcastChannel" in window ? new BroadcastChannel("discordmini:" + room.id) : null;
  function post(d) { try { if (bc) bc.postMessage(d); } catch (_) { toast("Pesan tidak dapat dikirim ke tab lain."); } }

  if (bc) {
    bc.onmessage = (e) => {
      const d = e.data;
      if (!d || typeof d !== "object" || d.cid === CID) return;
      if (typeof d.name !== "string" || validateUsername(d.name)) return;

      if (d.t === "hi" || d.t === "here") {
        const isNew = !peers.has(d.cid);
        peers.set(d.cid, d.name);
        if (isNew) {
          if (d.t === "hi") { addNote("@" + d.name + " bergabung"); post({ t: "here", cid: CID, name }); }
          updateCounts();
        }
      } else if (d.t === "bye") {
        if (peers.delete(d.cid)) { addNote("@" + d.name + " keluar"); updateCounts(); }
      } else if (d.t === "msg") {
        const hasFile = d.file instanceof Blob;
        addMessage({
          cid: d.cid, name: d.name, ts: Number(d.ts) || Date.now(),
          text: typeof d.text === "string" ? d.text.slice(0, 2000) : "",
          file: hasFile, fname: String(d.fname || "file").slice(0, 120), size: hasFile ? d.file.size : 0, mime: String(d.mime || ""),
          url: hasFile ? URL.createObjectURL(d.file) : "",
        });
      }
    };
  }

  /* ---------- Riwayat contoh (dummy) ---------- */
  const SEED = [
    { name: "mira_",   min: 14, text: "Halo semuanya! Ada yang baru gabung hari ini?" },
    { name: "dimas.k", min: 12, text: "Halo Mira, aku baru masuk nih. Lagi bahas apa?" },
    { name: "luna-s",  min: 9,  text: "Lagi santai aja, ngobrol bebas. Silakan ikut gabung ya 😊" },
    { name: "mira_",   min: 6,  text: "Kalau mau kirim foto, file, atau audio, pakai ikon klip di kiri bawah." },
    { name: "rafi_ap", min: 3,  text: "Siap, makasih infonya!" },
  ];
  stream.append((() => { const d = el("div", "divider"); d.append(el("span", null, "Hari ini")); return d; })());
  for (const s of SEED) {
    addMessage({ cid: "seed-" + s.name, name: s.name, ts: Date.now() - s.min * 60000, text: s.text, file: false });
  }
  addNote("Kamu bergabung sebagai @" + name);
  toBottom();
  post({ t: "hi", cid: CID, name });

  /* ---------- Input & lampiran ---------- */
  let pending = null;
  let previewUrl = "";

  function refresh() { sendBtn.disabled = !(msg.value.trim() || pending); }
  function fit() { msg.style.height = "auto"; msg.style.height = Math.min(msg.scrollHeight, 120) + "px"; }

  function clearPending() {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = ""; pending = null;
    pendingBox.hidden = true;
    $("#pThumb").replaceChildren();
    refresh();
  }

  function setPending(f) {
    clearPending();
    pending = f;
    $("#pName").textContent = f.name;
    $("#pSize").textContent = fmtSize(f.size);
    const t = $("#pThumb");
    if (kindOf(f) === "image") {
      previewUrl = URL.createObjectURL(f);
      const img = new Image(); img.alt = ""; img.src = previewUrl;
      t.replaceChildren(img);
    } else {
      t.innerHTML = ICON_FILE;
    }
    pendingBox.hidden = false;
    refresh();
    msg.focus();
  }

  $("#attach").addEventListener("click", () => fileInput.click());
  $("#pRemove").addEventListener("click", () => { clearPending(); msg.focus(); });
  fileInput.addEventListener("change", () => {
    const f = fileInput.files && fileInput.files[0];
    fileInput.value = "";
    if (!f) return;
    if (f.size > MAX_BYTES) { toast("Ukuran file maksimal 25 MB."); return; }
    setPending(f);
  });

  function submit() {
    const text = msg.value.trim();
    if (!text && !pending) return;

    const m = { t: "msg", cid: CID, name, ts: Date.now(), text };
    if (pending) { m.file = pending; m.fname = pending.name; m.size = pending.size; m.mime = pending.type; }
    post(m);

    addMessage({
      cid: CID, name, ts: m.ts, text,
      file: !!pending, fname: m.fname, size: m.size, mime: m.mime,
      url: pending ? URL.createObjectURL(pending) : "",
    });

    msg.value = ""; fit();
    clearPending();
    toBottom();
  }

  composer.addEventListener("submit", (e) => { e.preventDefault(); submit(); });
  msg.addEventListener("input", () => { fit(); refresh(); });
  msg.addEventListener("keydown", (e) => {
    // Desktop: Enter kirim, Shift+Enter baris baru. HP: Enter = baris baru (kirim lewat tombol >)
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing && !matchMedia("(pointer: coarse)").matches) {
      e.preventDefault();
      submit();
    }
  });

  window.addEventListener("pagehide", () => post({ t: "bye", cid: CID, name }));
  window.addEventListener("resize", () => { if (pinned) toBottom(); });
  msg.focus({ preventScroll: true });
})();