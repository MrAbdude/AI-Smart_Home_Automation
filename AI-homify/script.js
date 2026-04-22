/* ══════════════════════════════════════════════════════════════
   SMART HOME CONTROL — script.js  (v3.0)
   · Multilingual voice: Hindi, Marathi, English
   · Voice + Password unlock (passphrase: "Bigg boss has big role")
   · Relay rename (display aliases)
   · Daily timer section + voice timer with "mark as daily?" prompt
   · Performance: debounced renders, optimistic UI
   ══════════════════════════════════════════════════════════════ */
'use strict';

/* ─────────────────────────────────────────────
   CONSTANTS
───────────────────────────────────────────── */
const CORRECT_PASSWORD = 'sharez_2004';
const VOICE_PASSPHRASE = 'delta start'; // normalized
const IST_TIMEZONE = 'Asia/Kolkata';
const dayNames = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

/* ─────────────────────────────────────────────
   STATE
───────────────────────────────────────────── */
let db = null;
let relays = {};   // { relayKey: boolean }  (Firebase raw)
let timers = {};   // { timerId: timerObject }
let relayAliases = {};  // { relayKey: "display name" }
let currentEditingTimerId = null;
let currentRenamingKey = null;
let currentTimerTab = 'onetime';  // 'onetime' | 'daily'

// Voice state
let recognition = null;
let voiceMode = 'command';   // 'command' | 'unlock'
let voiceIsListening = false;
let handsFreeMode = false;
let silenceTimer = null;
let audioContext = null;
let analyser = null;
let dataArray = null;
let source = null;
let animationId = null;
let pendingVoiceTimerData = null;   // holds parsed timer data, awaiting daily confirm

/* ─────────────────────────────────────────────
   PASSWORD GATE
───────────────────────────────────────────── */
function switchPwTab(tab) {
  const isPw = tab === 'password';
  document.getElementById('pwPasswordTab').style.display = isPw ? '' : 'none';
  document.getElementById('pwVoiceTab').style.display = isPw ? 'none' : '';
  document.getElementById('tabPw').classList.toggle('active', isPw);
  document.getElementById('tabVoice').classList.toggle('active', !isPw);
  if (!isPw) {
    const statusEl = document.getElementById('voiceUnlockStatus');
    const btnText = document.getElementById('voiceUnlockBtnText');
    if (statusEl) statusEl.textContent = '👆 Tap the button below to start listening';
    if (btnText) btnText.textContent = 'Tap to Listen';
  }
}

function checkPassword() {
  const val = document.getElementById('pwInput').value;
  const errEl = document.getElementById('pwError');
  if (val === CORRECT_PASSWORD) {
    unlockApp();
  } else {
    errEl.classList.remove('visible');
    void errEl.offsetWidth;
    errEl.classList.add('visible');
    document.getElementById('pwInput').value = '';
    document.getElementById('pwInput').focus();
  }
}

function togglePwEye() {
  const inp = document.getElementById('pwInput');
  const icon = document.getElementById('pwEyeIcon');
  if (inp.type === 'password') { inp.type = 'text'; icon.className = 'fas fa-eye-slash'; }
  else { inp.type = 'password'; icon.className = 'fas fa-eye'; }
}

function unlockApp() {
  const gate = document.getElementById('passwordGate');
  gate.classList.add('fade-out');
  setTimeout(() => {
    gate.style.display = 'none';
    document.getElementById('app').style.display = 'block';
    initApp();
  }, 600);
}

/* ─────────────────────────────────────────────
   VOICE UNLOCK (on password gate)
───────────────────────────────────────────── */
let voiceUnlockRecognition = null;

function startVoiceUnlock() {
  const statusEl = document.getElementById('voiceUnlockStatus');
  const errEl = document.getElementById('pwVoiceError');
  const btn = document.getElementById('voiceUnlockBtn');
  const btnText = document.getElementById('voiceUnlockBtnText');

  if (voiceUnlockRecognition) {
    try { voiceUnlockRecognition.abort(); } catch (e) { }
    voiceUnlockRecognition = null;
    btn.classList.remove('listening');
    btnText.textContent = 'Tap to Listen';
    statusEl.textContent = '👆 Tap again to retry';
    hideVoiceConfirm();
    return;
  }

  errEl.classList.remove('visible');
  hideVoiceConfirm();

  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    statusEl.textContent = '⚠ Use Chrome browser — voice not supported here.';
    return;
  }

  const r = new SR();
  voiceUnlockRecognition = r;

  r.lang = 'en-US';
  r.continuous = false;
  r.interimResults = false;
  r.maxAlternatives = 5;

  btn.classList.add('listening');
  btnText.textContent = 'Listening…';
  statusEl.textContent = '🎙 Speak now…';

  try {
    r.start();
  } catch (startErr) {
    voiceUnlockRecognition = null;
    btn.classList.remove('listening');
    btnText.textContent = 'Tap to Listen';
    statusEl.textContent = '⚠ Microphone error. Allow mic & tap again.';
    return;
  }

  r.onresult = (e) => {
    const shownTranscript = e.results[0][0].transcript.toLowerCase().trim();
    const allAlts = [];
    for (let a = 0; a < e.results[0].length; a++) {
      allAlts.push(e.results[0][a].transcript.toLowerCase().trim());
    }
    voiceUnlockRecognition = null;
    btn.classList.remove('listening');
    statusEl.textContent = `Heard: "${shownTranscript}"`;

    if (passphraseMatches(allAlts)) {
      statusEl.textContent = '✅ Recognized! Unlocking…';
      btnText.textContent = 'Unlocking…';
      setTimeout(unlockApp, 600);
    } else {
      btnText.textContent = 'Try Again';
      showVoiceConfirm(shownTranscript);
    }
  };

  r.onerror = (e) => {
    voiceUnlockRecognition = null;
    btn.classList.remove('listening');
    btnText.textContent = 'Tap to Listen';
    const msgs = {
      'no-speech': '🔇 No speech. Tap & speak clearly.',
      'audio-capture': '🎤 No microphone found.',
      'not-allowed': '🚫 Mic blocked — allow in browser settings.',
      'service-not-allowed': '🚫 Mic not allowed. Allow & reload.',
      'network': '📵 Network error. Check connection.',
      'aborted': '⏹ Stopped.',
    };
    statusEl.textContent = msgs[e.error] || `⚠ Error (${e.error}). Tap to retry.`;
  };

  r.onend = () => {
    voiceUnlockRecognition = null;
    btn.classList.remove('listening');
    if (btnText.textContent === 'Listening…') {
      btnText.textContent = 'Tap to Listen';
      statusEl.textContent = '👆 Tap to try again';
    }
  };
}

function passphraseMatches(alternatives) {
  const words = VOICE_PASSPHRASE.toLowerCase().trim().split(/\s+/);
  for (const alt of alternatives) {
    const altWords = alt.split(/\s+/);
    const allFound = words.every(pw =>
      altWords.some(tw => tw === pw || tw.includes(pw) || pw.includes(tw))
    );
    const noSpace = alt.replace(/\s+/g, '').includes(VOICE_PASSPHRASE.replace(/\s+/g, ''));
    const threshold = words.length <= 2 ? words.length : Math.ceil(words.length * 0.7);
    const matchCount = words.filter(pw =>
      altWords.some(tw => tw === pw || tw.includes(pw) || pw.includes(tw))
    ).length;
    if (allFound || noSpace || matchCount >= threshold) return true;
  }
  return false;
}

function showVoiceConfirm(transcript) {
  let box = document.getElementById('voiceUnlockConfirm');
  if (!box) {
    box = document.createElement('div');
    box.id = 'voiceUnlockConfirm';
    box.style.cssText = 'margin-top:12px;display:flex;flex-direction:column;gap:8px;';
    box.innerHTML = `
      <p style="font-size:13px;color:var(--text-secondary);">Heard: <strong id="voiceConfirmText" style="color:var(--accent-blue);"></strong></p>
      <p style="font-size:12px;color:var(--text-muted);">Is this correct? Tap Unlock.</p>
      <button class="pw-btn" onclick="manualVoiceUnlock()" style="padding:10px;">
        <span class="pw-btn-text"><i class="fas fa-unlock-keyhole"></i> Yes, Unlock</span>
        <div class="pw-btn-shine"></div>
      </button>`;
    document.getElementById('pwVoiceTab').appendChild(box);
  }
  document.getElementById('voiceConfirmText').textContent = '"' + transcript + '"';
  box.style.display = 'flex';
}

function hideVoiceConfirm() {
  const c = document.getElementById('voiceUnlockConfirm');
  if (c) c.style.display = 'none';
}

function manualVoiceUnlock() {
  hideVoiceConfirm();
  unlockApp();
}

/* ─────────────────────────────────────────────
   THEME
───────────────────────────────────────────── */
let currentTheme = localStorage.getItem('sh_theme') || 'dark';

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  const icon = document.getElementById('themeIcon');
  if (icon) icon.className = theme === 'dark' ? 'fas fa-moon' : 'fas fa-sun';
  localStorage.setItem('sh_theme', theme);
}

function toggleTheme() {
  currentTheme = currentTheme === 'dark' ? 'light' : 'dark';
  applyTheme(currentTheme);
}

applyTheme(currentTheme);

/* ─────────────────────────────────────────────
   LOADING
───────────────────────────────────────────── */
let loadingCount = 0;
function showLoading() { loadingCount++; document.getElementById('loading').classList.add('show'); }
function hideLoading() { if (--loadingCount <= 0) { loadingCount = 0; document.getElementById('loading').classList.remove('show'); } }

/* ─────────────────────────────────────────────
   CLOCK
───────────────────────────────────────────── */
function updateClocks() {
  const now = moment().tz(IST_TIMEZONE);
  const el1 = document.getElementById('currentTime');
  const el2 = document.getElementById('currentTimeChip');
  if (el1) el1.textContent = now.format('DD/MM/YYYY HH:mm:ss');
  if (el2) el2.textContent = now.format('HH:mm:ss');
}

/* ─────────────────────────────────────────────
   INIT APP
───────────────────────────────────────────── */
function initApp() {
  applyTheme(currentTheme);
  setInterval(updateClocks, 1000);
  updateClocks();

  try {
    relayAliases = JSON.parse(localStorage.getItem('relayAliases') || '{}');
  } catch (e) { relayAliases = {}; }

  ['oneTimeTimersContainer', 'dailyTimersContainer'].forEach(containerId => {
    document.addEventListener('click', e => {
      const btn = e.target.closest(`#${containerId} button[data-action]`);
      if (!btn) return;
      const id = btn.dataset.id;
      const action = btn.dataset.action;
      if (action === 'delete') deleteTimer(id);
      if (action === 'edit') editTimer(id);
    });
  });

  const saved = localStorage.getItem('firebaseConfig');
  if (saved) {
    try {
      const { apiKey, databaseURL } = JSON.parse(saved);
      document.getElementById('apiKey').value = apiKey;
      document.getElementById('databaseURL').value = databaseURL;
      initializeFirebase(apiKey, databaseURL);
    } catch (e) { /* ignore */ }
  }
}

/* ─────────────────────────────────────────────
   FIREBASE
───────────────────────────────────────────── */
function initializeFirebase(apiKey, databaseURL) {
  showLoading();
  try {
    if (firebase.apps.length > 0) firebase.apps.forEach(a => a.delete());
    firebase.initializeApp({ apiKey, databaseURL });
    db = firebase.database();

    document.getElementById('instructionsSection').style.display = 'none';
    document.getElementById('configSection').style.display = 'none';
    document.getElementById('relaysSection').style.display = 'block';
    document.getElementById('timersSection').style.display = 'block';
    document.getElementById('analyticsSection').style.display = 'block';

    loadData();
    startTimerScheduler();
    hideLoading();
  } catch (err) {
    hideLoading();
    alert('Firebase connection failed: ' + err.message);
  }
}

function handleConfigSubmit() {
  const apiKey = document.getElementById('apiKey').value.trim();
  const databaseURL = document.getElementById('databaseURL').value.trim();
  if (!apiKey || !databaseURL) { alert('Please provide both API Key and Database URL.'); return; }
  localStorage.setItem('firebaseConfig', JSON.stringify({ apiKey, databaseURL }));
  initializeFirebase(apiKey, databaseURL);
}

/* ─────────────────────────────────────────────
   LOAD DATA  (real-time listeners)
───────────────────────────────────────────── */
function loadData() {
  if (!db) return;

  db.ref('relays').on('value', snap => {
    relays = snap.val() || {};
    renderRelays();
    updateTimerFormRelays();
  });

  db.ref('timers').on('value', snap => {
    timers = snap.val() || {};
    renderTimers();
  });
}

/* ─────────────────────────────────────────────
   RELAY ALIAS HELPERS
───────────────────────────────────────────── */
function getAlias(key) {
  return relayAliases[key] || key;
}

function saveAliases() {
  localStorage.setItem('relayAliases', JSON.stringify(relayAliases));
}

/* ─────────────────────────────────────────────
   RENDER RELAYS
───────────────────────────────────────────── */
function renderRelays() {
  const container = document.getElementById('relaysContainer');
  const entries = Object.entries(relays).filter(
    ([k, v]) => k && k !== 'undefined' && k.trim() && typeof v === 'boolean'
  );

  if (entries.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <i class="fas fa-plug"></i>
        <p>No relays found in your database</p>
      </div>`;
    updateRelayCounts(0, 0);
    return;
  }

  let onCount = 0, offCount = 0;
  const frag = document.createDocumentFragment();

  entries.forEach(([relay, state]) => {
    // CORRECTED LOGIC: true = ON, false = OFF
    const physicallyOn = (state === true); 
    physicallyOn ? onCount++ : offCount++;
    const cls = physicallyOn ? 'on' : 'off';
    const icon = physicallyOn ? 'fa-toggle-on' : 'fa-toggle-off';
    const alias = getAlias(relay);

    let div = document.getElementById(`rc_${relay}`);
    let isNew = false;
    if (!div) {
      div = document.createElement('div');
      div.id = `rc_${relay}`;
      isNew = true;
    }
    div.className = `relay-card ${cls}`;

    div.innerHTML = `
      <div class="relay-card-header">
        <div class="relay-name-wrap">
          <h3><i class="fas ${icon}"></i> ${escHtml(alias)}</h3>
          <div class="relay-id">${escHtml(relay)}</div>
        </div>
        <div class="relay-header-actions">
          <button class="rename-btn" title="Rename" onclick="openRenameModal('${escAttr(relay)}')">
            <i class="fas fa-pen"></i>
          </button>
          <div class="status-dot"></div>
        </div>
      </div>

      <div class="relay-status-badge">
        <i class="fas fa-circle" style="font-size:8px"></i>
        ${physicallyOn ? 'ON' : 'OFF'}
      </div>

      <div class="big-toggle">
        <div class="toggle-track" onclick="toggleRelay('${escAttr(relay)}', ${!physicallyOn}, event)">
          <div class="toggle-knob"></div>
        </div>
      </div>

      <div class="relay-actions">
        <button class="btn btn-success" onclick="toggleRelay('${escAttr(relay)}', true, event)">
          <i class="fas fa-power-off"></i> ON
        </button>
        <button class="btn btn-danger"  onclick="toggleRelay('${escAttr(relay)}', false, event)">
          <i class="fas fa-power-off"></i> OFF
        </button>
      </div>
    `;

    if (isNew) frag.appendChild(div);
  });

  Array.from(container.children).forEach(child => {
    const key = child.id?.replace('rc_', '');
    if (!relays.hasOwnProperty(key)) child.remove();
  });

  container.appendChild(frag);
  updateRelayCounts(onCount, offCount);
}

function updateRelayCounts(on, off) {
  const onEl = document.getElementById('onCount');
  const offEl = document.getElementById('offCount');
  if (onEl) onEl.textContent = on;
  if (offEl) offEl.textContent = off;
}

/* ─────────────────────────────────────────────
   TOGGLE RELAY
───────────────────────────────────────────── */
function toggleRelay(relay, targetState, event) {
  if (!relay || relay === 'undefined' || !relay.trim()) return;

  if (event) {
    const card = document.getElementById(`rc_${relay}`);
    if (card) {
      const r = document.createElement('div');
      r.className = 'ripple-effect';
      const rect = card.getBoundingClientRect();
      r.style.left = (event.clientX - rect.left - 30) + 'px';
      r.style.top = (event.clientY - rect.top - 30) + 'px';
      card.appendChild(r);
      setTimeout(() => r.remove(), 500);
    }
  }

  // CORRECTED LOGIC: Set directly to targetState
  relays[relay] = targetState;
  renderRelays();

  db.ref(`relays/${relay}`).set(targetState)
    .then(() => { recordUsageEvent(relay, targetState); })
    .catch(err => {
      relays[relay] = !targetState; // Revert optimistic update
      renderRelays();
      alert('Error updating relay: ' + err.message);
    });
}

/* ─────────────────────────────────────────────
   RENAME RELAY
───────────────────────────────────────────── */
function openRenameModal(relay) {
  currentRenamingKey = relay;
  const inp = document.getElementById('renameInput');
  inp.value = relayAliases[relay] || '';
  document.getElementById('renameModal').classList.add('open');
  setTimeout(() => inp.focus(), 100);
}

function closeRenameModal() {
  document.getElementById('renameModal').classList.remove('open');
  currentRenamingKey = null;
}

function saveRename() {
  const name = document.getElementById('renameInput').value.trim();
  if (!currentRenamingKey) return;
  if (name) relayAliases[currentRenamingKey] = name;
  else delete relayAliases[currentRenamingKey];
  saveAliases();
  renderRelays();
  updateTimerFormRelays();
  closeRenameModal();
}

/* ─────────────────────────────────────────────
   RENDER TIMERS
───────────────────────────────────────────── */
function switchTimerTab(tab) {
  currentTimerTab = tab;
  const oneTime = document.getElementById('oneTimeTimersContainer');
  const daily = document.getElementById('dailyTimersContainer');
  document.getElementById('tabOneTime').classList.toggle('active', tab === 'onetime');
  document.getElementById('tabDaily').classList.toggle('active', tab === 'daily');
  oneTime.style.display = tab === 'onetime' ? '' : 'none';
  daily.style.display = tab === 'daily' ? '' : 'none';
}

function renderTimers() {
  const oneTimeContainer = document.getElementById('oneTimeTimersContainer');
  const dailyContainer = document.getElementById('dailyTimersContainer');
  oneTimeContainer.innerHTML = '';
  dailyContainer.innerHTML = '';

  const entries = Object.entries(timers).filter(
    ([, t]) => t && t.relay && t.relay !== 'undefined' && t.relay.trim()
  );

  if (entries.length === 0) {
    const empty = `<div class="empty-state"><i class="fas fa-clock"></i><p>No timers configured yet</p></div>`;
    oneTimeContainer.innerHTML = empty;
    dailyContainer.innerHTML = empty;
    return;
  }

  let oneTimeCount = 0, dailyCount = 0;

  entries.forEach(([id, timer]) => {
    const activeDays = timer.days
      ? timer.days.map((a, i) => a ? dayNames[i].slice(0, 3) : null).filter(Boolean).join(', ')
      : 'None';

    const alias = getAlias(timer.relay);
    const isDailyBadge = timer.isDaily
      ? `<span class="daily-badge"><i class="fas fa-repeat"></i> Daily</span>`
      : '';

    const div = document.createElement('div');
    div.className = `timer-card ${timer.active ? 'active' : 'inactive'}`;
    div.dataset.timerId = id;
    div.innerHTML = `
      ${isDailyBadge}
      <h4><i class="fas fa-toggle-on"></i> ${escHtml(alias)} — <span style="color:var(--accent-green)">${timer.action}</span></h4>
      <p><i class="fas fa-clock"></i> ${timer.startTime}${timer.endTime ? ' → ' + timer.endTime : ''}</p>
      <p><i class="fas fa-calendar-week"></i> ${activeDays}</p>
      <div class="timer-actions">
        <button class="btn btn-edit"   data-action="edit"   data-id="${id}"><i class="fas fa-pen"></i> Edit</button>
        <button class="btn btn-danger" data-action="delete" data-id="${id}"><i class="fas fa-trash"></i> Delete</button>
      </div>
    `;

    if (timer.isDaily) { dailyContainer.appendChild(div); dailyCount++; }
    else { oneTimeContainer.appendChild(div); oneTimeCount++; }
  });

  if (oneTimeCount === 0) oneTimeContainer.innerHTML = `<div class="empty-state"><i class="fas fa-calendar-day"></i><p>No one-time timers</p></div>`;
  if (dailyCount === 0) dailyContainer.innerHTML = `<div class="empty-state"><i class="fas fa-repeat"></i><p>No daily schedules</p></div>`;
}

/* ─────────────────────────────────────────────
   TIMER FORM — RELAY DROPDOWN
───────────────────────────────────────────── */
function updateTimerFormRelays() {
  const sel = document.getElementById('timerRelay');
  const cur = sel.value;
  sel.innerHTML = '<option value="">Choose a relay…</option>';
  Object.keys(relays).forEach(relay => {
    if (!relay || relay === 'undefined' || !relay.trim()) return;
    const opt = document.createElement('option');
    opt.value = relay;
    opt.textContent = getAlias(relay);
    sel.appendChild(opt);
  });
  if (cur) sel.value = cur;
  updateAnalyticsRelayDropdown();
}

/* ─────────────────────────────────────────────
   DAILY SWITCH (in modal)
───────────────────────────────────────────── */
function toggleDailySwitch() {
  const wrap = document.getElementById('dailySwitchWrap');
  const input = document.getElementById('timerIsDaily');
  const isOn = input.value === '1';
  input.value = isOn ? '0' : '1';
  wrap.classList.toggle('active', !isOn);
}

function setDailySwitchState(on) {
  document.getElementById('timerIsDaily').value = on ? '1' : '0';
  document.getElementById('dailySwitchWrap').classList.toggle('active', on);
}

/* ─────────────────────────────────────────────
   TIMER MODAL
───────────────────────────────────────────── */
function openTimerModal() {
  currentEditingTimerId = null;
  document.getElementById('modalTitle').innerHTML = '<i class="fas fa-clock"></i> Add New Timer';
  document.getElementById('timerRelay').value = '';
  document.getElementById('timerAction').value = '';
  document.getElementById('timerStartTime').value = '';
  document.getElementById('timerEndTime').value = '';
  setDailySwitchState(false);
  resetDayChips();
  document.getElementById('timerModal').classList.add('open');
}

function closeTimerModal() {
  document.getElementById('timerModal').classList.remove('open');
  currentEditingTimerId = null;
}

function toggleDay(i) {
  const chip = document.getElementById(`dc${i}`);
  const cb = document.getElementById(`day${i}`);
  chip.classList.toggle('active');
  cb.checked = chip.classList.contains('active');
}

function resetDayChips() {
  for (let i = 0; i < 7; i++) {
    document.getElementById(`dc${i}`).classList.remove('active');
    document.getElementById(`day${i}`).checked = false;
  }
}

function editTimer(timerId) {
  const timer = timers[timerId];
  if (!timer) return;
  currentEditingTimerId = timerId;
  document.getElementById('modalTitle').innerHTML = '<i class="fas fa-pen"></i> Edit Timer';
  document.getElementById('timerRelay').value = timer.relay || '';
  document.getElementById('timerAction').value = timer.action || '';
  document.getElementById('timerStartTime').value = timer.startTime || '';
  document.getElementById('timerEndTime').value = timer.endTime || '';
  setDailySwitchState(!!timer.isDaily);
  resetDayChips();
  if (timer.days) timer.days.forEach((active, i) => {
    if (active) {
      document.getElementById(`dc${i}`).classList.add('active');
      document.getElementById(`day${i}`).checked = true;
    }
  });
  document.getElementById('timerModal').classList.add('open');
}

function deleteTimer(timerId) {
  if (!confirm('Delete this timer?')) return;
  showLoading();
  db.ref(`timers/${timerId}`).remove()
    .then(() => {
      delete timers[timerId];
      hideLoading();
      renderTimers();
    })
    .catch(err => { hideLoading(); alert('Error: ' + err.message); });
}

function handleTimerSubmit() {
  const relay = document.getElementById('timerRelay').value;
  const action = document.getElementById('timerAction').value;
  const startTime = document.getElementById('timerStartTime').value;
  const endTime = document.getElementById('timerEndTime').value;
  const isDaily = document.getElementById('timerIsDaily').value === '1';

  if (!relay || relay === 'undefined' || !action || !startTime || !relays.hasOwnProperty(relay)) {
    alert('Please select a valid relay, action, and start time.'); return;
  }
  const days = Array.from({ length: 7 }, (_, i) => document.getElementById(`day${i}`).checked);
  if (!days.some(Boolean)) { alert('Please select at least one day.'); return; }

  saveTimerData({ relay, action, startTime, endTime: endTime || null, days, active: true, isDaily });
}

function saveTimerData(timerData) {
  showLoading();
  const refPath = currentEditingTimerId
    ? `timers/${currentEditingTimerId}`
    : `timers/${db.ref('timers').push().key}`;

  db.ref(refPath).set(timerData)
    .then(() => {
      updateRelayForTimer(timerData);
      hideLoading();
      closeTimerModal();
    })
    .catch(err => { hideLoading(); alert('Error saving timer: ' + err.message); });
}

/* ─────────────────────────────────────────────
   CREDENTIALS MODAL
───────────────────────────────────────────── */
function showCredentialsModal() {
  const saved = localStorage.getItem('firebaseConfig');
  if (saved) {
    try {
      const { apiKey, databaseURL } = JSON.parse(saved);
      document.getElementById('newApiKey').value = apiKey;
      document.getElementById('newDatabaseURL').value = databaseURL;
    } catch (e) { }
  }
  document.getElementById('credentialsModal').classList.add('open');
}

function closeCredentialsModal() {
  document.getElementById('credentialsModal').classList.remove('open');
}

function handleCredentialsSubmit() {
  const apiKey = document.getElementById('newApiKey').value.trim();
  const databaseURL = document.getElementById('newDatabaseURL').value.trim();
  if (!apiKey || !databaseURL) { alert('Please provide both fields.'); return; }
  localStorage.setItem('firebaseConfig', JSON.stringify({ apiKey, databaseURL }));
  closeCredentialsModal();
  document.getElementById('instructionsSection').style.display = 'block';
  document.getElementById('configSection').style.display = 'block';
  document.getElementById('relaysSection').style.display = 'none';
  document.getElementById('timersSection').style.display = 'none';
  document.getElementById('apiKey').value = apiKey;
  document.getElementById('databaseURL').value = databaseURL;
  alert('Credentials updated! Click "Connect to Firebase" to reconnect.');
}

function modalBackdropClick(event, modalId) {
  if (event.target.id === modalId) {
    document.getElementById(modalId).classList.remove('open');
    if (modalId === 'timerModal') currentEditingTimerId = null;
    if (modalId === 'renameModal') currentRenamingKey = null;
  }
}

/* ─────────────────────────────────────────────
   TIMER RELAY UPDATE
───────────────────────────────────────────── */
function updateRelayForTimer(timer) {
  if (!timer || !timer.active || !timer.relay || !timer.startTime || !timer.days
    || timer.relay === 'undefined' || !relays.hasOwnProperty(timer.relay)) return;

  const now = moment().tz(IST_TIMEZONE);
  const currentDay = (now.day() + 6) % 7;
  if (!timer.days[currentDay]) return;

  const startTime = moment.tz(`${now.format('YYYY-MM-DD')} ${timer.startTime}`, 'YYYY-MM-DD HH:mm', IST_TIMEZONE);
  let endTime = timer.endTime
    ? moment.tz(`${now.format('YYYY-MM-DD')} ${timer.endTime}`, 'YYYY-MM-DD HH:mm', IST_TIMEZONE)
    : null;

  if (endTime && endTime.isBefore(startTime)) endTime.add(1, 'day');

  // CORRECTED LOGIC: Matches standard logic
  if (now.isSameOrAfter(startTime) && (!endTime || now.isBefore(endTime))) {
    db.ref(`relays/${timer.relay}`).set(timer.action === 'ON');
  } else if (endTime && now.isSameOrAfter(endTime)) {
    db.ref(`relays/${timer.relay}`).set(false);
  }
}

/* ─────────────────────────────────────────────
   TIMER SCHEDULER  (runs every 30s)
───────────────────────────────────────────── */
function startTimerScheduler() {
  function tick() {
    if (!db) return;
    const now = moment().tz(IST_TIMEZONE);
    const currentDay = (now.day() + 6) % 7;
    let nextTimer = null, nextTimerDate = null;

    Object.values(timers).forEach(timer => {
      if (!timer?.active || !timer.days?.[currentDay] || !timer.relay
        || timer.relay === 'undefined' || !relays.hasOwnProperty(timer.relay)) return;

      const startTime = moment.tz(`${now.format('YYYY-MM-DD')} ${timer.startTime}`, 'YYYY-MM-DD HH:mm', IST_TIMEZONE);
      let endTime = timer.endTime
        ? moment.tz(`${now.format('YYYY-MM-DD')} ${timer.endTime}`, 'YYYY-MM-DD HH:mm', IST_TIMEZONE)
        : null;
      if (endTime && endTime.isBefore(startTime)) endTime.add(1, 'day');

      // CORRECTED LOGIC: Matches standard logic
      if (now.isSameOrAfter(startTime) && (!endTime || now.isBefore(endTime))) {
        db.ref(`relays/${timer.relay}`).set(timer.action === 'ON');
      } else if (endTime && now.isSameOrAfter(endTime)) {
        db.ref(`relays/${timer.relay}`).set(false);
      }
    });

    // Find next upcoming timer
    for (let dayOffset = 0; dayOffset < 7; dayOffset++) {
      const checkDate = moment(now).add(dayOffset, 'days');
      const checkDay = (checkDate.day() + 6) % 7;
      Object.values(timers).forEach(timer => {
        if (!timer?.active || !timer.days?.[checkDay] || !timer.relay
          || timer.relay === 'undefined' || !relays.hasOwnProperty(timer.relay)) return;
        const startTime = moment.tz(`${checkDate.format('YYYY-MM-DD')} ${timer.startTime}`, 'YYYY-MM-DD HH:mm', IST_TIMEZONE);
        if (dayOffset === 0 && startTime.isSameOrBefore(now)) return;
        if (!nextTimer || startTime.isBefore(nextTimerDate)) { nextTimer = timer; nextTimerDate = startTime; }
      });
      if (nextTimer) break;
    }

    const el = document.getElementById('nextTimer');
    if (!el) return;
    if (nextTimer && nextTimerDate) {
      el.innerHTML = `<i class="fas fa-clock"></i> Next: <strong>${escHtml(getAlias(nextTimer.relay))}</strong> turns
        <strong>${nextTimer.action}</strong> at <strong>${nextTimerDate.format('DD/MM HH:mm')}</strong> · ${nextTimerDate.fromNow()}`;
    } else {
      el.innerHTML = `<i class="fas fa-info-circle"></i> No upcoming timers scheduled`;
    }
  }

  tick();
  setInterval(tick, 30000);
}

/* ═══════════════════════════════════════════════════════════════
   AI VOICE ASSISTANT
   ═══════════════════════════════════════════════════════════════ */

function startVoiceCommand() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { alert('Voice not supported. Please use Chrome or Edge.'); return; }
  if (voiceIsListening) { stopVoiceCommand(); return; }

  voiceIsListening = true;
  document.getElementById('voiceOverlay').classList.add('open');
  document.getElementById('voiceFab').classList.add('listening');
  document.getElementById('voiceFabIcon').className = 'fas fa-stop';
  document.getElementById('voiceStatus').textContent = 'Listening…';
  document.getElementById('voiceTranscript').textContent = '';
  document.getElementById('voiceDailyPrompt').style.display = 'none';
  playVoiceFeedback('start');

  recognition = new SR();
  recognition.continuous = handsFreeMode;
  recognition.interimResults = true;
  recognition.lang = 'en-IN';
  recognition.maxAlternatives = 5;

  setTimeout(initVisualizer, 50); // defer — don't block UI

  recognition.onresult = (e) => {
    let interim = '', final = '';
    const allAlts = [];

    if (silenceTimer) clearTimeout(silenceTimer);

    for (let i = e.resultIndex; i < e.results.length; i++) {
      const res = e.results[i];
      const t = res[0].transcript;
      if (res.isFinal) {
        final += t;
        for (let j = 0; j < res.length; j++) {
          allAlts.push(res[j].transcript.toLowerCase().trim());
        }
      } else {
        interim += t;
      }
    }

    document.getElementById('voiceTranscript').textContent = final || interim;
    
    if (interim && !final) {
      silenceTimer = setTimeout(() => {
        const textToProcess = interim.toLowerCase().trim();
        document.getElementById('voiceStatus').textContent = 'Processing...';
        processVoiceCommand(textToProcess);
        if (!handsFreeMode) stopVoiceCommand();
      }, 800);
    }

    if (final) {
      processVoiceCommand(allAlts.length > 0 ? allAlts : [final.toLowerCase().trim()]);
    }
  };

  recognition.onerror = (e) => {
    document.getElementById('voiceStatus').textContent = '⚠ Error: ' + e.error + '. Try again.';
    setTimeout(stopVoiceCommand, 2000);
  };

  recognition.onend = () => {
    if (voiceIsListening && document.getElementById('voiceDailyPrompt').style.display === 'none') {
      stopVoiceCommand();
    }
  };

  recognition.start();
}

function stopVoiceCommand() {
  if (voiceIsListening) playVoiceFeedback('stop');
  voiceIsListening = false;
  if (silenceTimer) clearTimeout(silenceTimer);
  if (recognition) { try { recognition.stop(); } catch (e) { } recognition = null; }
  stopVisualizer();
  document.getElementById('voiceOverlay').classList.remove('open');
  document.getElementById('voiceFab').classList.remove('listening');
  document.getElementById('voiceFabIcon').className = 'fas fa-microphone';
  document.getElementById('voiceFab').classList.remove('held');
  pendingVoiceTimerData = null;
  document.getElementById('voiceDailyPrompt').style.display = 'none';
}

/* ─────────────────────────────────────────────
   VOICE COMMAND  (tap mic button → speak → result)
───────────────────────────────────────────── */
let holdToSpeakRecognition = null;
let holdFinalTranscript    = '';
let isHoldingMic           = false;

function startHoldToSpeak() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { alert('Voice not supported. Use Chrome browser.'); return; }

  if (holdToSpeakRecognition) {
    try { holdToSpeakRecognition.abort(); } catch (e) {}
    holdToSpeakRecognition = null;
    isHoldingMic = false;
    return;
  }

  isHoldingMic         = true;
  holdFinalTranscript  = '';

  voiceIsListening = true;
  document.getElementById('voiceOverlay').classList.add('open');
  document.getElementById('voiceFab').classList.add('listening', 'held');
  document.getElementById('voiceFabIcon').className = 'fas fa-stop';
  document.getElementById('voiceStatus').textContent = '🎙 Listening… speak your command';
  document.getElementById('voiceTranscript').textContent = '';
  document.getElementById('voiceDailyPrompt').style.display = 'none';

  const holdIndicator = document.getElementById('holdIndicator');
  if (holdIndicator) holdIndicator.style.display = 'block';


  const r = new SR();
  holdToSpeakRecognition = r;
  r.lang           = 'en-IN';
  r.continuous     = false;
  r.interimResults = true;
  r.maxAlternatives = 5;

  setTimeout(initVisualizer, 50); // defer — don't block UI

  r.onresult = (e) => {
    let interim = '', final = '';
    const allAlts = [];
    
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const res = e.results[i];
      const t = res[0].transcript;
      if (res.isFinal) {
        final += t;
        for (let j = 0; j < res.length; j++) {
          allAlts.push(res[j].transcript.toLowerCase().trim());
        }
      } else {
        interim += t;
      }
    }
    document.getElementById('voiceTranscript').textContent = final || interim;
    if (final) {
      holdFinalTranscript = final.toLowerCase().trim();
      processVoiceCommand(allAlts.length > 0 ? allAlts : [holdFinalTranscript]);
    }
  };

  r.onerror = (e) => {
    const msgs = {
      'no-speech':   '🔇 No speech detected — tap & speak',
      'not-allowed': '🚫 Mic blocked — allow mic in browser',
      'network':     location.protocol !== 'https:' ? '🔒 Needs HTTPS to work' : '📵 Google Speech blocked — retry or check network',
    };
    document.getElementById('voiceStatus').textContent =
      msgs[e.error] || `⚠ Error: ${e.error}`;
    setTimeout(() => _cleanupHold(), 2000);
  };

  r.onend = () => {
    if (!holdFinalTranscript) {
      document.getElementById('voiceStatus').textContent = '🔇 Nothing heard — tap again';
      setTimeout(() => _cleanupHold(), 1500);
    }
  };

  try { r.start(); }
  catch (startErr) {
    document.getElementById('voiceStatus').textContent = '⚠ Mic error — allow microphone';
    _cleanupHold();
  }
}

function releaseHoldToSpeak() {
  // No-op
}

function _cleanupHold() {
  isHoldingMic = false;
  holdFinalTranscript = '';
  if (holdToSpeakRecognition) {
    try { holdToSpeakRecognition.stop(); } catch (e) {}
    holdToSpeakRecognition = null;
  }
  stopVisualizer();
  document.getElementById('voiceFab').classList.remove('held');
  const hi = document.getElementById('holdIndicator');
  if (hi) hi.style.display = 'none';
  setTimeout(() => {
    voiceIsListening = false;
    document.getElementById('voiceOverlay').classList.remove('open');
    document.getElementById('voiceFab').classList.remove('listening');
    document.getElementById('voiceFabIcon').className = 'fas fa-microphone';
  }, 2000);
}

/* ─────────────────────────────────────────────
   VOICE ASSISTANT V2 — ENHANCEMENTS
───────────────────────────────────────────── */
function toggleHandsFree() {
  handsFreeMode = !handsFreeMode;
  const btn = document.getElementById('handsFreeToggle');
  if (btn) {
    btn.classList.toggle('active', handsFreeMode);
    btn.querySelector('span').textContent = `Hands-Free: ${handsFreeMode ? 'ON' : 'OFF'}`;
  }
}

let micStream = null; // store stream so we can stop tracks

async function initVisualizer() {
  if (audioContext) return;
  try {
    micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 128; // reduced from 256 — half the bars, same visual
    source = audioContext.createMediaStreamSource(micStream);
    source.connect(analyser);
    dataArray = new Uint8Array(analyser.frequencyBinCount);
    animationId = 0; // 0 = active (null = stopped)
    drawVisualizer();
  } catch (err) {
    console.warn('Visualizer init failed:', err);
  }
}

let _lastDrawTime = 0;
let _vizGradient  = null; // reuse gradient — created once per canvas size

function drawVisualizer() {
  if (animationId === null) return; // stopped — null means halted
  animationId = requestAnimationFrame(drawVisualizer);

  // Throttle to ~24fps
  const now = performance.now();
  if (now - _lastDrawTime < 42) return;
  _lastDrawTime = now;

  const canvas = document.getElementById('voiceVisualizer');
  if (!canvas || !analyser || !dataArray) return;

  const ctx    = canvas.getContext('2d');
  const width  = canvas.width;
  const height = canvas.height;

  analyser.getByteFrequencyData(dataArray);

  // Create gradient once and reuse
  if (!_vizGradient) {
    _vizGradient = ctx.createLinearGradient(0, height, 0, 0);
    _vizGradient.addColorStop(0, '#4d9fff');
    _vizGradient.addColorStop(1, '#00e5a0');
  }

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = _vizGradient;

  const barWidth = (width / dataArray.length) * 2.5;
  const centerX  = width / 2;
  let x = 0;

  let sum = 0;
  for (let i = 0; i < dataArray.length; i++) {
    sum += dataArray[i];
    const barHeight = (dataArray[i] / 255) * height;
    const y = (height - barHeight) / 2;
    ctx.fillRect(centerX + x,          y, barWidth - 1, barHeight);
    ctx.fillRect(centerX - x - barWidth, y, barWidth - 1, barHeight);
    x += barWidth;
  }

  const avg = sum / dataArray.length;
  const micIcon = document.querySelector('.voice-mic-icon');
  if (micIcon) micIcon.classList.toggle('active', avg > 30);
}

function stopVisualizer() {
  if (animationId !== null) cancelAnimationFrame(animationId);
  animationId = null;
  _vizGradient = null; // reset so it's recreated next time
  // Release mic stream tracks so mic light turns off
  if (micStream) {
    micStream.getTracks().forEach(t => t.stop());
    micStream = null;
  }
  // Close audio context to free memory
  if (audioContext) {
    try { audioContext.close(); } catch(_) {}
    audioContext = null;
    analyser = null;
    source = null;
    dataArray = null;
  }
}

let _feedbackCtx = null;

function playVoiceFeedback(type) {
  try {
    // Reuse a single AudioContext — never create a new one per call
    if (!_feedbackCtx || _feedbackCtx.state === 'closed') {
      _feedbackCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (_feedbackCtx.state === 'suspended') _feedbackCtx.resume();

    const ctx  = _feedbackCtx;
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);

    if (type === 'start') {
      osc.frequency.setValueAtTime(440, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.1);
    } else {
      osc.frequency.setValueAtTime(880, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(440, ctx.currentTime + 0.1);
    }
    gain.gain.setValueAtTime(0, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.08, ctx.currentTime + 0.05);
    gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.2);
    osc.start();
    osc.stop(ctx.currentTime + 0.25);
  } catch (e) { /* audio blocked */ }
}

/* ─────────────────────────────────────────────
   TTS SPOKEN FEEDBACK
───────────────────────────────────────────── */
function speakFeedback(text) {
  if (!window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  const utt = new SpeechSynthesisUtterance(text);
  utt.lang  = 'en-IN';
  utt.rate  = 1.1;
  utt.pitch = 1.0;
  utt.volume = 0.9;
  window.speechSynthesis.speak(utt);
}

/* ─────────────────────────────────────────────
   VOICE COMMAND PARSER
───────────────────────────────────────────── */
function processVoiceCommand(input) {
  const alternatives = Array.isArray(input) ? input : [input];
  let matchedCmd = null;

  for (const alt of alternatives) {
    const norm = normalize(alt);
    document.getElementById('voiceStatus').textContent = 'Processing: "' + alt + '"';

    const timerData = parseVoiceTimer(norm);
    if (timerData) {
      pendingVoiceTimerData = timerData;
      document.getElementById('voiceStatus').textContent = `⏱ Timer: ${getAlias(timerData.relay)} ${timerData.action} ${timerData.startTime}${timerData.endTime ? ' → ' + timerData.endTime : ''}`;
      document.getElementById('voiceDailyPrompt').style.display = 'block';
      matchedCmd = 'TIMER';
      break;
    }

    const relayCmd = parseRelayCommand(norm);
    if (relayCmd) {
      if (relayCmd.relay === '__ALL__') {
        // All relays on/off
        const keys = Object.keys(relays).filter(k => k && k !== 'undefined' && k.trim());
        const targetState = relayCmd.action === 'ON';
        keys.forEach(k => toggleRelay(k, targetState, null));
        const label = `All relays ${relayCmd.action}`;
        document.getElementById('voiceStatus').textContent = `✅ ${label}`;
        speakFeedback(label);
      } else {
        const label = `${getAlias(relayCmd.relay)} ${relayCmd.action}`;
        document.getElementById('voiceStatus').textContent = `✅ ${label}`;
        toggleRelay(relayCmd.relay, relayCmd.action === 'ON', null);
        speakFeedback(label);
      }
      matchedCmd = 'RELAY';
      break;
    }
  }

  if (matchedCmd) {
    if (handsFreeMode && matchedCmd === 'RELAY') {
      setTimeout(() => {
        document.getElementById('voiceStatus').textContent = 'Ready for next command…';
        document.getElementById('voiceTranscript').textContent = '';
      }, 2000);
    } else if (matchedCmd === 'RELAY') {
      setTimeout(stopVoiceCommand, 1500);
    }
  } else {
    document.getElementById('voiceStatus').textContent = '❓ Not understood. Try: "relay 1 on" or "fan band karo"';
    speakFeedback('Command not understood');
    if (!handsFreeMode) setTimeout(stopVoiceCommand, 3000);
  }
}

/* ─────────────────────────────────────────────
   VOICE: CONFIRM DAILY
───────────────────────────────────────────── */
function confirmDailyFromVoice(isDaily) {
  if (!pendingVoiceTimerData) { stopVoiceCommand(); return; }
  const timerData = { ...pendingVoiceTimerData, isDaily };
  currentEditingTimerId = null;
  document.getElementById('voiceStatus').textContent = isDaily ? '✅ Saving as Daily Timer…' : '✅ Saving as One-time Timer…';
  document.getElementById('voiceDailyPrompt').style.display = 'none';

  showLoading();
  const refPath = `timers/${db.ref('timers').push().key}`;
  db.ref(refPath).set(timerData)
    .then(() => {
      updateRelayForTimer(timerData);
      hideLoading();
      setTimeout(stopVoiceCommand, 1000);
    })
    .catch(err => { hideLoading(); alert('Error saving timer: ' + err.message); stopVoiceCommand(); });
}

/* ─────────────────────────────────────────────
   PARSE RELAY COMMAND  (v2 — number + all support)
───────────────────────────────────────────── */

// Word-to-number map (English + Hindi spoken numbers)
const WORD_NUMS = {
  'one':1,'ek':1,
  'two':2,'do':2,
  'three':3,'teen':3,'tin':3,
  'four':4,'chaar':4,'char':4,
  'five':5,'paanch':5,'panch':5,
  'six':6,'che':6,'chhah':6,
  'seven':7,'saat':7,'sat':7,
  'eight':8,'aath':8,
  'nine':9,'nau':9,
  'ten':10,'das':10
};

function extractRelayNumber(norm) {
  for (const [word, num] of Object.entries(WORD_NUMS)) {
    const re = new RegExp(`relay\\s+${word}\\b`);
    if (re.test(norm)) return num;
  }
  const m = norm.match(/relay\s+(\d+)/);
  if (m) return parseInt(m[1]);
  return null;
}

function parseRelayCommand(norm) {
  const onWords  = ['on','chalu','chalv','chalo','jalao','jala','lav','laga','shuru','start','open','rakh','rakho','rako','karo','kar','chala','chalao','chal'];
  const offWords = ['off','band','bandh','stop','bujhao','bujha','close','bund','bnd','banda'];

  const isOn  = onWords.some(w  => norm.includes(w));
  const isOff = offWords.some(w => norm.includes(w));
  if (!isOn && !isOff) return null;
  const action = isOff ? 'OFF' : 'ON';

  // ── "all on / all off / sab on / sabhi band" ──
  const allWords = ['all','sab','sabhi','saare','sara','tamam','every'];
  if (allWords.some(w => norm.includes(w))) {
    return { relay: '__ALL__', action };
  }

  const relayKeys = Object.keys(relays).filter(k => k && k !== 'undefined' && k.trim());

  // ── Number-based: "relay 1 on", "relay two off" ──
  const relayNum = extractRelayNumber(norm);
  if (relayNum !== null) {
    const sortedKeys = relayKeys.slice().sort();
    const byIndex = sortedKeys[relayNum - 1];
    if (byIndex) return { relay: byIndex, action };
    const byName = relayKeys.find(k =>
      k.replace(/\D/g,'') === String(relayNum) ||
      normalize(getAlias(k)).includes(String(relayNum))
    );
    if (byName) return { relay: byName, action };
  }

  // ── Name / alias match (longest-first) ──
  const sortedByLen = relayKeys.slice().sort((a, b) =>
    normalize(getAlias(b)).length - normalize(getAlias(a)).length
  );
  for (const key of sortedByLen) {
    const aliasNorm = normalize(getAlias(key));
    const keyNorm   = normalize(key);
    if (norm.includes(aliasNorm) || norm.includes(keyNorm)) {
      return { relay: key, action };
    }
  }

  return null;
}

/* ─────────────────────────────────────────────
   PARSE VOICE TIMER  (v2 — days + relay numbers)
───────────────────────────────────────────── */

// Day name maps: index 0=Mon … 6=Sun
const DAY_MAP = {
  'monday':0,'mon':0,'somvar':0,'somvaar':0,
  'tuesday':1,'tue':1,'mangalvar':1,'mangal':1,
  'wednesday':2,'wed':2,'budhvar':2,'budh':2,
  'thursday':3,'thu':3,'guruvar':3,'bruhaspativar':3,
  'friday':4,'fri':4,'shukravar':4,'shukra':4,
  'saturday':5,'sat':5,'shanivar':5,'shani':5,
  'sunday':6,'sun':6,'ravivar':6,'ravi':6,
  'weekday':null,'weekdays':null,'working':null,
  'weekend':null,'weekends':null,
  'everyday':null,'daily':null,'rozana':null,'roj':null,'har din':null
};

function extractDaysFromNorm(norm) {
  // "everyday/daily/rozana" → all 7
  if (['everyday','daily','rozana','roj','har din','rozmara'].some(w => norm.includes(w))) {
    return Array(7).fill(true);
  }
  // "weekday/working" → Mon-Fri
  if (['weekday','weekdays','working day','working days'].some(w => norm.includes(w))) {
    return [true,true,true,true,true,false,false];
  }
  // "weekend" → Sat-Sun
  if (['weekend','weekends'].some(w => norm.includes(w))) {
    return [false,false,false,false,false,true,true];
  }
  // specific day names
  const days = Array(7).fill(false);
  let found = false;
  for (const [word, idx] of Object.entries(DAY_MAP)) {
    if (idx !== null && norm.includes(word)) { days[idx] = true; found = true; }
  }
  if (found) return days;
  // default: all days
  return Array(7).fill(true);
}

function parseVoiceTimer(norm) {
  const hasTime = norm.includes('from') || norm.includes('tak') ||
    norm.includes('to ') || norm.includes('baje') ||
    norm.includes('pm') || norm.includes('am') ||
    norm.includes('baj') || norm.includes('bajke') ||
    norm.includes('schedule') || norm.includes('timer') ||
    norm.includes('set') || norm.includes('laga') ||
    /\d+\s*:\s*\d+/.test(norm) || /\d+\s*baj/.test(norm) ||
    /\d+\s*(am|pm)/i.test(norm);

  if (!hasTime) return null;

  const relayKeys = Object.keys(relays).filter(k => k && k !== 'undefined' && k.trim());

  // relay number support
  const relayNum = extractRelayNumber(norm);
  let matchedRelay = null;
  if (relayNum !== null) {
    const sk = relayKeys.slice().sort();
    matchedRelay = sk[relayNum - 1] || relayKeys.find(k =>
      k.replace(/\D/g,'') === String(relayNum));
  }
  if (!matchedRelay) {
    const sortedKeys = relayKeys.slice().sort((a,b) =>
      normalize(getAlias(b)).length - normalize(getAlias(a)).length);
    for (const key of sortedKeys) {
      if (norm.includes(normalize(getAlias(key))) || norm.includes(normalize(key))) {
        matchedRelay = key; break;
      }
    }
  }
  if (!matchedRelay) return null;

  const times = extractTimes(norm);
  if (times.length < 1) return null;

  const onWords  = ['on','chalu','jalao','lav','shuru','start','chalo','laga','open','rakh','rakho','rako','karo','kar'];
  const offWords = ['off','band','bandh','stop','bujhao','close','bund'];
  const isOff = offWords.some(w => norm.includes(w));
  const action = isOff ? 'OFF' : 'ON';

  const days = extractDaysFromNorm(norm);

  return {
    relay: matchedRelay,
    action,
    startTime: times[0],
    endTime: times[1] || null,
    days,
    active: true
  };
}

/* ─────────────────────────────────────────────
   EXTRACT TIMES
───────────────────────────────────────────── */
function extractTimes(norm) {
  const times = [];
  let foundNums = [];

  const matches1 = [...norm.matchAll(/(\d{1,2}):(\d{2})\s*(am|pm)?/gi)];
  matches1.forEach(m => {
    let h = parseInt(m[1]), mi = parseInt(m[2]);
    const ampm = m[3]?.toLowerCase();
    if (ampm === 'pm' && h < 12) h += 12;
    if (ampm === 'am' && h === 12) h = 0;
    times.push(pad(h) + ':' + pad(mi));
  });

  if (times.length === 0) {
    const matches2 = [...norm.matchAll(/(\d{1,2})\s*(am|pm)/gi)];
    matches2.forEach(m => {
      let h = parseInt(m[1]);
      const ampm = m[2].toLowerCase();
      if (ampm === 'pm' && h < 12) h += 12;
      if (ampm === 'am' && h === 12) h = 0;
      times.push(pad(h) + ':00');
    });
  }

  if (times.length === 0) {
    const matches3 = [...norm.matchAll(/(\d{1,2})\s*baje/gi)];
    matches3.forEach(m => {
      let h = parseInt(m[1]);
      const before = norm.substring(0, m.index);
      if (before.includes('sham') || before.includes('evening') || before.includes('shaam')) {
        if (h < 12) h += 12;
      }
      times.push(pad(h) + ':00');
    });
  }

  return times.slice(0, 2);
}

function pad(n) { return String(n).padStart(2, '0'); }

/* ─────────────────────────────────────────────
   NORMALIZE string
───────────────────────────────────────────── */
function normalize(str) {
  return str.toLowerCase()
    .replace(/[^\u0900-\u097F\u0000-\u007F\s]/g, '')  
    .replace(/\s+/g, ' ')
    .trim();
}

/* ─────────────────────────────────────────────
   SECURITY HELPERS
───────────────────────────────────────────── */
function escHtml(str) {
  return String(str).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function escAttr(str) {
  return String(str).replace(/['"]/g, c => c === "'" ? '\\x27' : '\\x22');
}
/* ══════════════════════════════════════════════════════════════
   DEDICATED RELAY VOICE BUTTON  — startRelayVoice / stopRelayVoice
   Completely independent from the topbar hold-to-speak mic.
   Tap once → start listening. Tap again or auto-stops on result.
   ══════════════════════════════════════════════════════════════ */
let relayVoiceRecog   = null;
let relayVoiceActive  = false;
let relayVoiceRetried = false;

function startRelayVoice(e) {
  if (e && e.cancelable) e.preventDefault();

  // If already listening, stop it
  if (relayVoiceActive) {
    _stopRelayVoiceRecog();
    return;
  }

  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    _setRelayVoiceResult('⚠ Use Chrome/Edge for voice', true);
    return;
  }

  relayVoiceActive = true;
  _setRelayVoiceBtn(true);
  _setRelayVoiceLabel('Listening…');
  _setRelayVoiceResult('');

  const r = new SR();
  relayVoiceRecog = r;
  r.lang            = 'en-IN';
  r.continuous      = false;
  r.interimResults  = true;
  r.maxAlternatives = 5;

  r.onresult = (ev) => {
    let interim = '', final = '';
    const alts = [];
    for (let i = ev.resultIndex; i < ev.results.length; i++) {
      const res = ev.results[i];
      if (res.isFinal) {
        final += res[0].transcript;
        for (let j = 0; j < res.length; j++) alts.push(res[j].transcript.toLowerCase().trim());
      } else {
        interim += res[0].transcript;
      }
    }
    _setRelayVoiceResult(final || interim);

    if (final) {
      const input = alts.length ? alts : [final.toLowerCase().trim()];
      _processRelayVoiceCmd(input);
    }
  };

  r.onerror = (ev) => {
    const msgs = {
      'no-speech'  : '🔇 Nothing heard — tap & speak',
      'not-allowed': '🚫 Mic blocked — allow in browser',
      'network'    : location.protocol !== 'https:' ? '🔒 Needs HTTPS — open via https://' : '📵 Google Speech unreachable — check VPN/firewall or retry',
    };
    _setRelayVoiceResult(msgs[ev.error] || `⚠ ${ev.error}`, true);
    _stopRelayVoiceRecog();
  };

  r.onend = () => {
    if (relayVoiceActive) _stopRelayVoiceRecog();
  };

  relayVoiceRetried = false;
  try { r.start(); }
  catch (err) {
    _setRelayVoiceResult('⚠ Mic error — allow microphone', true);
    _stopRelayVoiceRecog();
  }
}

function stopRelayVoice() { /* no-op on mouse-leave; button is tap-to-toggle */ }

function _processRelayVoiceCmd(alts) {
  for (const alt of alts) {
    const norm = normalize(alt);

    // ── Usage query first ──
    const usageQuery = parseUsageVoiceQuery(norm);
    if (usageQuery) {
      _stopRelayVoiceRecog();
      const result = getVoiceUsageSummary(usageQuery);
      _setRelayVoiceResult(result);
      speakFeedback(result.replace(/[📊✅⚡]/g, ''));
      setTimeout(() => { _setRelayVoiceResult(''); _setRelayVoiceLabel('Voice'); }, 6000);
      return;
    }

    // ── Timer command first ──
    const timerData = parseVoiceTimer(norm);
    if (timerData) {
      _stopRelayVoiceRecog();
      _showRvTimerConfirm(timerData);
      return;
    }

    // ── Relay on/off command ──
    const cmd = parseRelayCommand(norm);
    if (cmd) {
      if (cmd.relay === '__ALL__') {
        const keys = Object.keys(relays).filter(k => k && k !== 'undefined' && k.trim());
        keys.forEach(k => toggleRelay(k, cmd.action === 'ON', null));
        const msg = `✅ All relays ${cmd.action}`;
        _setRelayVoiceResult(msg);
        speakFeedback(`All relays ${cmd.action}`);
      } else {
        const label = getAlias(cmd.relay);
        toggleRelay(cmd.relay, cmd.action === 'ON', null);
        const msg = `✅ ${label} → ${cmd.action}`;
        _setRelayVoiceResult(msg);
        speakFeedback(`${label} ${cmd.action}`);
      }
      playVoiceFeedback('stop');
      _stopRelayVoiceRecog();
      setTimeout(() => {
        _setRelayVoiceResult('');
        _setRelayVoiceLabel('Voice');
      }, 3000);
      return;
    }
  }
  // Nothing matched
  _setRelayVoiceResult('❓ Not understood — try again', true);
  speakFeedback('Not understood');
  _stopRelayVoiceRecog();
  setTimeout(() => {
    _setRelayVoiceResult('');
    _setRelayVoiceLabel('Voice');
  }, 3000);
}

/* ─────────────────────────────────────────────
   RV TIMER CONFIRM POPUP
   Shows a compact card above the FAB asking
   "Daily or One-time?" then saves to Firebase.
───────────────────────────────────────────── */
function _showRvTimerConfirm(timerData) {
  // Remove old popup if any
  const old = document.getElementById('rvTimerConfirm');
  if (old) old.remove();

  const relay   = getAlias(timerData.relay);
  const timeStr = timerData.startTime + (timerData.endTime ? ' → ' + timerData.endTime : '');
  const activeDays = timerData.days
    .map((a,i) => a ? ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'][i] : null)
    .filter(Boolean).join(', ');

  const box = document.createElement('div');
  box.id = 'rvTimerConfirm';
  box.innerHTML = `
    <div class="rvtc-title"><i class="fas fa-clock"></i> New Timer</div>
    <div class="rvtc-row"><b>${escHtml(relay)}</b> → <span class="rvtc-action ${timerData.action === 'ON' ? 'on' : 'off'}">${timerData.action}</span></div>
    <div class="rvtc-row"><i class="fas fa-clock" style="font-size:11px"></i> ${timeStr}</div>
    <div class="rvtc-row rvtc-days"><i class="fas fa-calendar-week" style="font-size:11px"></i> ${escHtml(activeDays)}</div>
    <div class="rvtc-btns">
      <button class="rvtc-btn rvtc-daily"   onclick="_saveRvTimer(true)"><i class="fas fa-repeat"></i> Daily</button>
      <button class="rvtc-btn rvtc-onetime" onclick="_saveRvTimer(false)"><i class="fas fa-calendar-day"></i> Once</button>
      <button class="rvtc-btn rvtc-cancel"  onclick="_closeRvTimerConfirm()"><i class="fas fa-xmark"></i></button>
    </div>`;
  document.getElementById('rvFabWrap').appendChild(box);
  speakFeedback(`Timer for ${relay} at ${timerData.startTime}. Daily or one time?`);

  // Store pending data
  window._rvPendingTimer = timerData;
}

function _saveRvTimer(isDaily) {
  const timerData = { ...window._rvPendingTimer, isDaily };
  if (!timerData || !db) { _closeRvTimerConfirm(); return; }

  showLoading();
  const refPath = `timers/${db.ref('timers').push().key}`;
  db.ref(refPath).set(timerData)
    .then(() => {
      updateRelayForTimer(timerData);
      hideLoading();
      _setRelayVoiceResult(`✅ Timer saved (${isDaily ? 'Daily' : 'One-time'})`);
      speakFeedback(`Timer saved as ${isDaily ? 'daily' : 'one time'}`);
      _closeRvTimerConfirm();
      setTimeout(() => _setRelayVoiceResult(''), 3000);
    })
    .catch(err => {
      hideLoading();
      _setRelayVoiceResult('❌ Save failed', true);
      _closeRvTimerConfirm();
    });
}

function _closeRvTimerConfirm() {
  const el = document.getElementById('rvTimerConfirm');
  if (el) el.remove();
  window._rvPendingTimer = null;
}

function _stopRelayVoiceRecog() {
  relayVoiceActive = false;
  if (relayVoiceRecog) { try { relayVoiceRecog.stop(); } catch (_) {} relayVoiceRecog = null; }
  _setRelayVoiceBtn(false);
  _setRelayVoiceLabel('Hold & Speak');
}

function _setRelayVoiceBtn(on) {
  const btn  = document.getElementById('relayVoiceBtn');
  const icon = document.getElementById('relayVoiceBtnIcon');
  if (!btn) return;
  btn.classList.toggle('listening', on);
  if (icon) icon.className = on ? 'fas fa-stop' : 'fas fa-microphone';
}

function _setRelayVoiceLabel(txt) {
  const el = document.getElementById('relayVoiceLabel');
  if (el) el.textContent = txt;
}

function _setRelayVoiceResult(txt, isError = false) {
  const el = document.getElementById('relayVoiceResult');
  if (!el) return;
  el.textContent = txt;
  el.className = 'relay-voice-result' + (isError ? ' error' : '');
}

// ── Remap helpers to the new floating FAB IDs ──
// Override the three helper functions to point to rvFab elements

_setRelayVoiceBtn = function(on) {
  // Floating FAB
  const fab  = document.getElementById('rvFab');
  const icon = document.getElementById('rvFabIcon');
  const lbl  = document.getElementById('rvFabLabel');
  if (fab)  fab.classList.toggle('listening', on);
  if (icon) icon.className = on ? 'fas fa-stop' : 'fas fa-microphone';
  if (lbl)  lbl.textContent = on ? 'Listening…' : 'Voice';
};

_setRelayVoiceLabel = function(txt) {
  const el = document.getElementById('rvFabLabel');
  if (el) el.textContent = txt === 'Hold & Speak' ? 'Voice' : txt;
};

_setRelayVoiceResult = function(txt, isError = false) {
  const el = document.getElementById('rvFabResult');
  if (!el) return;
  el.textContent = txt;
  el.className = 'rv-fab-result' + (isError ? ' error' : '') + (txt ? ' show' : '');
};
/* ═══════════════════════════════════════════════════════════════
   RELAY USAGE ANALYTICS  (v1.0)
   · Tracks ON/OFF sessions per relay per day in Firebase
   · Aggregates hours-per-day for a 7-day window
   · Chart.js bar chart + summary chips + day table
   · Voice query: "relay 1 kitne ghante chala" / "AC usage"
   ═══════════════════════════════════════════════════════════════ */

// ── In-memory session tracking ──
// relaySessionStart[relayKey] = timestamp (ms) when it was turned ON
const relaySessionStart = {};

/**
 * Called after every successful toggleRelay Firebase write.
 * ON  → record session start timestamp
 * OFF → compute elapsed minutes, save to Firebase under
 *       usage/{relayKey}/{YYYY-MM-DD}/minutes  (increment)
 */
function trackRelayUsage(relay, isOn) {
  if (!db || !relay || relay === 'undefined') return;

  if (isOn) {
    // Mark session start
    relaySessionStart[relay] = Date.now();
  } else {
    // Session end — compute duration
    const start = relaySessionStart[relay];
    if (!start) return;
    const elapsedMin = Math.round((Date.now() - start) / 60000);
    delete relaySessionStart[relay];
    if (elapsedMin <= 0) return;

    const dateKey = moment().tz(IST_TIMEZONE).format('YYYY-MM-DD');
    const path = `usage/${relay}/${dateKey}/minutes`;
    db.ref(path).transaction(cur => (cur || 0) + elapsedMin);
  }
}

// Also handle page-unload: flush any open sessions
window.addEventListener('beforeunload', () => {
  Object.keys(relaySessionStart).forEach(relay => {
    const start = relaySessionStart[relay];
    if (!start || !db) return;
    const elapsedMin = Math.round((Date.now() - start) / 60000);
    if (elapsedMin <= 0) return;
    const dateKey = moment().tz(IST_TIMEZONE).format('YYYY-MM-DD');
    db.ref(`usage/${relay}/${dateKey}/minutes`).transaction(cur => (cur || 0) + elapsedMin);
  });
});

/* ─────────────────────────────────────────────
   ANALYTICS MODAL STATE
───────────────────────────────────────────── */
let analyticsRelayKey   = null;   // currently viewed relay
let analyticsWeekOffset = 0;      // 0 = this week, -1 = last week, etc.
let analyticsChartInst  = null;   // Chart.js instance

function openAnalyticsModal(relayKey) {
  analyticsRelayKey   = relayKey || null;
  analyticsWeekOffset = 0;

  // Populate relay selector
  const sel = document.getElementById('analyticsRelaySelect');
  sel.innerHTML = '<option value="">Select relay…</option>';
  Object.keys(relays)
    .filter(k => k && k !== 'undefined' && k.trim())
    .forEach(k => {
      const opt = document.createElement('option');
      opt.value = k;
      opt.textContent = getAlias(k);
      if (k === relayKey) opt.selected = true;
      sel.appendChild(opt);
    });

  document.getElementById('analyticsModal').classList.add('open');
  loadAnalyticsData();
}

function closeAnalyticsModal() {
  document.getElementById('analyticsModal').classList.remove('open');
  if (analyticsChartInst) { analyticsChartInst.destroy(); analyticsChartInst = null; }
}

function onAnalyticsRelayChange() {
  analyticsRelayKey   = document.getElementById('analyticsRelaySelect').value || null;
  analyticsWeekOffset = 0;
  loadAnalyticsData();
}

function shiftAnalyticsWeek(delta) {
  analyticsWeekOffset += delta;
  loadAnalyticsData();
}

/* ─────────────────────────────────────────────
   LOAD & RENDER  ANALYTICS DATA
───────────────────────────────────────────── */
async function loadAnalyticsData() {
  if (!analyticsRelayKey || !db) {
    _renderAnalyticsChart([], []);
    return;
  }

  // Build week date range (Mon–Sun)
  const now        = moment().tz(IST_TIMEZONE).add(analyticsWeekOffset, 'weeks');
  const weekStart  = now.clone().startOf('isoWeek');   // Monday
  const weekEnd    = weekStart.clone().add(6, 'days'); // Sunday

  // Update week label
  const isCurrent = analyticsWeekOffset === 0;
  const isPrev    = analyticsWeekOffset === -1;
  const wLabel    = isCurrent ? 'This Week'
                  : isPrev    ? 'Last Week'
                  : `${weekStart.format('DD MMM')} – ${weekEnd.format('DD MMM')}`;
  document.getElementById('analyticsWeekLabel').textContent = wLabel;

  // Title
  document.getElementById('analyticsTitle').innerHTML =
    `<i class="fas fa-chart-line"></i> ${escHtml(getAlias(analyticsRelayKey))} | Usage Report`;

  // Fetch all dates in this week from Firebase
  const labels = [];
  const hours  = [];

  const promises = [];
  for (let i = 0; i < 7; i++) {
    const d     = weekStart.clone().add(i, 'days');
    const dKey  = d.format('YYYY-MM-DD');
    const dLabel= d.format('ddd');
    labels.push(dLabel);

    promises.push(
      db.ref(`usage/${analyticsRelayKey}/${dKey}/minutes`)
        .once('value')
        .then(snap => {
          const mins = snap.val() || 0;
          return parseFloat((mins / 60).toFixed(2));
        })
        .catch(() => 0)
    );
  }

  const resolved = await Promise.all(promises);
  resolved.forEach(h => hours.push(h));

  _renderAnalyticsChart(labels, hours);
}

function _renderAnalyticsChart(labels, hours) {
  const isEmpty    = hours.every(h => h === 0);
  const chartWrap  = document.querySelector('.analytics-chart-wrap');
  const emptyEl    = document.getElementById('analyticsEmpty');
  const canvas     = document.getElementById('analyticsChart');
  const tbody      = document.getElementById('analyticsTableBody');

  emptyEl.style.display  = (!analyticsRelayKey || isEmpty) ? 'flex' : 'none';
  canvas.style.display   = (!analyticsRelayKey || isEmpty) ? 'none' : 'block';

  // Summary chips
  const total   = hours.reduce((a, b) => a + b, 0);
  const avg     = total / Math.max(hours.filter(h => h > 0).length, 1);
  const peakIdx = hours.indexOf(Math.max(...hours));
  document.getElementById('analyticsTotalHours').textContent =
    total > 0 ? `${total.toFixed(1)} h` : '—';
  document.getElementById('analyticsPeakDay').textContent =
    total > 0 ? (labels[peakIdx] || '—') : '—';
  document.getElementById('analyticsAvgHours').textContent =
    total > 0 ? `${avg.toFixed(1)} h` : '—';

  // Per-day table
  tbody.innerHTML = '';
  const maxH = Math.max(...hours, 0.01);
  labels.forEach((lbl, i) => {
    const pct = Math.round((hours[i] / maxH) * 100);
    const tr  = document.createElement('tr');
    tr.innerHTML = `
      <td>${lbl}</td>
      <td class="analytics-hours-cell">${hours[i] > 0 ? hours[i].toFixed(1) + ' h' : '<span style="color:var(--text-muted)">—</span>'}</td>
      <td><div class="analytics-bar-mini" style="width:${pct}%"></div></td>`;
    tbody.appendChild(tr);
  });

  if (!analyticsRelayKey || isEmpty) return;

  // Destroy old chart
  if (analyticsChartInst) { analyticsChartInst.destroy(); analyticsChartInst = null; }

  // Color gradient based on theme
  const isDark     = document.documentElement.getAttribute('data-theme') !== 'light';
  const barColor   = isDark
    ? 'rgba(77, 160, 255, 0.75)'
    : 'rgba(0, 120, 220, 0.70)';
  const borderClr  = isDark ? '#4da0ff' : '#0078dc';
  const gridClr    = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.07)';
  const textClr    = isDark ? '#a09ec0' : '#5a5878';

  analyticsChartInst = new Chart(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: `${getAlias(analyticsRelayKey)} — Hours ON`,
        data: hours,
        backgroundColor: hours.map((h, i) =>
          i === hours.indexOf(Math.max(...hours))
            ? (isDark ? 'rgba(0,229,160,0.8)' : 'rgba(0,168,112,0.8)')
            : barColor
        ),
        borderColor: hours.map((h, i) =>
          i === hours.indexOf(Math.max(...hours))
            ? (isDark ? '#00e5a0' : '#00a870')
            : borderClr
        ),
        borderWidth: 2,
        borderRadius: 8,
        borderSkipped: false,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: ctx => `  ${ctx.raw.toFixed(1)} hours ON`
          },
          backgroundColor: isDark ? 'rgba(17,17,26,0.95)' : 'rgba(255,255,255,0.95)',
          titleColor: isDark ? '#f0eeff' : '#1a1830',
          bodyColor: isDark ? '#a09ec0' : '#5a5878',
          borderColor: borderClr,
          borderWidth: 1,
          padding: 10,
          cornerRadius: 10,
        }
      },
      scales: {
        x: {
          grid:  { color: gridClr },
          ticks: { color: textClr, font: { family: 'Outfit', size: 12 } }
        },
        y: {
          beginAtZero: true,
          grid:  { color: gridClr },
          ticks: {
            color: textClr,
            font: { family: 'Outfit', size: 12 },
            callback: v => v + 'h'
          },
          title: {
            display: true,
            text: 'Hours ON',
            color: textClr,
            font: { family: 'Outfit', size: 12 }
          }
        }
      }
    }
  });
}

/* ─────────────────────────────────────────────
   VOICE QUERY: "AC kitne ghante chala?"
   Injects handling into processVoiceCommand
───────────────────────────────────────────── */
const _origProcessVoiceCommand = processVoiceCommand;
processVoiceCommand = function(input) {
  const alternatives = Array.isArray(input) ? input : [input];

  for (const alt of alternatives) {
    const norm = normalize(alt);

    // Detect usage/report queries
    const usageKeywords  = ['usage','report','kitne ghante','kitna chala','kitne time','hours','hour','analytics','use','upyog','time on','how long'];
    const isUsageQuery   = usageKeywords.some(w => norm.includes(w));

    if (isUsageQuery) {
      // Try to match a relay
      const relayKeys = Object.keys(relays).filter(k => k && k !== 'undefined' && k.trim());
      let matchedKey = null;

      // Number-based
      const relayNum = extractRelayNumber(norm);
      if (relayNum !== null) {
        const sortedKeys = relayKeys.slice().sort();
        matchedKey = sortedKeys[relayNum - 1] || null;
      }

      // Name/alias match
      if (!matchedKey) {
        const sorted = relayKeys.slice().sort((a, b) =>
          normalize(getAlias(b)).length - normalize(getAlias(a)).length
        );
        for (const k of sorted) {
          if (norm.includes(normalize(getAlias(k))) || norm.includes(normalize(k))) {
            matchedKey = k; break;
          }
        }
      }

      // Open analytics modal
      document.getElementById('voiceStatus').textContent =
        matchedKey
          ? `📊 Opening usage report for ${getAlias(matchedKey)}…`
          : '📊 Opening usage analytics…';
      speakFeedback(matchedKey ? `Opening usage report for ${getAlias(matchedKey)}` : 'Opening analytics');

      setTimeout(() => {
        stopVoiceCommand();
        openAnalyticsModal(matchedKey);
      }, 800);
      return;
    }
  }

  // Fallback to original handler
  _origProcessVoiceCommand(input);
};

// Same hook for FAB voice
const _origProcessRelayVoiceCmd = _processRelayVoiceCmd;
_processRelayVoiceCmd = function(alts) {
  const usageKeywords = ['usage','report','kitne ghante','kitna chala','kitne time','hours','analytics','upyog','how long'];
  for (const alt of alts) {
    const norm = normalize(alt);
    if (usageKeywords.some(w => norm.includes(w))) {
      const relayKeys = Object.keys(relays).filter(k => k && k !== 'undefined' && k.trim());
      let matchedKey = null;
      const relayNum = extractRelayNumber(norm);
      if (relayNum !== null) {
        matchedKey = relayKeys.slice().sort()[relayNum - 1] || null;
      }
      if (!matchedKey) {
        for (const k of relayKeys.slice().sort((a, b) =>
          normalize(getAlias(b)).length - normalize(getAlias(a)).length)) {
          if (norm.includes(normalize(getAlias(k))) || norm.includes(normalize(k))) {
            matchedKey = k; break;
          }
        }
      }
      _setRelayVoiceResult(matchedKey ? `📊 ${getAlias(matchedKey)} usage…` : '📊 Usage analytics…');
      _stopRelayVoiceRecog();
      setTimeout(() => openAnalyticsModal(matchedKey), 600);
      return;
    }
  }
  _origProcessRelayVoiceCmd(alts);
};

// Update voice cheatsheet to include usage query hint
document.addEventListener('DOMContentLoaded', () => {
  const cs = document.querySelector('.voice-cheatsheet');
  if (cs) {
    const span = document.createElement('span');
    span.innerHTML = '<b>"relay 1 kitne ghante chala"</b>';
    cs.appendChild(span);
  }
});

/* ══════════════════════════════════════════════════════════════
   RELAY USAGE ANALYTICS  — v1.0
   · Records ON/OFF events to Firebase: usage_log/{relay}/{date}/{pushKey}
   · Computes daily hours from paired ON→OFF events
   · Renders Chart.js bar chart + day-wise table
   · Voice queries: "AC kitne ghante chala" / "relay 1 usage"
   ══════════════════════════════════════════════════════════════ */

/* ─── In-memory session tracking ─── */
const _relayOnSince = {};   // { relayKey: timestamp_ms }
let _usageChartInstance = null;
let _usageDataCache = {};   // { relayKey: { 'YYYY-MM-DD': hours } }

/* ─── Record a usage event to Firebase ─── */
function recordUsageEvent(relay, isOn) {
  if (!db || !relay || relay === 'undefined') return;
  const now = moment().tz(IST_TIMEZONE);
  const dateStr = now.format('YYYY-MM-DD');
  const ts = now.valueOf();

  if (isOn) {
    // Store session start in memory
    _relayOnSince[relay] = ts;
    // Log to Firebase
    db.ref(`usage_log/${relay}/${dateStr}`).push({ event: 'ON', ts });
  } else {
    // Compute session duration
    const onTs = _relayOnSince[relay];
    delete _relayOnSince[relay];
    if (onTs) {
      const hours = (ts - onTs) / 3600000;
      db.ref(`usage_log/${relay}/${dateStr}`).push({ event: 'OFF', ts, duration_h: hours });
      // Update aggregated daily total
      const ref = db.ref(`usage_hours/${relay}/${dateStr}`);
      ref.transaction(cur => (cur || 0) + hours);
    }
  }
}

/* ─── Update analytics dropdown ─── */
function updateAnalyticsRelayDropdown() {
  const sel = document.getElementById('analyticsRelaySelect');
  if (!sel) return;
  const cur = sel.value;
  sel.innerHTML = '<option value="">Choose a relay…</option>';
  Object.keys(relays).forEach(relay => {
    if (!relay || relay === 'undefined' || !relay.trim()) return;
    const opt = document.createElement('option');
    opt.value = relay;
    opt.textContent = getAlias(relay);
    sel.appendChild(opt);
  });
  if (cur) sel.value = cur;
}

/* ─── Load & render usage chart ─── */
function loadUsageChart() {
  const relay = document.getElementById('analyticsRelaySelect')?.value;
  const days  = parseInt(document.getElementById('analyticsPeriod')?.value || '7');
  const emptyEl = document.getElementById('analyticsChartEmpty');
  const tableWrap = document.getElementById('analyticsTableWrap');

  if (!relay || !db) {
    if (emptyEl) { emptyEl.classList.remove('hidden'); emptyEl.querySelector('p').textContent = 'Select a relay to view usage'; }
    if (tableWrap) tableWrap.style.display = 'none';
    clearAnalyticsSummary();
    return;
  }

  if (emptyEl) { emptyEl.classList.remove('hidden'); emptyEl.querySelector('p').textContent = 'Loading…'; }

  // Build date range
  const dateRange = [];
  for (let i = days - 1; i >= 0; i--) {
    dateRange.push(moment().tz(IST_TIMEZONE).subtract(i, 'days').format('YYYY-MM-DD'));
  }

  db.ref(`usage_hours/${relay}`).once('value', snap => {
    const raw = snap.val() || {};
    _usageDataCache[relay] = raw;

    const labels = dateRange.map(d => moment(d, 'YYYY-MM-DD').format('ddd D'));
    const data   = dateRange.map(d => parseFloat((raw[d] || 0).toFixed(2)));

    // Handle in-progress ON session
    const sessionStart = _relayOnSince[relay];
    if (sessionStart && relays[relay] === true) {
      const todayStr = moment().tz(IST_TIMEZONE).format('YYYY-MM-DD');
      const idx = dateRange.indexOf(todayStr);
      if (idx !== -1) {
        data[idx] = parseFloat((data[idx] + (Date.now() - sessionStart) / 3600000).toFixed(2));
      }
    }

    renderUsageChart(relay, labels, data, dateRange);
    renderUsageTable(relay, dateRange, data);
    updateAnalyticsSummary(relay, dateRange, data);

    if (emptyEl) emptyEl.classList.add('hidden');
    if (tableWrap) tableWrap.style.display = '';
  });
}

/* ─── Render Chart.js bar chart ─── */
function renderUsageChart(relay, labels, data, dateRange) {
  const canvas = document.getElementById('usageChart');
  if (!canvas) return;

  const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
  const gridCol = isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.07)';
  const textCol = isDark ? '#a09ec0' : '#5a5878';
  const todayIdx = dateRange.indexOf(moment().tz(IST_TIMEZONE).format('YYYY-MM-DD'));

  const bgColors = data.map((_, i) =>
    i === todayIdx ? 'rgba(255,184,77,0.7)' : 'rgba(77,160,255,0.55)'
  );
  const borderColors = data.map((_, i) =>
    i === todayIdx ? 'rgba(255,184,77,1)' : 'rgba(77,160,255,0.9)'
  );

  if (_usageChartInstance) { _usageChartInstance.destroy(); }

  _usageChartInstance = new Chart(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: `${getAlias(relay)} — Hours ON`,
        data,
        backgroundColor: bgColors,
        borderColor: borderColors,
        borderWidth: 2,
        borderRadius: 8,
        borderSkipped: false,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          labels: { color: textCol, font: { family: "'Outfit', sans-serif", size: 12 } }
        },
        tooltip: {
          callbacks: {
            label: ctx => ` ${ctx.parsed.y.toFixed(2)} h`
          }
        }
      },
      scales: {
        x: {
          ticks: { color: textCol, font: { family: "'Outfit', sans-serif", size: 11 }, maxRotation: 45, minRotation: 0 },
          grid: { color: gridCol }
        },
        y: {
          beginAtZero: true,
          ticks: { color: textCol, font: { family: "'Outfit', sans-serif", size: 11 },
            callback: v => v + 'h' },
          grid: { color: gridCol },
          title: { display: true, text: 'Hours ON', color: textCol, font: { size: 11 } }
        }
      }
    }
  });
}

/* ─── Render day-wise breakdown table ─── */
function renderUsageTable(relay, dateRange, data) {
  const table = document.getElementById('analyticsTable');
  if (!table) return;
  const maxH = Math.max(...data, 0.01);
  const todayStr = moment().tz(IST_TIMEZONE).format('YYYY-MM-DD');

  table.innerHTML = dateRange.map((d, i) => {
    const isToday = d === todayStr;
    const pct = ((data[i] / maxH) * 100).toFixed(1);
    const label = moment(d, 'YYYY-MM-DD').format('ddd, D MMM');
    return `
      <div class="analytics-table-row ${isToday ? 'atr-today' : ''}">
        <div class="atr-day">${label}${isToday ? ' ★' : ''}</div>
        <div class="atr-bar-wrap"><div class="atr-bar" style="width:${pct}%"></div></div>
        <div class="atr-hours">${data[i] > 0 ? data[i].toFixed(2) + 'h' : '—'}</div>
      </div>`;
  }).join('');
}

/* ─── Analytics summary cards ─── */
function updateAnalyticsSummary(relay, dateRange, data) {
  const total = data.reduce((s, v) => s + v, 0);
  const todayStr = moment().tz(IST_TIMEZONE).format('YYYY-MM-DD');
  const todayIdx = dateRange.indexOf(todayStr);
  const todayH = todayIdx !== -1 ? data[todayIdx] : 0;
  const peakIdx = data.indexOf(Math.max(...data));
  const peakLabel = peakIdx !== -1 ? moment(dateRange[peakIdx], 'YYYY-MM-DD').format('ddd D') : '—';

  const el = (id, val) => { const e = document.getElementById(id); if (e) e.textContent = val; };
  el('asTotalHours', total.toFixed(1) + 'h');
  el('asTodayHours', todayH.toFixed(2) + 'h');
  el('asPeakDay', peakLabel + (data[peakIdx] > 0 ? ` (${data[peakIdx].toFixed(1)}h)` : ''));
}

function clearAnalyticsSummary() {
  ['asTotalHours','asTodayHours','asPeakDay'].forEach(id => {
    const e = document.getElementById(id); if (e) e.textContent = '--';
  });
}

/* ─── Voice query: parse usage intent ─── */
function parseUsageVoiceQuery(norm) {
  // Keywords: kitne ghante, usage, kitna chala, how long, hours
  const usageKw = ['kitne ghante', 'kitna chala', 'usage', 'how long', 'how many hours', 'ghante chala', 'kitni der', 'usage batao', 'report'];
  const hasUsageKw = usageKw.some(kw => norm.includes(kw));
  if (!hasUsageKw) return null;

  // Try to match a relay key or alias
  const relayKeys = Object.keys(relays).filter(k => k && k !== 'undefined' && k.trim());
  for (const key of relayKeys) {
    const alias = getAlias(key).toLowerCase();
    if (norm.includes(key.toLowerCase()) || norm.includes(alias)) {
      return key;
    }
    // Partial match
    const words = alias.split(/\s+/);
    if (words.some(w => w.length > 2 && norm.includes(w))) return key;
  }
  // If only one relay, return it
  if (relayKeys.length === 1) return relayKeys[0];
  return '__UNSPECIFIED__';
}

/* ─── Voice response for usage ─── */
function getVoiceUsageSummary(relayKey) {
  if (relayKey === '__UNSPECIFIED__') return '📊 Kaun sa relay? Please specify relay name.';
  const todayStr = moment().tz(IST_TIMEZONE).format('YYYY-MM-DD');
  const cached = (_usageDataCache[relayKey] || {})[todayStr] || 0;
  const session = _relayOnSince[relayKey] ? (Date.now() - _relayOnSince[relayKey]) / 3600000 : 0;
  const total = cached + session;
  const label = getAlias(relayKey);
  if (total < 0.01) return `📊 ${label}: Aaj abhi tak koi usage nahi.`;
  return `📊 ${label}: Aaj ${total.toFixed(2)} ghante chala.`;
}

/* ─── Auto-refresh chart every 60s (for live session tracking) ─── */
setInterval(() => {
  const relay = document.getElementById('analyticsRelaySelect')?.value;
  if (relay && relays[relay] === true && _relayOnSince[relay]) {
    loadUsageChart(); // refresh to show live session
  }
}, 60000);
