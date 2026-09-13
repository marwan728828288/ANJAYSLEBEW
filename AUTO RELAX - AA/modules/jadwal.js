export function initJadwal() {
  if (document.getElementById('pj-grid').children.length > 0) return;

  var NAMA_HARI = ["Minggu","Senin","Selasa","Rabu","Kamis","Jumat","Sabtu"];
  var NAMA_BULAN = ["Januari","Februari","Maret","April","Mei","Juni","Juli","Agustus","September","Oktober","November","Desember"];

  var LOGO_MAP = {
    'HOKIDRAW': 'https://cdn.areabermain.club/assets/cdn/az4/2024/12/25/20241225/1de5162dbfea7a85f41b654a2c3a4d07/logo-1.png',
    'TOTO MACAU': 'https://cdn.areabermain.club/assets/cdn/az4/2025/08/18/20250818/033094b5e73f842fcbcc3b235c029e7c/macau-logo.png',
    'KENTUCKY': 'https://cdn.areabermain.club/assets/cdn/az4/2025/08/18/20250818/ae8e720c8b7d930856cf3f364cc10158/kentucky-eve.png',
    'FLORIDA': 'https://cdn.areabermain.club/assets/cdn/az4/2025/08/18/20250818/801479ca02e15020fac8df0024814152/florida-eve-new-2.png',
    'HUAHIN': 'https://huahinlottery.com/assets/img/logo.png',
    'BANGKOK': 'https://bangkokpoolstoday.com/assets/img/bangkokpools_logo.png',
    'NEWYORK': 'https://cdn.areabermain.club/assets/cdn/az4/2025/08/18/20250818/1f9a654060201e07442bc78def1bc135/new-york-eve.png',
    'CAROLINA': 'https://cdn.areabermain.club/assets/cdn/az4/2025/08/18/20250818/816329e82e136b1e9faad6d14c8c81bc/carolina-day-pools-jpg.png',
    'BRUNEI': 'https://bruneipools.com/assets/img/brunei-logo.png',
    'OREGON': 'https://cdn.areabermain.club/assets/cdn/az4/2025/08/18/20250818/7715823646164db9d67d280a402dfb51/oregon-jpg.png',
    'CALIFORNIA': 'https://cdn.areabermain.club/assets/cdn/az4/2025/08/18/20250818/c89c3a35f7323e90e2e2c5c255bdb7ae/california-pools-jpg.png',
    'TOTOCAMBODIA': 'https://totocambodialive.com/assets/img/logo.png',
    'CHELSEA': 'https://chelseapools.co.uk/assets/img/chelseaPools_logo.png',
    'POIPET': 'https://poipetlottery.com/img/logo.png',
    'BULLSEYE': 'https://cdn.areabermain.club/assets/cdn/az4/2024/08/11/20240811/f07d4e2a6517ef1cea9e2a897e4abb98/nz-bullseye.png',
    'SYDNEY': 'https://cdn.areabermain.club/assets/cdn/az4/2025/08/18/20250818/1d9ba1f974240b7b5c5e48fa2ef98e0e/sydney-2.png',
    'TOTOMALI': 'https://totomali.com/assets/img/logo.svg',
    'KING KONG4D': 'https://cdn.areabermain.club/assets/cdn/az4/2025/08/18/20250818/32f87d6c932b0d2eee9b6e1c9028ab41/logo-2.png',
    'SINGAPORE': 'https://cdn.areabermain.club/assets/cdn/az4/2025/08/18/20250818/ae20d56fcb2d0dea6b0ae637c6bed566/singapore-new.png',
    'MAGNUM4D': 'https://cdn.areabermain.club/assets/cdn/az4/2024/08/11/20240811/8889f1c5fc738b5148145100c08a0ebc/439-4390693-magnum-pengeluaran-magnum-4d-hari-clipart-removebg-preview.png',
    'PCSO': 'https://cdn.areabermain.club/assets/cdn/az4/2025/08/18/20250818/a67d9fd134f7211cbe08bd89bd64f79d/pcso-2.png',
    'NEVADA': 'https://www.nevadalottery.us/images/logo.gif',
    'HONGKONG': 'https://cdn.animaapp.com/projects/66be29ddeca4d2e95aa7b4ce/releases/66be3e204d8f7eb28bb5de15/img/hongkong-lotto-1.png'
  };

  function getLogo(title) {
    var norm = title.replace(/\s+/g, '');
    for (var key in LOGO_MAP) {
      var normKey = key.replace(/\s+/g, '');
      if (norm.indexOf(normKey) === 0) return LOGO_MAP[key];
    }
    return null;
  }

  var pasaran = [
    { title:"HOKIDRAW", hari:"Senin s/d Minggu", tutup:"RESULT 24X", buka:"1 JAM SEKALI", website:"https://hokidraw.com/", live:"https://dlive.tv/u/HOKIDRAW" },
    { title:"TOTO MACAU PAGI", hari:"Senin s/d Minggu", tutup:"00:00 WIB", buka:"00:15 WIB", website:"https://totomacaunew.us/", live:"https://kick.com/live-ttm4d" },
    { title:"KENTUCKY MIDDAY", hari:"Senin s/d Minggu", tutup:"00:05 WIB", buka:"00:20 WIB", website:"https://www.kylottery.com/apps/", live:null },
    { title:"FLORIDA MIDDAY", hari:"Senin s/d Minggu", tutup:"00:20 WIB", buka:"00:30 WIB", website:"https://floridalottery.com/", live:"https://www.youtube.com/user/floridalottery" },
    { title:"HUAHIN 0100", hari:"Senin s/d Minggu", tutup:"00:45 WIB", buka:"01:00 WIB", website:"https://huahinlottery.com/", live:"https://www.youtube.com/@huahinlottery5727" },
    { title:"BANGKOK 0130", hari:"Senin s/d Minggu", tutup:"01:15 WIB", buka:"01:30 WIB", website:"https://bangkokpoolstoday.com/", live:null },
    { title:"NEWYORK MIDDAY", hari:"Senin s/d Minggu", tutup:"01:15 WIB", buka:"01:25 WIB", website:"https://nylottery.ny.gov/", live:"https://www.youtube.com/@NewYorkLottery/streams" },
    { title:"CAROLINA DAY", hari:"Senin s/d Minggu", tutup:"01:45 WIB", buka:"02:00 WIB", website:"https://www.wral.com/entertainment/lottery/", live:null },
    { title:"BRUNEI 02", hari:"Senin s/d Minggu", tutup:"02:30 WIB", buka:"02:45 WIB", website:"https://bruneipools.com/", live:null },
    { title:"OREGON 03", hari:"Senin s/d Minggu", tutup:"02:50 WIB", buka:"03:00 WIB", website:"https://www.oregonlottery.org/pick-4/winning-numbers/", live:null },
    { title:"OREGON 06", hari:"Senin s/d Minggu", tutup:"05:50 WIB", buka:"06:00 WIB", website:"https://www.oregonlottery.org/pick-4/winning-numbers/", live:null },
    { title:"CALIFORNIA", hari:"Senin s/d Minggu", tutup:"08:25 WIB", buka:"08:30 WIB", website:"https://www.calottery.com/draw-games/daily-4", live:null },
    { title:"FLORIDA EVENING", hari:"Senin s/d Minggu", tutup:"08:35 WIB", buka:"08:45 WIB", website:"https://floridalottery.com/games/draw-games/pick-4", live:"https://www.youtube.com/user/floridalottery" },
    { title:"OREGON 09", hari:"Senin s/d Minggu", tutup:"08:50 WIB", buka:"09:00 WIB", website:"https://www.oregonlottery.org/pick-4/winning-numbers/", live:null },
    { title:"BANGKOK 0930", hari:"Senin s/d Minggu", tutup:"09:15 WIB", buka:"09:30 WIB", website:"https://bangkokpoolstoday.com/", live:null },
    { title:"NEWYORK EVENING", hari:"Senin s/d Minggu", tutup:"09:25 WIB", buka:"09:35 WIB", website:"https://nylottery.ny.gov/", live:"https://www.youtube.com/@NewYorkLottery/streams" },
    { title:"KENTUCKY EVENING", hari:"Senin s/d Minggu", tutup:"09:45 WIB", buka:"10:00 WIB", website:"https://www.kylottery.com/apps/", live:null },
    { title:"CAROLINA EVENING", hari:"Senin s/d Minggu", tutup:"10:17 WIB", buka:"10:22 WIB", website:"https://www.wral.com/entertainment/lottery/", live:null },
    { title:"TOTOCAMBODIA", hari:"Senin s/d Minggu", tutup:"10:45 WIB", buka:"11:00 WIB", website:"https://totocambodialive.com/", live:"https://kick.com/totocambodia" },
    { title:"CHELSEA 11", hari:"Senin s/d Minggu", tutup:"11:00 WIB", buka:"11:15 WIB", website:"https://chelseapools.co.uk/", live:null },
    { title:"OREGON 12", hari:"Senin s/d Minggu", tutup:"11:50 WIB", buka:"12:00 WIB", website:"https://www.oregonlottery.org/pick-4/winning-numbers/", live:null },
    { title:"POIPET12", hari:"Senin s/d Minggu", tutup:"12:15 WIB", buka:"12:30 WIB", website:"https://poipetlottery.com/", live:"https://dlive.tv/PoipetPools" },
    { title:"BULLSEYE", hari:"Senin s/d Minggu", tutup:"13:00 WIB", buka:"13:15 WIB", website:"https://mylotto.co.nz/results/bullseye", live:null },
    { title:"TOTOMACAU SIANG", hari:"Senin s/d Minggu", tutup:"13:00 WIB", buka:"13:15 WIB", website:"https://totomacaunew.us/", live:"https://kick.com/live-ttm4d" },
    { title:"SYDNEY", hari:"Senin s/d Minggu", tutup:"13:49 WIB", buka:"14:05 WIB", website:"https://sydneyfunlotto.net/", live:"https://kick.com/sydney-lotto-official" },
    { title:"BRUNEI 14", hari:"Senin s/d Minggu", tutup:"14:30 WIB", buka:"14:45 WIB", website:"https://bruneipools.com/", live:null },
    { title:"CHELSEA 15", hari:"Senin s/d Minggu", tutup:"15:00 WIB", buka:"15:15 WIB", website:"https://chelseapools.co.uk/", live:null },
    { title:"TOTOMALI 1530", hari:"Senin s/d Minggu", tutup:"15:15 WIB", buka:"15:30 WIB", website:"https://totomali.com/", live:"https://www.youtube.com/@TotoMaliLive" },
    { title:"POIPET15", hari:"Senin s/d Minggu", tutup:"15:15 WIB", buka:"15:30 WIB", website:"https://poipetlottery.com/", live:"https://dlive.tv/PoipetPools" },
    { title:"TOTOMACAU SORE", hari:"Senin s/d Minggu", tutup:"16:00 WIB", buka:"16:15 WIB", website:"https://totomacaunew.us/", live:"https://kick.com/live-ttm4d" },
    { title:"HUAHIN 1630", hari:"Senin s/d Minggu", tutup:"16:15 WIB", buka:"16:30 WIB", website:"https://huahinlottery.com/", live:"https://www.youtube.com/@huahinlottery5727" },
    { title:"KING KONG4D I", hari:"Senin s/d Minggu", tutup:"17:00 WIB", buka:"17:15 WIB", website:"https://kingkongpools.id/", live:"https://kick.com/king-kong-pools" },
    { title:"SINGAPORE", hari:"HARI SELASA & JUM'AT (LIBUR)", tutup:"17:30 WIB", buka:"17:45 WIB", website:"https://www.singaporepools.com.sg/landing/en/Pages/index.html", live:null },
    { title:"MAGNUM4D", hari:"HARI RABU, SABTU & MINGGU", tutup:"18:10 WIB", buka:"18:40 WIB", website:"https://www.magnum4d.my/en", live:null },
    { title:"TOTOMACAU MALAM I", hari:"Senin s/d Minggu", tutup:"19:00 WIB", buka:"19:15 WIB", website:"https://totomacaunew.us/", live:"https://kick.com/live-ttm4d" },
    { title:"CHELSEA 19", hari:"Senin s/d Minggu", tutup:"19:00 WIB", buka:"19:15 WIB", website:"https://chelseapools.co.uk/", live:null },
    { title:"POIPET19", hari:"Senin s/d Minggu", tutup:"19:30 WIB", buka:"19:45 WIB", website:"https://poipetlottery.com/", live:"https://dlive.tv/PoipetPools" },
    { title:"PCSO", hari:"Minggu Libur", tutup:"19:50 WIB", buka:"20:10 WIB", website:"https://www.pcso.gov.ph/", live:"https://www.youtube.com/@PCSOGOVPHOfficial/streams" },
    { title:"TOTOMALI 2030", hari:"Selasa s/d Minggu", tutup:"20:15 WIB", buka:"20:30 WIB", website:"https://totomali.com/", live:"https://www.youtube.com/@TotoMaliLive" },
    { title:"HUAHIN 2100", hari:"Selasa s/d Minggu", tutup:"20:45 WIB", buka:"21:00 WIB", website:"https://huahinlottery.com/", live:"https://www.youtube.com/@huahinlottery5727" },
    { title:"CHELSEA 21", hari:"Senin s/d Minggu", tutup:"21:00 WIB", buka:"21:15 WIB", website:"https://chelseapools.co.uk/", live:null },
    { title:"NEVADA", hari:"Senin s/d Minggu", tutup:"21:15 WIB", buka:"21:30 WIB", website:"https://www.nevadalottery.us/", live:null },
    { title:"BRUNEI 21", hari:"Senin s/d Minggu", tutup:"21:30 WIB", buka:"21:45 WIB", website:"https://bruneipools.com/", live:null },
    { title:"TOTOMACAU MALAM II", hari:"Senin s/d Minggu", tutup:"22:00 WIB", buka:"22:15 WIB", website:"https://totomacaunew.us/", live:"https://kick.com/live-ttm4d" },
    { title:"POIPET22", hari:"Senin s/d Minggu", tutup:"22:30 WIB", buka:"22:45 WIB", website:"https://poipetlottery.com/", live:"https://dlive.tv/PoipetPools" },
    { title:"HONGKONG", hari:"Senin s/d Minggu", tutup:"22:59 WIB", buka:"23:15 WIB", website:"https://hongkongfunlotto.net/", live:"https://kick.com/hongkong-lotto-official" },
    { title:"TOTOMACAU MALAM III", hari:"Senin s/d Minggu", tutup:"23:00 WIB", buka:"23:15 WIB", website:"https://totomacaunew.us/", live:"https://kick.com/live-ttm4d" },
    { title:"TOTOMALI 2330", hari:"Senin s/d Minggu", tutup:"23:15 WIB", buka:"23:30 WIB", website:"https://totomali.com/", live:"https://www.youtube.com/@TotoMaliLive" },
    { title:"KING KONG4D II", hari:"Senin s/d Sabtu", tutup:"23:30 WIB", buka:"23:45 WIB", website:"https://kingkongpools.id/", live:"https://kick.com/king-kong-pools" }
  ];

  function generateCards() {
    var container = document.getElementById('pj-grid');
    container.innerHTML = '';
    pasaran.forEach(function (p) {
      var card = document.createElement('div');
      card.className = 'pj-card';
      card.dataset.title = p.title.toLowerCase();
      var linksHTML = '<a href="' + p.website + '" target="_blank" rel="noopener"><i class="fas fa-external-link-alt"></i> Kunjungi Website</a>';
      if (p.live) linksHTML += '<a href="' + p.live + '" target="_blank" rel="noopener"><i class="fas fa-video"></i> Kunjungi Live</a>';
      var logoUrl = getLogo(p.title);
      var logoHtml = logoUrl ? '<div style="text-align:center;padding:12px 18px 4px;background:rgba(8,11,20,0.4);border-bottom:1px solid var(--border-accent);"><img src="' + logoUrl + '" alt="' + p.title + '" style="max-width:140px;max-height:40px;object-fit:contain;display:block;margin:0 auto;filter:drop-shadow(0 0 6px rgba(129,140,248,0.3));" class="pj-logo"></div>' : '';
      card.innerHTML =
        logoHtml +
        '<div class="pj-card-title">' + p.title + '</div>' +
        '<div class="pj-card-row"><span class="pj-label"><i class="far fa-calendar"></i> Hari</span><span class="pj-value">' + p.hari + '</span></div>' +
        '<div class="pj-card-row"><span class="pj-label"><i class="far fa-clock"></i> Tutup</span><span class="pj-value pj-tutup">' + p.tutup + '</span></div>' +
        '<div class="pj-card-row"><span class="pj-label"><i class="far fa-clock"></i> Buka</span><span class="pj-value pj-buka">' + p.buka + '</span></div>' +
        '<div class="pj-card-row"><span class="pj-label"><i class="fas fa-signal"></i> Status</span><span class="pj-value pj-status">OPEN</span></div>' +
        '<div class="pj-card-row"><span class="pj-label"><i class="far fa-hourglass"></i> Tutup Dalam</span><span class="pj-value pj-countdown">00:00:00</span></div>' +
        '<div class="pj-progress"><div class="pj-progress-bar"></div></div>' +
        '<div class="pj-links">' + linksHTML + '</div>';
      container.appendChild(card);
    });
  }

  function updateCards() {
    var cards = document.querySelectorAll('#pane-jadwal .pj-card');
    var now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Jakarta' }));
    cards.forEach(function (card) {
      var statusEl = card.querySelector('.pj-status');
      var cdEl = card.querySelector('.pj-countdown');
      var barEl = card.querySelector('.pj-progress-bar');
      var tutupText = card.querySelector('.pj-tutup').textContent;
      var targetHour, targetMinute;
      if (tutupText.indexOf(':') > -1) {
        var m = tutupText.match(/(\d{1,2}):(\d{1,2})/);
        if (m) { targetHour = parseInt(m[1]); targetMinute = parseInt(m[2]); }
      }
      if (targetHour === undefined) { targetHour = (now.getHours()+1)%24; targetMinute = 0; }
      var tutupTime = new Date(now);
      tutupTime.setHours(targetHour, targetMinute, 0, 0);
      if (tutupTime < now) tutupTime.setDate(tutupTime.getDate()+1);
      var diff = tutupTime - now;
      var totalDay = 24*60*60*1000;
      var passed = totalDay - diff;
      var status = 'OPEN';
      if (diff < 10*60*1000) status = 'LIVE';
      if (diff < 2*60*1000) status = 'CLOSED';
      statusEl.textContent = status;
      statusEl.className = 'pj-value pj-status ' + status;
      var h = Math.floor(diff/(1000*60*60));
      var m = Math.floor((diff%(1000*60*60))/(1000*60));
      var s = Math.floor((diff%(1000*60))/1000);
      cdEl.textContent = String(h).padStart(2,'0')+':'+String(m).padStart(2,'0')+':'+String(s).padStart(2,'0');
      var pct = (passed/totalDay)*100;
      if (pct>100) pct=100;
      barEl.style.width = pct+'%';
    });
  }

  function setupSearch() {
    var searchInput = document.getElementById('pj-search');
    var resultText = document.getElementById('pj-search-results');
    searchInput.addEventListener('input', function () {
      var val = searchInput.value.toLowerCase();
      var cards = document.querySelectorAll('#pane-jadwal .pj-card');
      var count = 0;
      cards.forEach(function (card) {
        var show = card.dataset.title.indexOf(val) > -1;
        card.style.display = show ? '' : 'none';
        if (show) count++;
      });
      resultText.textContent = val ? 'Ditemukan ' + count + ' pasaran' : '';
      var noResults = document.querySelector('#pane-jadwal .pj-noresults');
      if (count === 0 && val) {
        if (!noResults) {
          var el = document.createElement('div');
          el.className = 'pj-noresults';
          el.innerHTML = '<i class="fas fa-search"></i><br>Tidak ditemukan pasaran dengan kata kunci "' + val + '"';
          document.getElementById('pj-grid').appendChild(el);
        }
      } else if (noResults) { noResults.remove(); }
    });
  }

  document.getElementById('pane-jadwal').addEventListener('error', function(e) {
    if (e.target.classList && e.target.classList.contains('pj-logo')) {
      e.target.style.display = 'none';
    }
  }, true);

  generateCards();
  updateCards();
  setupSearch();
  setInterval(updateCards, 1000);
}
