'use strict';

const $ = (id) => document.getElementById(id);

let S = null;    // settings
let META = null; // { version, holdAvailable, userDataPath }

// ---------------------------------------------------------------- helpers

function toast(message, ms = 4500) {
  const el = $('toast');
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { el.hidden = true; }, ms);
}

async function save(partial) {
  const { settings, error } = await window.murmur.setSettings(partial);
  S = settings;
  if (error) {
    toast(error);
    render();
  }
}

function prettyAccelerator(acc) {
  return acc.replace(/Control/g, 'Ctrl').replace(/\+/g, ' + ');
}

// ---------------------------------------------------------------- render

function render() {
  $('holdEnabled').checked = S.holdEnabled;
  $('holdKeyBtn').textContent = S.holdKeyLabel;
  $('toggleBtn').textContent = prettyAccelerator(S.toggleShortcut);
  $('insertMethod').value = S.insertMethod;
  $('restoreClipboard').checked = S.restoreClipboard;
  $('sounds').checked = S.sounds;
  $('launchAtLogin').checked = S.launchAtLogin;
  $('maxSeconds').value = String(S.maxSeconds);
  if (document.activeElement !== $('apiKey')) $('apiKey').value = S.apiKey;
  if (document.activeElement !== $('baseUrl')) $('baseUrl').value = S.baseUrl;
  if (document.activeElement !== $('model')) $('model').value = S.model;
  if (document.activeElement !== $('formatModel')) $('formatModel').value = S.formatModel;
  $('smartFormat').checked = S.smartFormat;
  $('language').value = S.language;
  $('historyEnabled').checked = S.historyEnabled;
  renderChips();

  $('verLine').textContent = `v${META.version}`;
  $('aboutVersion').textContent = META.version;
  $('aboutData').textContent = META.userDataPath;
  $('holdStatus').textContent = META.holdAvailable ? 'HOLD KEY · READY' : 'HOLD KEY · UNAVAILABLE';
  $('holdUnavailable').hidden = META.holdAvailable;
  $('holdKeyBtn').disabled = !META.holdAvailable;
  $('obHoldKey').textContent = S.holdKeyLabel;
  $('obToggle').textContent = prettyAccelerator(S.toggleShortcut);
}

// ---------------------------------------------------------------- tabs

document.querySelectorAll('.nav-item').forEach((btn) => {
  btn.addEventListener('click', () => gotoTab(btn.dataset.tab));
});

function gotoTab(tab) {
  document.querySelectorAll('.nav-item').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('.panel').forEach((p) => p.classList.toggle('active', p.dataset.panel === tab));
  if (tab === 'history') refreshHistory();
  if (tab === 'voice') populateMics();
}

window.murmur.on('goto-tab', gotoTab);

// ---------------------------------------------------------------- bindings

const bindCheck = (id, key) => $(id).addEventListener('change', (e) => save({ [key]: e.target.checked }));
const bindValue = (id, key, transform = (v) => v) =>
  $(id).addEventListener('change', (e) => save({ [key]: transform(e.target.value) }));

bindCheck('holdEnabled', 'holdEnabled');
bindCheck('restoreClipboard', 'restoreClipboard');
bindCheck('sounds', 'sounds');
bindCheck('launchAtLogin', 'launchAtLogin');
bindCheck('smartFormat', 'smartFormat');
bindCheck('historyEnabled', 'historyEnabled');
bindValue('insertMethod', 'insertMethod');
bindValue('maxSeconds', 'maxSeconds', Number);
bindValue('language', 'language');
bindValue('apiKey', 'apiKey', (v) => v.trim());
bindValue('baseUrl', 'baseUrl', (v) => v.trim().replace(/\/$/, ''));
bindValue('model', 'model', (v) => v.trim());
bindValue('formatModel', 'formatModel', (v) => v.trim());
bindValue('micSelect', 'micDeviceId');

// toggle shortcut capture (DOM keydown -> Electron accelerator)
const CODE_MAP = { Space: 'Space', Comma: ',', Period: '.', Slash: '/', Backquote: '`', Minus: '-', Equal: '=', Semicolon: ';', Quote: "'", BracketLeft: '[', BracketRight: ']', Backslash: '\\' };

$('toggleBtn').addEventListener('click', () => {
  const btn = $('toggleBtn');
  btn.classList.add('listening');
  btn.textContent = 'press keys...';
  const onKey = (e) => {
    e.preventDefault();
    if (e.key === 'Escape') return cleanup();
    if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return;
    const mods = [];
    if (e.ctrlKey) mods.push('Control');
    if (e.altKey) mods.push('Alt');
    if (e.shiftKey) mods.push('Shift');
    if (e.metaKey) mods.push('Super');
    let key = null;
    if (/^Key[A-Z]$/.test(e.code)) key = e.code.slice(3);
    else if (/^Digit\d$/.test(e.code)) key = e.code.slice(5);
    else if (/^F\d{1,2}$/.test(e.code)) key = e.code;
    else if (CODE_MAP[e.code]) key = CODE_MAP[e.code];
    if (!key) return;
    if (!mods.length && !/^F\d{1,2}$/.test(key)) { toast('Add a modifier (Ctrl, Alt, Shift) or use an F-key.'); return; }
    cleanup();
    save({ toggleShortcut: [...mods, key].join('+') });
  };
  const cleanup = () => {
    window.removeEventListener('keydown', onKey, true);
    btn.classList.remove('listening');
    render();
  };
  window.addEventListener('keydown', onKey, true);
});

// hold key capture (global, via uiohook in main)
$('holdKeyBtn').addEventListener('click', async () => {
  const btn = $('holdKeyBtn');
  btn.classList.add('listening');
  btn.textContent = 'press any key...';
  try {
    const { keycode, label } = await window.murmur.captureHoldKey();
    await save({ holdKeycode: keycode, holdKeyLabel: label });
  } catch {
    toast('Key capture timed out.');
  }
  btn.classList.remove('listening');
  render();
});

// ---------------------------------------------------------------- connection test

async function runTest(statusEl) {
  statusEl.hidden = false;
  statusEl.className = 'row-note mono';
  statusEl.textContent = 'TESTING...';
  const { ok, message } = await window.murmur.testConnection();
  statusEl.textContent = (ok ? 'OK · ' : 'FAILED · ') + message;
  statusEl.classList.add(ok ? 'status-ok' : 'status-err');
  return ok;
}

$('testBtn').addEventListener('click', async () => {
  if (document.activeElement === $('apiKey')) $('apiKey').blur();
  await save({ apiKey: $('apiKey').value.trim() });
  runTest($('testStatus'));
});

// ---------------------------------------------------------------- microphone

async function populateMics() {
  try {
    // A quick permission grab so device labels are readable.
    const tmp = await navigator.mediaDevices.getUserMedia({ audio: true });
    tmp.getTracks().forEach((t) => t.stop());
    const devices = await navigator.mediaDevices.enumerateDevices();
    const mics = devices.filter((d) => d.kind === 'audioinput' && d.deviceId !== 'communications');
    const sel = $('micSelect');
    sel.replaceChildren();
    const def = document.createElement('option');
    def.value = 'default';
    def.textContent = 'System default';
    sel.appendChild(def);
    for (const m of mics) {
      if (m.deviceId === 'default') continue;
      const opt = document.createElement('option');
      opt.value = m.deviceId;
      opt.textContent = m.label || 'Microphone';
      sel.appendChild(opt);
    }
    sel.value = [...sel.options].some((o) => o.value === S.micDeviceId) ? S.micDeviceId : 'default';
  } catch {
    toast('Could not list microphones. Check Windows microphone privacy settings.');
  }
}

let meterStream = null;
let meterRaf = 0;

$('micTestBtn').addEventListener('click', async () => {
  if (meterStream) return stopMeter();
  try {
    const audio = S.micDeviceId !== 'default' ? { deviceId: { exact: S.micDeviceId } } : true;
    meterStream = await navigator.mediaDevices.getUserMedia({ audio });
  } catch {
    toast('Could not open the microphone. Check Windows privacy settings.');
    return;
  }
  $('meter').hidden = false;
  $('micTestBtn').textContent = 'Stop';
  const ac = new AudioContext();
  const an = ac.createAnalyser();
  an.fftSize = 512;
  ac.createMediaStreamSource(meterStream).connect(an);
  const data = new Uint8Array(an.fftSize);
  const tick = () => {
    an.getByteTimeDomainData(data);
    let sum = 0;
    for (let i = 0; i < data.length; i++) { const v = (data[i] - 128) / 128; sum += v * v; }
    $('meterFill').style.width = `${Math.min(100, Math.sqrt(sum / data.length) * 300)}%`;
    meterRaf = requestAnimationFrame(tick);
  };
  tick();
  stopMeter._ac = ac;
});

function stopMeter() {
  cancelAnimationFrame(meterRaf);
  if (meterStream) meterStream.getTracks().forEach((t) => t.stop());
  if (stopMeter._ac) stopMeter._ac.close().catch(() => {});
  meterStream = null;
  $('meter').hidden = true;
  $('meterFill').style.width = '0%';
  $('micTestBtn').textContent = 'Check level';
}

// ---------------------------------------------------------------- dictionary

function renderChips() {
  const wrap = $('chips');
  wrap.replaceChildren();
  $('dictEmpty').hidden = S.dictionary.length > 0;
  S.dictionary.forEach((word, i) => {
    const chip = document.createElement('span');
    chip.className = 'chip';
    const text = document.createElement('span');
    text.textContent = word;
    const x = document.createElement('button');
    x.textContent = '✕';
    x.title = `Remove ${word}`;
    x.addEventListener('click', () => {
      const next = S.dictionary.slice();
      next.splice(i, 1);
      save({ dictionary: next }).then(render);
    });
    chip.append(text, x);
    wrap.appendChild(chip);
  });
}

$('dictInput').addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  const word = e.target.value.trim();
  if (!word) return;
  if (S.dictionary.some((w) => w.toLowerCase() === word.toLowerCase())) {
    e.target.value = '';
    return;
  }
  save({ dictionary: [...S.dictionary, word] }).then(render);
  e.target.value = '';
});

// ---------------------------------------------------------------- history

async function refreshHistory() {
  const items = await window.murmur.historyList();
  const list = $('historyList');
  list.replaceChildren();
  $('historyEmpty').hidden = items.length > 0;
  for (const item of items) {
    const row = document.createElement('div');
    row.className = 'h-item';
    const text = document.createElement('div');
    text.className = 'h-text';
    text.textContent = item.text;
    text.title = item.text;
    const meta = document.createElement('div');
    meta.className = 'h-meta';
    const when = new Date(item.ts);
    meta.textContent = `${when.toLocaleDateString()} ${when.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · ${item.words}w`;
    const actions = document.createElement('div');
    actions.className = 'h-actions';
    const copy = document.createElement('button');
    copy.className = 'btn';
    copy.textContent = 'Copy';
    copy.addEventListener('click', async () => {
      await navigator.clipboard.writeText(item.text);
      copy.textContent = 'Copied';
      setTimeout(() => { copy.textContent = 'Copy'; }, 1200);
    });
    const del = document.createElement('button');
    del.className = 'btn subtle';
    del.textContent = '✕';
    del.title = 'Delete';
    del.addEventListener('click', async () => {
      await window.murmur.historyDelete(item.id);
      refreshHistory();
    });
    actions.append(copy, del);
    row.append(text, meta, actions);
    list.appendChild(row);
  }
}

$('clearHistory').addEventListener('click', async () => {
  await window.murmur.historyClear();
  refreshHistory();
});

window.murmur.on('history-changed', () => {
  if (document.querySelector('.panel[data-panel="history"]').classList.contains('active')) refreshHistory();
});

// ---------------------------------------------------------------- onboarding

$('obTest').addEventListener('click', async () => {
  await save({ apiKey: $('obKey').value.trim() });
  $('apiKey').value = S.apiKey;
  runTest($('obStatus'));
});

$('obDone').addEventListener('click', async () => {
  if ($('obKey').value.trim() && $('obKey').value.trim() !== S.apiKey) {
    await save({ apiKey: $('obKey').value.trim() });
  }
  await save({ onboarded: true });
  $('onboard').hidden = true;
});

// ---------------------------------------------------------------- misc

document.querySelectorAll('.link[data-href]').forEach((el) => {
  el.addEventListener('click', () => window.murmur.openExternal(el.dataset.href));
});

window.murmur.on('settings-changed', (settings) => {
  S = settings;
  render();
});

// ---------------------------------------------------------------- boot

(async function boot() {
  const { settings, meta } = await window.murmur.getSettings();
  S = settings;
  META = meta;
  render();
  populateMics();
  if (!S.onboarded) $('onboard').hidden = false;
})();
