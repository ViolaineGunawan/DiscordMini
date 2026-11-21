/* ==========================================================
   Discord Mini — Home Client + Join Room Popup
   Data room ada di rooms.js. Jumlah "online" masih simulasi.
   Sambungkan ke backend / WebSocket kamu nanti.
   ========================================================== */

// Setelah username dikirim, user langsung diarahkan ke halaman room chat.
const ROOM_URL = "pages/room.html?id=";

// Username & room disimpan agar bisa dibaca halaman room chat:
//   localStorage["discordmini:username"]   → username terakhir (untuk prefill)
//   sessionStorage["discordmini:session"]  → { room: "<id>", username: "<nama>" }
const KEY_NAME = "discordmini:username";
const KEY_SESSION = "discordmini:session";

/* ---------- Elements ---------- */
const $ = (s) => document.querySelector(s);
const list = $("#rooms");
const input = $("#q");
const clearBtn = $(".clear");
const searchBox = $(".search");
const countEl = $("#count");
const totalEl = $("#totalOnline");
const emptyEl = $("#empty");
const emptyQ = $("#emptyQ");

// popup
const modal = $("#joinModal");
const dialog = modal.querySelector(".dialog");
const form = $("#joinForm");
const uField = $("#uField");
const uInput = $("#username");
const uCount = $("#uCount");
const uErr = $("#uErr");
const submitBtn = $("#submitBtn");
const submitLabel = $("#submitLabel");

let refs = new Map(); // id -> { count }
const fmt = formatNumber;

/* ---------- Helpers ---------- */
function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
}

// Highlight kata kunci tanpa innerHTML (aman dari injeksi)
function highlight(text, q) {
  const frag = document.createDocumentFragment();
  if (!q) { frag.append(text); return frag; }
  const lower = text.toLowerCase();
  const needle = q.toLowerCase();
  let i = 0;
  while (true) {
    const at = lower.indexOf(needle, i);
    if (at === -1) { frag.append(text.slice(i)); break; }
    if (at > i) frag.append(text.slice(i, at));
    frag.append(el("mark", null, text.slice(at, at + needle.length)));
    i = at + needle.length;
  }
  return frag;
}

function store(kind, key, value) {
  try { (kind === "local" ? localStorage : sessionStorage).setItem(key, value); } catch (_) { /* storage diblokir */ }
}
function read(kind, key) {
  try { return (kind === "local" ? localStorage : sessionStorage).getItem(key); } catch (_) { return null; }
}

/* ---------- Room list ---------- */
function buildRoom(r, i, q, animate) {
  const li = el("li", "room glass" + (animate ? " rise" : ""));
  li.style.setProperty("--i", i);

  const thumb = el("div", "thumb");
  thumb.setAttribute("aria-hidden", "true");
  fillThumb(thumb, r);

  const info = el("div", "info");
  const h3 = el("h3");
  h3.append(highlight(r.name, q));
  const meta = el("p", "meta");
  const dot = el("i", "pulse");
  dot.setAttribute("aria-hidden", "true");
  const count = el("b", null, fmt(r.n));
  meta.append(dot, count, document.createTextNode(" online"));
  info.append(h3, meta);

  const btn = el("button", "btn-join", "Join");
  btn.type = "button";
  btn.setAttribute("aria-label", "Join " + r.name);
  btn.setAttribute("aria-haspopup", "dialog");
  btn.addEventListener("click", () => openJoin(r, btn));

  li.append(thumb, info, btn);
  refs.set(r.id, { count });
  return li;
}

function render(animate = false) {
  const q = input.value.trim();
  const items = q ? ROOMS.filter((r) => r.name.toLowerCase().includes(q.toLowerCase())) : ROOMS;

  refs = new Map();
  list.replaceChildren(...items.map((r, i) => buildRoom(r, i, q, animate)));

  const none = items.length === 0;
  emptyEl.hidden = !none;
  list.hidden = none;
  if (none) emptyQ.textContent = "“" + q + "”";
  countEl.textContent = items.length + (items.length === 1 ? " room" : " rooms");

  clearBtn.hidden = !input.value;
  searchBox.classList.toggle("has-value", !!input.value);
}

/* ---------- Online counts ---------- */
function updateCounts() {
  let total = 0;
  for (const r of ROOMS) total += r.n;
  totalEl.textContent = fmt(total);
  for (const r of ROOMS) {
    const ref = refs.get(r.id);
    if (ref) ref.count.textContent = fmt(r.n);
  }
  if (activeRoom) $("#dOnline").textContent = fmt(activeRoom.n);
}

// Simulasi perubahan jumlah pengguna (hapus saat sudah pakai data asli)
function drift() {
  for (const r of ROOMS) {
    const step = Math.floor(Math.random() * 5) - 2; // -2..+2
    r.n = Math.max(3, r.n + step);
  }
  updateCounts();
}

/* ==========================================================
   Join popup
   ========================================================== */
let activeRoom = null;
let lastFocus = null;
let sending = false;

function setError(msg) {
  uErr.textContent = msg;
  uField.classList.toggle("invalid", !!msg);
  uInput.setAttribute("aria-invalid", msg ? "true" : "false");
}

function setBackgroundInert(on) {
  document.querySelectorAll(".wrap, .site-footer").forEach((n) => { n.inert = on; });
}

function resetSubmit() {
  sending = false;
  submitBtn.classList.remove("is-loading");
  submitBtn.disabled = false;
  submitLabel.textContent = "Kirim";
}

function openJoin(room, trigger) {
  activeRoom = room;
  lastFocus = trigger;

  // isi info room (foto, nama, online)
  fillThumb($("#dThumb"), room);
  $("#dRoom").textContent = room.name;
  $("#dOnline").textContent = fmt(room.n);

  // reset tampilan
  resetSubmit();
  setError("");
  uInput.value = read("local", KEY_NAME) || "";
  uCount.textContent = uInput.value.length + "/20";

  modal.inert = false;
  modal.setAttribute("aria-hidden", "false");
  modal.classList.add("open");
  document.documentElement.classList.add("modal-open");
  setBackgroundInert(true);

  requestAnimationFrame(() => { uInput.focus(); uInput.select(); });
}

function closeJoin() {
  if (!modal.classList.contains("open")) return;
  modal.classList.remove("open");
  modal.setAttribute("aria-hidden", "true");
  modal.inert = true;
  document.documentElement.classList.remove("modal-open");
  setBackgroundInert(false);
  activeRoom = null;
  if (lastFocus && document.contains(lastFocus)) lastFocus.focus();
}

form.addEventListener("submit", (e) => {
  e.preventDefault();
  if (sending || !activeRoom) return;

  const name = uInput.value.trim();
  const err = validateUsername(name);
  if (err) {
    setError(err);
    dialog.classList.remove("shake");
    void dialog.offsetWidth; // restart animasi
    dialog.classList.add("shake");
    uInput.focus();
    return;
  }

  setError("");
  sending = true;
  submitBtn.disabled = true;
  submitBtn.classList.add("is-loading");
  submitLabel.textContent = "Masuk";

  const room = activeRoom;
  // TODO: kirim { room: room.id, username: name } ke server dan tunggu respons di sini.
  setTimeout(() => {
    store("local", KEY_NAME, name);
    store("session", KEY_SESSION, JSON.stringify({ room: room.id, username: name }));
    // "u" dipakai sebagai cadangan jika storage browser diblokir
    location.href = ROOM_URL + encodeURIComponent(room.id) + "&u=" + encodeURIComponent(name);
  }, 600);
});

uInput.addEventListener("input", () => {
  uCount.textContent = uInput.value.length + "/20";
  if (uErr.textContent) setError("");
});

// tutup: tombol X, klik area gelap, Esc
modal.addEventListener("click", (e) => {
  if (e.target === modal || e.target.closest("[data-close]")) closeJoin();
});

// Focus trap sederhana di dalam dialog
document.addEventListener("keydown", (e) => {
  if (!modal.classList.contains("open")) return;
  if (e.key === "Escape") { closeJoin(); return; }
  if (e.key !== "Tab") return;

  const items = [...dialog.querySelectorAll("button, input, a[href]")].filter((n) => n.offsetParent !== null && !n.disabled);
  if (!items.length) return;
  const first = items[0];
  const last = items[items.length - 1];
  if (e.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
    e.preventDefault(); last.focus();
  } else if (!e.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) {
    e.preventDefault(); first.focus();
  }
});

// Kembali dari room lewat tombol Back: pastikan popup tidak menggantung
window.addEventListener("pageshow", (e) => {
  if (e.persisted) { resetSubmit(); closeJoin(); }
});

/* ---------- Search events ---------- */
input.addEventListener("input", () => render(false));
input.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && input.value) { input.value = ""; render(false); }
});
function clearSearch() { input.value = ""; render(false); input.focus(); }
clearBtn.addEventListener("click", clearSearch);
$("#emptyClear").addEventListener("click", clearSearch);

document.addEventListener("keydown", (e) => {
  if (e.key === "/" && !modal.classList.contains("open") && document.activeElement !== input && !e.metaKey && !e.ctrlKey) {
    e.preventDefault();
    input.focus();
  }
});

// Soft parallax untuk gradient mesh
let ticking = false;
window.addEventListener("scroll", () => {
  if (ticking) return;
  ticking = true;
  requestAnimationFrame(() => {
    document.documentElement.style.setProperty("--sy", window.scrollY);
    ticking = false;
  });
}, { passive: true });

/* ---------- Init ---------- */
$("#year").textContent = new Date().getFullYear();
render(true);
updateCounts();
setInterval(drift, 3500);