/* ==========================================================
   Discord Mini — data room bersama (dipakai index.html & room.html)

   Setiap room punya `photo`. Saat ini memakai foto placeholder.
   Nanti admin cukup mengisi `photo` dengan URL foto yang diunggah,
   mis. photo: "/uploads/gaming-night.jpg".
   Jika foto gagal dimuat, kotak menampilkan huruf pertama nama room.
   ========================================================== */

const ROOMS = [
  { id: "general-lounge", name: "General Lounge",    g: ["#cfe6ff", "#e3d4ff"], n: 142 },
  { id: "gaming-night",   name: "Gaming Night",      g: ["#d8c8ff", "#ffd3e6"], n: 98 },
  { id: "music-corner",   name: "Music Corner",      g: ["#ffd3e6", "#ffe6c9"], n: 76 },
  { id: "study-hall",     name: "Study Hall",        g: ["#c9f3e4", "#cfe6ff"], n: 64 },
  { id: "dev-talk",       name: "Dev Talk",          g: ["#cfe6ff", "#c9f3e4"], n: 57 },
  { id: "anime-club",     name: "Anime Club",        g: ["#ffd3e6", "#d8c8ff"], n: 88 },
  { id: "art-design",     name: "Art & Design",      g: ["#e3d4ff", "#c9f3e4"], n: 41 },
  { id: "movie-club",     name: "Movie Club",        g: ["#ffe6c9", "#ffd3e6"], n: 52 },
  { id: "fitness-crew",   name: "Fitness Crew",      g: ["#c9f3e4", "#fff1c9"], n: 33 },
  { id: "language-swap",  name: "Language Exchange", g: ["#cfe6ff", "#d8c8ff"], n: 47 },
  { id: "photo-walk",     name: "Photo Walk",        g: ["#e3d4ff", "#cfe6ff"], n: 29 },
  { id: "late-night",     name: "Late Night Talks",  g: ["#d8c8ff", "#cfe6ff"], n: 71 },
].map((r) => ({ ...r, photo: r.photo || "https://picsum.photos/seed/dm-" + r.id + "/240/240" }));

function getRoom(id) {
  return ROOMS.find((r) => r.id === id) || null;
}

function formatNumber(n) {
  return n.toLocaleString("en-US");
}

// Isi kotak thumbnail (.thumb) dengan foto room
function fillThumb(box, room) {
  box.style.setProperty("--g1", room.g[0]);
  box.style.setProperty("--g2", room.g[1]);
  const img = new Image();
  img.alt = "";
  img.decoding = "async";
  img.referrerPolicy = "no-referrer";
  img.addEventListener("error", () => {
    const s = document.createElement("span");
    s.className = "initial";
    s.textContent = [...room.name][0];
    box.replaceChildren(s);
  }, { once: true });
  img.src = room.photo;
  box.replaceChildren(img);
}

// Validasi username (dipakai popup Join & halaman room)
const NAME_RE = /^[\p{L}\p{N}._-]+$/u;
function validateUsername(v) {
  if (!v) return "Username tidak boleh kosong.";
  if (/\s/.test(v)) return "Username tidak boleh mengandung spasi.";
  if (v.length < 3) return "Username minimal 3 karakter.";
  if (v.length > 20) return "Username maksimal 20 karakter.";
  if (!NAME_RE.test(v)) return "Hanya huruf, angka, titik, garis bawah, dan strip yang boleh dipakai.";
  return "";
}