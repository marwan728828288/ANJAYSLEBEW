// ============ SIMULASI STORAGE (demo lokal) ============
// Sebelum dihubungkan ke otak proses extension, data klaim disimpan di
// localStorage browser. Saat integrasi, fungsi simpan & cari diganti ke
// komunikasi dengan otak proses (chrome.runtime / webhook).

const STORE_KEY = "jb_claims_v1";

function loadClaims() {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY)) || [];
  } catch (e) {
    return [];
  }
}
function saveClaims(claims) {
  localStorage.setItem(STORE_KEY, JSON.stringify(claims));
}
function json(id) {
  return document.getElementById(id);
}

// ============ INIT ============
document.addEventListener("DOMContentLoaded", () => {
  buildSiteOptions();
  wireNav();
  wireKlaim();
  wireStatus();
  renderRecent();
});

function buildSiteOptions() {
  const sel = json("f-situs");
  // Kelompokkan per platform biar gampang dipilih
  const groups = {};
  SITES.forEach(s => {
    if (!groups[s.platform]) groups[s.platform] = [];
    groups[s.platform].push(s);
  });
  Object.keys(groups).sort().forEach(platformKey => {
    const optgroup = document.createElement("optgroup");
    optgroup.label = platformKey.toUpperCase();
    groups[platformKey].forEach(s => {
      const opt = document.createElement("option");
      opt.value = s.host;
      opt.textContent = s.label + "  (" + s.host + ")";
      optgroup.appendChild(opt);
    });
    sel.appendChild(optgroup);
  });
}

// ============ NAVIGASI ============
function wireNav() {
  document.querySelectorAll(".nav-link").forEach(link => {
    link.addEventListener("click", ev => {
      ev.preventDefault();
      const target = link.getAttribute("href").replace("#/", "");
      showView(target);
    });
  });
  // dukungan hash (#/status) supaya bisa di-share
  const hash = location.hash.replace("#/", "");
  if (hash === "status") showView("status");
}

function showView(name) {
  document.querySelectorAll(".page-view").forEach(v => v.classList.remove("active"));
  document.querySelectorAll(".nav-link").forEach(l => l.classList.remove("active"));
  json("page-" + name).classList.add("active");
  const link = document.querySelector('.nav-link[href="#/' + name + '"]');
  if (link) link.classList.add("active");
  renderRecent();
}

// ============ KLAIM ============
function wireKlaim() {
  json("f-betting").addEventListener("input", () => {
    json("f-betting").value = json("f-betting").value.replace(/[^\d]/g, "");
  });
  json("btn-klaim").addEventListener("click", submitKlaim);
}

function submitKlaim() {
  const situs  = json("f-situs").value.trim();
  const userId = json("f-userid").value.trim();
  const kode   = json("f-kode").value.trim();
  const betting= json("f-betting").value.trim();
  const scatter= json("f-scatter").value.trim();

  if (!situs)  return toast("Pilih situs asal klaim dulu.");
  if (!userId) return toast("Isi user id / nomor member.");
  if (!kode)   return toast("Isi kode tiket.");
  if (!betting || parseInt(betting, 10) <= 0) return toast("Isi nominal betting dengan benar.");
  if (!scatter) return toast("Pilih jumlah scatter (3, 4, atau 5).");

  const siteObj = SITES.find(s => s.host === situs) || { label: situs, host: situs };
  const now = Date.now();
  const ref = "JB-" + now.toString(36).toUpperCase().slice(-6);

  const claim = {
    ref,
    kode,
    userId,
    betting: parseInt(betting, 10),
    scatter: parseInt(scatter, 10),
    site: siteObj.host,
    siteLabel: siteObj.label,
    status: "menunggu",   // menunggu -> diproses -> approved / rejected
    created: now,
    updated: now,
    history: [
      { t: now, s: "Klaim diterima" },
      { t: now, s: "Menunggu verifikasi sistem" }
    ]
  };

  const claims = loadClaims();
  // anti duplikat: kode tiket yang sama di situs yang sama ditolak
  const dup = claims.find(c =>
    c.site === claim.site && c.kode === claim.kode &&
    (c.status === "menunggu" || c.status === "diproses")
  );
  if (dup) return toast("Klaim dengan kode ini di situs tersebut sudah ada.");

  claims.push(claim);
  saveClaims(claims);

  // Simulasi: setelah 8 detik status bergeser ke "diproses" (demo)
  setTimeout(() => advanceStatus(claim.ref, "diproses", "Sistem memeriksa di " + siteObj.host), 8000);

  showResult(json("klaim-result"), "success",
    "Klaim dikirim. Nomor ref: " + ref + ". Klaim masuk antrean " + siteObj.host +
    " dan akan diperiksa nominal serta scatter secara ganda.");

  json("f-kode").value = "";
  toast("Klaim masuk antrean " + siteObj.label);
  renderRecent();
}

function advanceStatus(ref, status, note) {
  const claims = loadClaims();
  const c = claims.find(x => x.ref === ref);
  if (!c || c.status === "approved" || c.status === "rejected") return;
  if (c.status === "diproses" && status === "diproses") return;

  c.status = status;
  c.updated = Date.now();
  c.history.push({ t: Date.now(), s: note || status });
  if (status === "approved") c.history.push({ t: Date.now(), s: "Nominal & scatter cocok. Klaim disetujui." });
  if (status === "rejected") c.history.push({ t: Date.now(), s: "Ada ketidakcocokan. Klaim ditolak." });
  saveClaims(claims);

  // kalau status page sedang tampil, refresh
  if (json("page-status").classList.contains("active") && json("s-key").value.trim()) {
    doStatusSearch();
  }
  renderRecent();
  toast("Status klaim " + ref + " diperbarui: " + status.toUpperCase());
}

// ============ STATUS ============
function wireStatus() {
  json("btn-status").addEventListener("click", doStatusSearch);
  json("s-key").addEventListener("keydown", ev => {
    if (ev.key === "Enter") doStatusSearch();
  });
}

function doStatusSearch() {
  const key = json("s-key").value.trim().toLowerCase();
  if (!key) return toast("Masukkan kode tiket atau nomor ref.");
  const claims = loadClaims();
  const found = claims.filter(c =>
    c.kode.toLowerCase().includes(key) ||
    c.ref.toLowerCase().includes(key) ||
    c.userId.toLowerCase().includes(key)
  );
  if (found.length === 0) {
    showResult(json("status-result"), "error", "Tidak ditemukan klaim dengan kata kunci tersebut.");
    return;
  }
  renderStatusCards(found);
}

function renderStatusCards(list) {
  const box = json("status-result");
  box.classList.remove("hidden");
  box.classList.remove("error", "success", "loading");
  box.classList.add("visible");
  box.innerHTML = "";
  list.forEach(c => {
    const el = document.createElement("div");
    el.className = "status-card-mini";
    el.style.cssText = "margin-bottom:18px;padding-bottom:18px;border-bottom:1px dashed var(--line);";
    el.appendChild(statusHeader(c));
    el.appendChild(statusTimeline(c));
    box.appendChild(el);
  });
}

function statusHeader(c) {
  const d = document.createElement("div");
  d.style.cssText = "display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;";
  const left = document.createElement("div");
  left.innerHTML =
    '<div style="font-family:JetBrains Mono,monospace;font-weight:700;color:var(--ink);">' + c.kode + "</div>" +
    '<div style="font-size:12px;color:var(--muted);margin-top:2px;">' + c.siteLabel + " &middot; User " + c.userId +
    " &middot; Rp" + c.betting.toLocaleString("id-ID") + " &middot; Scatter " + c.scatter + "</div>";
  const badge = document.createElement("span");
  badge.className = "badge-status " + badgeClass(c.status);
  badge.textContent = badgeText(c.status);
  d.appendChild(left);
  d.appendChild(badge);
  return d;
}

function statusTimeline(c) {
  const steps = [
    { key: "menunggu", label: "Menunggu verifikasi" },
    { key: "diproses", label: "Sedang diperiksa" },
    { key: "final",    label: "Keputusan akhir" }
  ];
  const idx = c.status === "approved" || c.status === "rejected" ? 2 : (c.status === "diproses" ? 1 : 0);
  const wrap = document.createElement("div");
  wrap.className = "status-timeline";
  steps.forEach((st, i) => {
    const row = document.createElement("div");
    row.className = "tl-row " + (i < idx ? "done" : (i === idx ? "active" : ""));
    const dot = document.createElement("div");
    dot.className = "tl-dot";
    const txt = document.createElement("div");
    txt.className = "tl-text";
    const p = document.createElement("p");
    p.textContent = st.label;
    const span = document.createElement("span");
    if (i === idx && (c.status === "approved" || c.status === "rejected")) {
      span.textContent = c.status === "approved" ? "APPROVED - Nominal & scatter sesuai" : "REJECTED - " + (c.history[c.history.length-1]?.s || "Tidak sesuai");
    } else if (i === idx) {
      span.textContent = "Terakhir diperbarui " + fmt(c.updated);
    } else {
      span.textContent = i === 0 ? fmt(c.created) : fmt(c.updated);
    }
    txt.appendChild(p);
    txt.appendChild(span);
    row.appendChild(dot);
    row.appendChild(txt);
    wrap.appendChild(row);
  });
  return wrap;
}

function badgeClass(status) {
  if (status === "approved") return "approved";
  if (status === "rejected") return "rejected";
  if (status === "diproses") return "diproses";
  return "menunggu";
}
function badgeText(status) {
  if (status === "approved") return "APPROVED";
  if (status === "rejected") return "REJECTED";
  if (status === "diproses") return "DIPROSES";
  return "MENUNGGU";
}

function fmt(ts) {
  const d = new Date(ts);
  return d.toLocaleString("id-ID", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

// ============ RIWAYAT TERBARU ============
function renderRecent() {
  const list = json("recent-list");
  const claims = loadClaims().slice(-6).reverse();
  if (claims.length === 0) {
    list.innerHTML = '<div style="color:var(--muted);font-size:13px;">Belum ada klaim.</div>';
    return;
  }
  list.innerHTML = "";
  claims.forEach(c => {
    const item = document.createElement("div");
    item.className = "recent-item";
    item.innerHTML =
      '<div class="recent-main">' +
        '<div class="recent-code">' + c.kode + "</div>" +
        '<div class="recent-meta">' + c.ref + " &middot; " + c.siteLabel + " &middot; " + badgeText(c.status) + "</div>" +
      "</div>" +
      '<span class="recent-site">' + c.siteLabel + "</span>";
    list.appendChild(item);
  });
}

// ============ TOAST & RESULT ============
function toast(msg) {
  const t = json("toast");
  t.textContent = msg;
  t.classList.remove("hidden");
  clearTimeout(t._tm);
  t._tm = setTimeout(() => t.classList.add("hidden"), 2800);
}

function showResult(box, type, msg) {
  box.classList.remove("hidden", "error", "success", "loading");
  box.classList.add("visible", type);
  box.innerHTML = msg;
}