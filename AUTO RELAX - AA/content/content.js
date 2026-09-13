(() => {
  console.log("BET LOGGER: content.js jalan");

  function getKodeTiketFromUrl() {
    try {
      const u = new URL(location.href);
      const inv = u.searchParams.get('invoice') || '';
      return inv.split('-')[0] || '';
    } catch {
      return '';
    }
  }

  function waitFor(selector, timeout = 3000) {
    return new Promise((resolve, reject) => {
      const existing = document.querySelector(selector);
      if (existing) return resolve(existing);
      const observer = new MutationObserver(() => {
        const el = document.querySelector(selector);
        if (el) {
          observer.disconnect();
          resolve(el);
        }
      });
      observer.observe(document.documentElement, {
        childList: true,
        subtree: true
      });
      setTimeout(() => {
        observer.disconnect();
        reject("Timeout waiting: " + selector);
      }, timeout);
    });
  }

  /* Menunggu navigasi round selesai (render berubah). Snapshot gabungan dari
     judul round (selalu berubah antar round) + judul payout terakhir — resolve
     cepat begitu salah satunya berubah, fallback timeout agar selalu bounded. */
  function waitForRoundChange(previousSnapshot = "", timeout = 1500) {
    return new Promise((resolve) => {
      const observer = new MutationObserver(() => {
        const round = document.querySelector(".result-detail-item.round-title")?.innerText?.trim() || '';
        const titles = [...document.querySelectorAll(".payout-item-title")];
        const last = titles[titles.length - 1]?.innerText?.trim() || '';
        const snapshot = round + '||' + last;
        if (snapshot && snapshot !== previousSnapshot) {
          clearTimeout(timer);
          observer.disconnect();
          resolve();
        }
      });
      const timer = setTimeout(() => {
        observer.disconnect();
        resolve();
      }, timeout);
      observer.observe(document.body, {
        childList: true,
        subtree: true
      });
    });
  }

  function waitForBetResultStable(timeout = 8000, stableMs = 600) {
    return new Promise((resolve) => {
      const startTime = Date.now();
      let lastCount = -1;
      let stableStart = null;

      function check() {
        if (Date.now() - startTime >= timeout) {
          resolve();
          return;
        }
        const current = document.querySelectorAll(".bet-result-item").length;
        if (current !== lastCount) {
          lastCount = current;
          stableStart = Date.now();
        } else if (stableStart !== null && Date.now() - stableStart >= stableMs) {
          resolve();
          return;
        }
        setTimeout(check, 100);
      }
      check();
    });
  }
  async function runWhenReady() {
    try {
      const bodyText = (document.body?.innerText || '').trim();
      if (bodyText === 'Session Timeout' || bodyText.includes('Session Timeout')) {
        const kode = getKodeTiketFromUrl();
        if (kode) {
          try { chrome.runtime.sendMessage({ type: "BET_ERROR", kodeTiket: kode, error: 'Session Timeout' }); } catch(e) {}
        }
        return;
      }
      await waitFor(".header-transaction .header-item-value", 10000);
      await waitFor(".header-item:nth-child(2) .header-item-value", 10000);

      function t(sel) {
        return document.querySelector(sel)?.innerText.trim() || "";
      }

      function formatThreeDecimal(str) {
        if (!str) return "";
        let s = str.replace(/[^\d,.]/g, "");
        let hasComma = s.includes(",");
        let hasDot = s.includes(".");
        if (hasComma && hasDot) {
          let lastComma = s.lastIndexOf(",");
          let lastDot = s.lastIndexOf(".");
          if (lastComma > lastDot) {
            s = s.replace(/\./g, "").replace(",", ".");
          } else {
            s = s.replace(/,/g, "");
          }
        } else if (hasComma) {
          s = s.replace(",", ".");
        }
        let parts = s.split(".");
        let intPart = parts[0] || "0";
        let decPart = (parts[1] || "").slice(0, 3);
        while (decPart.length < 3) decPart += "0";
        return intPart + "," + decPart;
      }
      const data = {
        transaction: t(".header-transaction .header-item-value"),
        bet: formatThreeDecimal(t(".header-item:nth-child(2) .header-item-value")),
        profit: formatThreeDecimal(t(".header-item:nth-child(3) .header-item-value")),
        balance: t(".header-balance .header-item-value"),
        spin_type: t(".result-title-title span"),
        symbols: [],
        payouts: [],
        free_spins: [],
        total_free_spin: "0,000"
      };
      document.querySelectorAll(".bet-result-column").forEach((col, i) => {
        const syms = [...col.querySelectorAll(".symbol")].map(s => s.className.replace("sprite-symbol symbol ", "")).filter(Boolean);
        if (syms.length)
          data.symbols.push(`C${i+1}:${syms.join(", ")}`);
      });
      await waitForBetResultStable(8000, 600);
      let totalFreeSpin = 0;
      document.querySelectorAll(".bet-result-item").forEach(e => {
        const n = e.querySelector(".result-item-name")?.innerText;
        const w = e.querySelector(".result-item-win")?.innerText;
        if (n && w) {
          data.free_spins.push(`${n}=${w}`);
          if (n.toLowerCase().includes("free spin")) {
            let numeric = w.replace(/idr/gi, "").replace(/\./g, "").replace(",", ".").trim();
            const value = parseFloat(numeric);
            if (!isNaN(value)) {
              totalFreeSpin += value;
            }
          }
        }
      });
      data.total_free_spin = totalFreeSpin.toFixed(3).replace(".", ",");

      /* Nilai SCATTER diambil HANYA dari container round yang sedang aktif
         (terakhir di DOM). Container round lama yang tertinggal tidak boleh
         ikut terhitung — dulu semua container dibaca lalu di-push tanpa reset,
         sehingga payouts bisa menumpuk (mis. ["4","3"]) dan payoutDetail[0]
         jadi salah (bug "scatter tertera 3 tapi data tertulis 4"). Sekarang
         data.payouts di-reset setiap panggilan agar tidak pernah terakumulasi. */
      function collectScatterPayouts() {
        data.payouts = [];
        const containers = Array.from(document.querySelectorAll(".payout-item-container"))
          .filter(container => container.querySelector(".payout_scatter"));
        const container = containers[containers.length - 1];
        if (!container) return;
        const title = container.querySelector(".payout-item-title");
        if (!title) return;
        const text = title.innerText?.trim() || '';
        /* Ambil angka yang berdekatan dengan label SCATTER, bukan SEMUA digit
           judul — judul seperti "SCATTER 3 x 4" kalau digabung jadi "34"
           lalu ter-cap 5. */
        const m = text.match(/scatter\s*[×x*]?\s*(\d+)/i) || text.match(/(\d+)\s*scatter/i);
        const digits = m ? m[1] : ((text.match(/\d+/) || [])[0] || '');
        const val = parseInt(digits, 10);
        if (!isNaN(val) && val >= 3) {
          data.payouts.push(String(val > 5 ? 5 : val));
        }
      }
      async function collectPayout() {
        const roundTitle = document.querySelector(".result-detail-item.round-title");
        if (!roundTitle) {
          await waitFor(".payout-item-title");
          collectScatterPayouts();
          return;
        }
        const match = roundTitle.innerText.trim().match(/Round\s+\d+\/(\d+)/i);
        const totalRounds = match ? parseInt(match[1], 10) : 1;
        if (totalRounds > 1) {
          /* Navigasi ke round terakhir: tombol next di-query ULANG tiap iterasi
             (referensi lama jadi detached setelah re-render) dan setiap klik
             MENUNGGU render selesai via waitForRoundChange (judul round pasti
             berubah antar round) — bukan sleep 100ms yang bisa berhenti di
             round yang salah. */
          for (let i = 1; i < totalRounds; i++) {
            const nextBtn = document.querySelector(".detail-navigation.right");
            if (!nextBtn || nextBtn.offsetParent === null) break;
            const roundEl = document.querySelector(".result-detail-item.round-title");
            const lastTitle = [...document.querySelectorAll(".payout-item-title")].pop()?.innerText?.trim() || '';
            const prevSnapshot = (roundEl?.innerText?.trim() || '') + '||' + lastTitle;
            const stopDefault = (e) => e.preventDefault();
            nextBtn.addEventListener("click", stopDefault, true);
            nextBtn.dispatchEvent(new MouseEvent("click", {
              bubbles: true,
              cancelable: true
            }));
            nextBtn.removeEventListener("click", stopDefault, true);
            await waitForRoundChange(prevSnapshot, 1500);
          }
          await new Promise(r => setTimeout(r, 200));
        }
        await waitFor(".payout-item-title");
        collectScatterPayouts();
      }
      await collectPayout();
      const hasData = data.transaction || data.bet || data.profit || data.symbols.length || data.payouts.length || data.free_spins.length;
      if (hasData) {
        console.log("DATA DIAMBIL:", data);
        try { chrome.runtime.sendMessage({
          type: "SEND_TO_SHEET",
          payload: data
        }); } catch(e) {}
      } else {
        console.log("Tidak ada data untuk dikirim.");
      }
    } catch (e) {
      const msg = String(e);
      if (msg.includes('Timeout')) {
        const kode = getKodeTiketFromUrl();
        if (kode) {
          chrome.runtime.sendMessage({
            type: "BET_ERROR",
            kodeTiket: kode,
            error: 'Session Timeout'
          });
        }
      }
    }
  }
  runWhenReady();
})();