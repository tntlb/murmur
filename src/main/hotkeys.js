'use strict';

// Hold-to-talk needs global keydown AND keyup, which Electron's globalShortcut
// cannot see. uiohook-napi ships prebuilt N-API binaries for win32-x64, so it
// needs no compiler; if it still fails to load on some machine, Murmur runs in
// toggle-only mode and Settings says so.

let uio = null;
let Key = null;
let tried = false;
let hookStarted = false;

let holdKeycode = null;
let holdDown = false;
let onHoldDown = null;
let onHoldUp = null;
let captureResolve = null;

function load() {
  if (tried) return uio;
  tried = true;
  try {
    const mod = require('uiohook-napi');
    uio = mod.uIOhook;
    Key = mod.UiohookKey;
    uio.on('keydown', (e) => {
      if (captureResolve) {
        const resolve = captureResolve;
        captureResolve = null;
        resolve({ keycode: e.keycode, label: labelFor(e.keycode) });
        return;
      }
      if (e.keycode === holdKeycode && !holdDown) {
        holdDown = true;
        if (onHoldDown) onHoldDown();
      }
    });
    uio.on('keyup', (e) => {
      if (e.keycode === holdKeycode && holdDown) {
        holdDown = false;
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

function bindHold(keycode, downCb, upCb) {
  holdKeycode = keycode;
  onHoldDown = downCb;
  onHoldUp = upCb;
  return ensureStarted();
}

function unbindHold() {
  holdKeycode = null;
  holdDown = false;
}

// Resolves with the next key pressed anywhere. Used by the Settings capture UI.
function captureNextKey(timeoutMs = 10000) {
  if (!ensureStarted()) return Promise.reject(new Error('hold-to-talk unavailable on this machine'));
  return new Promise((resolve, reject) => {
    captureResolve = resolve;
    setTimeout(() => {
      if (captureResolve) {
        captureResolve = null;
        reject(new Error('capture timed out'));
      }
    }, timeoutMs);
  });
}

function stop() {
  if (uio && hookStarted) {
    try { uio.stop(); } catch {}
    hookStarted = false;
  }
}

module.exports = { available, bindHold, unbindHold, captureNextKey, labelFor, stop };
