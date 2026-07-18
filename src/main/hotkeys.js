'use strict';

// Hold-to-talk needs global keydown AND keyup, which Electron's globalShortcut
// cannot see. uiohook-napi ships prebuilt N-API binaries for win32-x64, so it
// needs no compiler; if it still fails to load on some machine, Murmur runs in
// toggle-only mode and Settings says so.

let uio = null;
let Key = null;
let tried = false;
let hookStarted = false;

// The hold key can be a chord (e.g. Ctrl + Shift): recording starts when every
// key in the chord is down and stops when any of them is released.
let holdKeycodes = [];
let chordActive = false;
let onHoldDown = null;
let onHoldUp = null;
const held = new Set();
let capture = null; // { keys: number[], resolve, timer }

function load() {
  if (tried) return uio;
  tried = true;
  try {
    const mod = require('uiohook-napi');
    uio = mod.uIOhook;
    Key = mod.UiohookKey;
    uio.on('keydown', (e) => {
      held.add(e.keycode);
      if (capture) {
        if (!capture.keys.includes(e.keycode)) capture.keys.push(e.keycode);
        return;
      }
      if (
        holdKeycodes.length &&
        !chordActive &&
        holdKeycodes.includes(e.keycode) &&
        holdKeycodes.every((k) => held.has(k))
      ) {
        chordActive = true;
        if (onHoldDown) onHoldDown();
      }
    });
    uio.on('keyup', (e) => {
      held.delete(e.keycode);
      if (capture) {
        // First release ends the capture; whatever was pressed is the chord.
        if (capture.keys.length) {
          const { keys, resolve, timer } = capture;
          capture = null;
          clearTimeout(timer);
          resolve({ keycodes: keys, label: keys.map(labelFor).join(' + ') });
        }
        return;
      }
      if (chordActive && holdKeycodes.includes(e.keycode)) {
        chordActive = false;
        if (onHoldUp) onHoldUp();
      }
    });
  } catch (err) {
    console.error('hotkeys: uiohook-napi unavailable, hold-to-talk disabled:', err.message);
    uio = null;
  }
  return uio;
}

function available() {
  return !!load();
}

const LABEL_OVERRIDES = {
  CtrlRight: 'Right Ctrl',
  CtrlLeft: 'Left Ctrl',
  ShiftRight: 'Right Shift',
  ShiftLeft: 'Left Shift',
  AltRight: 'Right Alt',
  AltLeft: 'Left Alt',
  MetaRight: 'Right Win',
  MetaLeft: 'Left Win',
  CapsLock: 'Caps Lock',
  Backquote: '`',
};

function labelFor(keycode) {
  if (!Key) return `Key ${keycode}`;
  for (const [name, code] of Object.entries(Key)) {
    if (code === keycode) return LABEL_OVERRIDES[name] || name;
  }
  return `Key ${keycode}`;
}

function ensureStarted() {
  if (!load()) return false;
  if (!hookStarted) {
    uio.start();
    hookStarted = true;
  }
  return true;
}

function bindHold(keycodes, downCb, upCb) {
  holdKeycodes = Array.isArray(keycodes) ? keycodes.slice() : [keycodes];
  onHoldDown = downCb;
  onHoldUp = upCb;
  return ensureStarted();
}

function unbindHold() {
  holdKeycodes = [];
  chordActive = false;
}

// Resolves with the next key or chord pressed anywhere: capture collects every
// key that goes down and finishes on the first release. Used by Settings.
function captureNextKey(timeoutMs = 10000) {
  if (!ensureStarted()) return Promise.reject(new Error('hold-to-talk unavailable on this machine'));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      if (capture) {
        capture = null;
        reject(new Error('capture timed out'));
      }
    }, timeoutMs);
    capture = { keys: [], resolve, timer };
  });
}

function stop() {
  if (uio && hookStarted) {
    try { uio.stop(); } catch {}
    hookStarted = false;
  }
}

module.exports = { available, bindHold, unbindHold, captureNextKey, labelFor, stop };
