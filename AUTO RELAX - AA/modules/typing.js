import { $, getData, setData } from './shared.js';

const WORDS = [
  'memberikan', 'dari', 'tetapi', 'ini', 'datang', 'kamu', 'baik', 'bagi', 'kepala', 'sering',
  'kurang', 'pada', 'lagi', 'ke', 'tanpa', 'di', 'juta', 'sampai', 'mana', 'biasa',
  'sini', 'ketika', 'sehingga', 'pusat', 'setiap', 'waktu', 'cepat', 'bila', 'yang', 'terlalu',
  'akan', 'dengan', 'salah', 'malam', 'pula', 'tiba', 'nama', 'untuk', 'sekalipun', 'sama',
  'sedikit', 'kecil', 'sebuah', 'dan', 'secara', 'karena', 'menurut', 'lalu', 'jalan', 'sambil',
  'luar', 'melalui', 'telah', 'namun', 'yaitu', 'aku', 'sebelum', 'harus', 'selalu', 'sesuai',
  'kalau', 'mau', 'kerja', 'terjadi', 'sedang', 'air', 'sesuatu', 'uang', 'pertama', 'suatu',
  'makin', 'bisa', 'sekitar', 'sementara', 'perlu', 'dapat', 'makan', 'besar', 'sudah', 'pulang',
  'jumlah', 'ada', 'tengah', 'siap', 'boleh', 'sekarang', 'benar', 'kami', 'oleh',
  'seperti', 'kemudian', 'kembali', 'mengatakan', 'jangan', 'ku', 'jelas', 'baru', 'hari', 'anak',
  'bahwa', 'apa', 'tentang', 'masalah', 'sendiri', 'termasuk', 'kali', 'hidup', 'mudah', 'nanti',
  'tak', 'jauh', 'setelah', 'naik', 'seluruh', 'itu', 'tidak', 'tapi', 'memberi', 'ia',
  'tahu', 'tinggi', 'sekali', 'kini', 'bukan', 'mulai', 'sebab', 'menjadi', 'terhadap', 'juga',
  'orang', 'dia', 'harga', 'mungkin', 'bahkan', 'akibat', 'barang', 'kepada', 'mencari', 'kecuali',
  'punya', 'mereka', 'jadi', 'terus', 'maupun', 'diri', 'membuat', 'anda', 'paling', 'bagus',
  'bersama', 'cukup', 'saat', 'tersebut', 'melakukan', 'masuk', 'cara', 'semua', 'memang', 'segera',
  'serta', 'khusus', 'belum', 'mampu', 'siapa', 'selama',
];

let wordList = [];
let wordIndex = 0;
let startTime = null;
let timerInterval = null;
let isActive = false;
let timerStarted = false;
let correctWords = 0;
let wrongWords = 0;
let correctChars = 0;
let totalTyped = 0;

export function initTyping() {
  const textEl = $('#typing-text');
  const input = $('#typing-input');
  if (!textEl || !input) return;

  input.addEventListener('input', () => handleInput(textEl, input));

  const typingPane = document.getElementById('pane-typing');
  if (typingPane) {
    const observer = new MutationObserver(() => {
      if (typingPane.classList.contains('active') && !isActive && !wordList.length) {
        startTest(textEl, input);
      }
    });
    observer.observe(typingPane, { attributes: true, attributeFilter: ['class'] });
  }

  const refreshBtn = $('#typing-refresh-btn');
  if (refreshBtn) refreshBtn.addEventListener('click', () => startTest(textEl, input));

  loadRankings();
}

function getRandomWords(count) {
  const shuffled = [...WORDS].sort(() => Math.random() - 0.5);
  const result = [];
  for (let i = 0; i < count; i++) {
    result.push(shuffled[i % shuffled.length]);
  }
  return result;
}

export function autoStartTyping() {
  const textEl = $('#typing-text');
  const input = $('#typing-input');
  if (textEl && input && !isActive && !wordList.length) {
    startTest(textEl, input);
  }
}

function startTest(textEl, input) {
  resetTest(textEl, input);
  wordList = getRandomWords(400);
  wordIndex = 0;
  renderWords(textEl);
  input.disabled = false;
  input.focus();
  isActive = true;
  timerStarted = false;
  correctWords = 0;
  wrongWords = 0;
  correctChars = 0;
  totalTyped = 0;
  $('#typing-status').textContent = 'Mulai mengetik...';
  $('#typing-results').style.display = 'none';
  updateStats();
}

function resetTest(textEl, input) {
  if (timerInterval) clearInterval(timerInterval);
  timerInterval = null;
  startTime = null;
  isActive = false;
  timerStarted = false;
  input.value = '';
  input.disabled = true;
  wordList = [];
  wordIndex = 0;
  if (textEl) textEl.innerHTML = '';
  $('#typing-wpm').textContent = '0 WPM';
  $('#typing-accuracy').textContent = '100%';
  $('#typing-time').textContent = '01:00';
  $('#typing-status').textContent = '';
  $('#typing-results').style.display = 'none';
}

function renderWords(textEl) {
  textEl.innerHTML = wordList.map((w, wi) => {
    const chars = w.split('').map((ch, ci) =>
      `<span id="tc-${wi}-${ci}" style="color:#e2e8f0;">${ch}</span>`
    ).join('');
    return `<span id="tw-${wi}" style="white-space:nowrap;">${chars}</span>`;
  }).join(' ');
}

function scrollToCurrentWord(textEl) {
  const el = document.getElementById(`tw-${wordIndex}`);
  if (el && textEl) {
    const lineH = 60;
    const line = Math.floor(el.offsetTop / lineH);
    textEl.scrollTop = Math.max(0, (line - 1) * lineH);
  }
}

function handleInput(textEl, input) {
  if (!isActive) return;

  if (!timerStarted && input.value.length === 1) {
    timerStarted = true;
    startTime = Date.now();
    timerInterval = setInterval(() => tick(), 100);
    $('#typing-status').textContent = 'Mengetik...';
  }

  const raw = input.value;
  if (raw.endsWith(' ')) {
    const typedWord = raw.trim();
    if (typedWord && wordIndex < wordList.length) {
      const expected = wordList[wordIndex];
      let wordCorrect = 0;
      for (let i = 0; i < Math.min(typedWord.length, expected.length); i++) {
        if (typedWord[i] === expected[i]) wordCorrect++;
      }
      correctChars += wordCorrect;
      totalTyped += typedWord.length;
      if (typedWord === expected) correctWords++;
      else wrongWords++;
      for (let i = 0; i < expected.length; i++) {
        const span = document.getElementById(`tc-${wordIndex}-${i}`);
        if (!span) continue;
        if (i < typedWord.length) {
          span.style.color = typedWord[i] === expected[i] ? '#86efac' : '#f87171';
        } else {
          span.style.color = '#f87171';
        }
      }
      wordIndex++;
      input.value = '';
      scrollToCurrentWord(textEl);
    } else {
      input.value = '';
    }
    updateStats();
    return;
  }

  if (wordIndex < wordList.length) {
    const expected = wordList[wordIndex];
    for (let i = 0; i < expected.length; i++) {
      const span = document.getElementById(`tc-${wordIndex}-${i}`);
      if (!span) continue;
      if (i < raw.length) {
        span.style.color = raw[i] === expected[i] ? '#86efac' : '#f87171';
      } else {
        span.style.color = '#e2e8f0';
      }
    }
  }
}

function tick() {
  if (!startTime) return;
  const elapsed = Math.floor((Date.now() - startTime) / 1000);
  const remaining = 60 - elapsed;
  if (remaining <= 0) {
    finishTest($('#typing-text'), $('#typing-input'));
    return;
  }
  const m = String(Math.floor(remaining / 60)).padStart(2, '0');
  const s = String(remaining % 60).padStart(2, '0');
  $('#typing-time').textContent = `${m}:${s}`;
  updateStats();
}

function updateStats() {
  const elapsed = startTime ? (Date.now() - startTime) / 1000 / 60 : 0;
  const inputEl = $('#typing-input');
  const raw = inputEl && !inputEl.disabled ? inputEl.value : '';

  let currentCorrect = 0;
  let currentTyped = 0;
  if (wordIndex < wordList.length && raw.length > 0) {
    const expected = wordList[wordIndex];
    for (let i = 0; i < Math.min(raw.length, expected.length); i++) {
      if (raw[i] === expected[i]) currentCorrect++;
    }
    currentTyped = raw.length;
  }

  const totalCorrect = correctChars + currentCorrect;
  const totalAll = totalTyped + currentTyped;
  // Gross WPM (semua karakter) — standar typing test, error tidak pengaruh live display
  const grossWpm = elapsed > 0 ? Math.round((totalAll / 5) / elapsed) : 0;
  const accuracy = totalAll > 0 ? Math.round((totalCorrect / totalAll) * 100) : 100;
  $('#typing-wpm').textContent = `${grossWpm} WPM`;
  $('#typing-accuracy').textContent = `${accuracy}%`;
}

async function finishTest(textEl, input) {
  isActive = false;
  if (timerInterval) clearInterval(timerInterval);

  const elapsed = startTime ? Math.min((Date.now() - startTime) / 1000, 60) : 60;
  const elapsedMin = elapsed / 60;
  const grossWpm = elapsedMin > 0 ? Math.round((totalTyped / 5) / elapsedMin) : 0;
  const netWpm = elapsedMin > 0 ? Math.round((correctChars / 5) / elapsedMin) : 0;
  const accuracy = totalTyped > 0 ? Math.round((correctChars / totalTyped) * 100) : 100;
  $('#typing-time').textContent = '00:00';

  input.disabled = true;

  // Final score: Net WPM (akurasi sudah diperhitungkan)
  $('#result-wpm').textContent = netWpm;
  var grossEl = $('#result-gross-wpm');
  if (grossEl) grossEl.textContent = grossWpm;
  $('#result-accuracy').textContent = `${accuracy}%`;
  $('#result-time').textContent = `00:00`;
  $('#result-correct').textContent = correctWords;
  $('#result-wrong').textContent = wrongWords;
  $('#typing-results').style.display = 'block';
  $('#typing-status').textContent = 'Selesai! Klik refresh untuk coba lagi';
  $('#typing-wpm').textContent = `${netWpm} WPM`;
  $('#typing-accuracy').textContent = `${accuracy}%`;

  await saveRanking(netWpm, accuracy, correctWords, wrongWords);
  await loadRankings();
}

async function saveRanking(wpm, accuracy, correct, wrong) {
  try {
    const { userEmail } = await getData('userEmail');
    if (!userEmail) return;

    const { typingRankings = [] } = await getData('typingRankings');
    const prevBest = typingRankings.length ? typingRankings[0] : null;
    typingRankings.push({
      email: userEmail,
      wpm,
      accuracy,
      correct,
      wrong,
      createdAt: Date.now()
    });
    typingRankings.sort((a, b) => b.wpm - a.wpm || b.accuracy - a.accuracy);
    await setData({ typingRankings: typingRankings.slice(0, 100) });

    try {
      const { SUPABASE_URL, SUPABASE_ANON_KEY } = await import('../config.js');
      if (SUPABASE_URL && SUPABASE_ANON_KEY) {
        if (!prevBest || wpm > prevBest.wpm || (wpm === prevBest.wpm && accuracy > prevBest.accuracy)) {
          await fetch(SUPABASE_URL + '/rest/v1/typing_rankings', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              apikey: SUPABASE_ANON_KEY,
              Authorization: 'Bearer ' + SUPABASE_ANON_KEY,
              Prefer: 'resolution=merge-duplicates'
            },
            body: JSON.stringify({
              email: userEmail,
              wpm,
              accuracy,
              correct,
              wrong,
              created_at: new Date().toISOString()
            })
          });
        }
      }
    } catch (e) { console.error('Supabase POST ranking gagal:', e); }
  } catch (e) {
    console.error('saveRanking error:', e);
  }
}

async function loadRankings() {
  const container = $('#typing-rankings-body');
  if (!container) return;

  try {
    const { userEmail } = await getData('userEmail');
    const { typingRankings = [] } = await getData('typingRankings');

    const localMap = new Map();
    for (const r of typingRankings) {
      const prev = localMap.get(r.email);
      if (!prev || r.wpm > prev.wpm || (r.wpm === prev.wpm && r.accuracy > prev.accuracy)) {
        localMap.set(r.email, r);
      }
    }

    const { SUPABASE_URL, SUPABASE_ANON_KEY } = await import('../config.js');
    let allRankings = [];

    if (SUPABASE_URL && SUPABASE_ANON_KEY) {
      try {
        const res = await fetch(SUPABASE_URL + '/rest/v1/typing_rankings?select=*&order=wpm.desc&limit=200', {
          headers: {
            apikey: SUPABASE_ANON_KEY,
            Authorization: 'Bearer ' + SUPABASE_ANON_KEY
          }
        });
        const remote = await res.json();
        if (Array.isArray(remote) && remote.length) {
          const mergedMap = new Map();
          for (const r of remote) {
            const prev = mergedMap.get(r.email);
            if (!prev || r.wpm > prev.wpm || (r.wpm === prev.wpm && r.accuracy > prev.accuracy)) {
              mergedMap.set(r.email, { email: r.email, wpm: r.wpm, accuracy: r.accuracy, correct: r.correct, wrong: r.wrong });
            }
          }
          for (const [email, r] of localMap) {
            const prev = mergedMap.get(email);
            if (!prev || r.wpm > prev.wpm || (r.wpm === prev.wpm && r.accuracy > prev.accuracy)) {
              mergedMap.set(email, r);
            }
          }
          allRankings = Array.from(mergedMap.values()).sort((a, b) => b.wpm - a.wpm || b.accuracy - a.accuracy);
        }
      } catch (e) { console.error('Supabase GET ranking gagal:', e); }
    }

    if (!allRankings.length) {
      allRankings = Array.from(localMap.values()).sort((a, b) => b.wpm - a.wpm || b.accuracy - a.accuracy);
    }

    if (!allRankings.length) {
      container.innerHTML = '<tr><td colspan="6" style="text-align:center;color:#6b7280;padding:16px;">Belum ada ranking</td></tr>';
      return;
    }

    container.innerHTML = allRankings.slice(0, 20).map((r, i) => {
      const isMe = r.email === userEmail;
      const badge = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}`;
      return `<tr${isMe ? ' style="background:rgba(99,102,241,0.1);"' : ''}>
        <td style="padding:6px 10px;text-align:center;font-weight:700;color:#d1d5db;">${badge}</td>
        <td style="padding:6px 10px;color:${isMe ? '#818cf8' : '#d1d5db'};font-weight:${isMe ? '700' : '400'};">${r.email}</td>
        <td style="padding:6px 10px;color:#86efac;font-weight:700;">${r.wpm}</td>
        <td style="padding:6px 10px;color:#fbbf24;">${r.accuracy}%</td>
        <td style="padding:6px 10px;color:#94a3b8;">${r.correct}</td>
        <td style="padding:6px 10px;color:#94a3b8;">${r.wrong}</td>
      </tr>`;
    }).join('');
  } catch (e) {
    console.error('loadRankings error:', e);
  }
}
