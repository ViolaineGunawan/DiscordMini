/* ==========================================================
   Discord Mini — status panggilan bersama (room.html & call.html)

   Status call per room disimpan di localStorage:
     discordmini:call:<roomId> = { startedAt, members: { <cid>: { name, muted, seen } } }
   Setiap peserta mengirim "heartbeat" (seen). Peserta yang tidak
   mengirim heartbeat > 30 detik dianggap sudah keluar.
   Ini hanya simulasi di browser yang sama. Untuk panggilan antar-perangkat
   sungguhan butuh server signaling + WebRTC.
   ========================================================== */

const CallStore = (() => {
  const TTL = 30000;
  const key = (id) => "discordmini:call:" + id;

  function load(id) {
    try { return JSON.parse(localStorage.getItem(key(id)) || "null"); } catch (_) { return null; }
  }
  function save(id, s) {
    try {
      if (s) localStorage.setItem(key(id), JSON.stringify(s));
      else localStorage.removeItem(key(id));
    } catch (_) { /* storage diblokir */ }
  }
  function prune(s) {
    if (!s || typeof s !== "object" || !s.members) return null;
    const now = Date.now();
    for (const [cid, m] of Object.entries(s.members)) {
      if (!m || now - (m.seen || 0) > TTL) delete s.members[cid];
    }
    return Object.keys(s.members).length ? s : null;
  }

  return {
    key,
    // Call yang sedang berlangsung (atau null)
    get(id) { return prune(load(id)); },
    // Daftar / perbarui diri sebagai peserta. Membuat call baru jika belum ada.
    beat(id, cid, patch, fallbackStart) {
      let s = prune(load(id));
      if (!s) s = { startedAt: fallbackStart || Date.now(), members: {} };
      const m = Object.assign(s.members[cid] || {}, patch || {});
      m.seen = Date.now();
      s.members[cid] = m;
      save(id, s);
      return s;
    },
    leave(id, cid) {
      const s = load(id);
      if (!s || !s.members) return;
      delete s.members[cid];
      save(id, prune(s));
    },
  };
})();

function formatDuration(ms) {
  const t = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
  const p = (n) => String(n).padStart(2, "0");
  return h ? h + ":" + p(m) + ":" + p(s) : p(m) + ":" + p(s);
}