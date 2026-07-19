'use strict';

// macOS insertion. Same two methods and the same line protocol as the
// Windows PowerShell helper (ping, paste, type:<base64>), served by one
// persistent osascript child running a JXA read loop:
//   paste: clipboard swap + System Events keystroke "v" using command down
//   type:  literal System Events keystrokes, for apps that block paste
// Both need the Accessibility permission (System Settings, Privacy &
// Security, Accessibility); main.js detects and guides. No native modules,
// no per-insert process spawn latency: osascript ships with macOS.

const { spawn } = require('child_process');
const { clipboard } = require('electron');

// NSFileHandle gives unbuffered pipe I/O, so responses stream line by line
// instead of arriving in one flush at exit. Verified: first reply ~85ms
// (includes osascript boot), later replies single-digit ms.
const JXA_SCRIPT = `
ObjC.import('Foundation');
const stdin = $.NSFileHandle.fileHandleWithStandardInput;
const stdout = $.NSFileHandle.fileHandleWithStandardOutput;
function writeLine(s) {
  stdout.writeData($(s + '\\n').dataUsingEncoding($.NSUTF8StringEncoding));
}
function fromBase64(s) {
  const data = $.NSData.alloc.initWithBase64EncodedStringOptions(s, 0);
  if (data.isNil()) return null;
  return $.NSString.alloc.initWithDataEncoding(data, $.NSUTF8StringEncoding).js;
}
let se = null;
function systemEvents() {
  if (!se) se = Application('System Events');
  return se;
}
// Newlines and tabs are keys, not characters, to System Events; everything
// else keystrokes through as literal text.
function typeText(text) {
  const lines = text.split('\\n');
  for (let i = 0; i < lines.length; i++) {
    if (i > 0) systemEvents().keyCode(36); // return
    const cells = lines[i].split('\\t');
    for (let j = 0; j < cells.length; j++) {
      if (j > 0) systemEvents().keyCode(48); // tab
      if (cells[j]) systemEvents().keystroke(cells[j]);
    }
  }
}
let buf = '';
while (true) {
  const data = stdin.availableData;
  if (data.length == 0) break;
  buf += $.NSString.alloc.initWithDataEncoding(data, $.NSUTF8StringEncoding).js;
  let idx;
  while ((idx = buf.indexOf('\\n')) >= 0) {
    const line = buf.slice(0, idx).trim();
    buf = buf.slice(idx + 1);
    if (!line) continue;
    try {
      if (line === 'ping') {
        writeLine('ok');
      } else if (line === 'paste') {
        systemEvents().keystroke('v', { using: 'command down' });
        writeLine('ok');
      } else if (line.indexOf('type:') === 0) {
        const text = fromBase64(line.slice(5));
        if (text === null) { writeLine('err:bad payload'); continue; }
        typeText(text);
        writeLine('ok');
      } else {
        writeLine('err:unknown command');
      }
    } catch (e) {
      writeLine('err:' + (e.message || String(e)));
    }
  }
}
`;

let osa = null;
let pending = [];
let stdoutBuf = '';

function ensureHelper() {
  if (osa) return;
  osa = spawn('osascript', ['-l', 'JavaScript', '-e', JXA_SCRIPT], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  osa.stdout.on('data', (d) => {
    stdoutBuf += d.toString('utf8');
    let idx;
    while ((idx = stdoutBuf.indexOf('\n')) >= 0) {
      const line = stdoutBuf.slice(0, idx).trim();
      stdoutBuf = stdoutBuf.slice(idx + 1);
      const waiter = pending.shift();
      if (waiter) {
        if (line === 'ok') waiter.resolve();
        else waiter.reject(new Error(line.replace(/^err:/, '') || 'keystroke helper error'));
      }
    }
  });
  osa.on('exit', () => {
    const waiters = pending;
    pending = [];
    osa = null;
    stdoutBuf = '';
    for (const w of waiters) w.reject(new Error('keystroke helper exited'));
  });
}

function send(command, timeoutMs = 15000) {
  ensureHelper();
  return new Promise((resolve, reject) => {
    const waiter = { resolve, reject };
    pending.push(waiter);
    const timer = setTimeout(() => {
      const i = pending.indexOf(waiter);
      if (i >= 0) pending.splice(i, 1);
      reject(new Error('keystroke helper timed out'));
    }, timeoutMs);
    waiter.resolve = (v) => { clearTimeout(timer); resolve(v); };
    waiter.reject = (e) => { clearTimeout(timer); reject(e); };
    osa.stdin.write(command + '\n');
  });
}

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

async function insert(text, s) {
  if (!text) return;
  if (s.insertMethod === 'type') {
    const payload = Buffer.from(text.replace(/\r\n/g, '\n'), 'utf8').toString('base64');
    await send(`type:${payload}`, 60000);
    return;
  }
  const previous = clipboard.readText();
  clipboard.writeText(text);
  await delay(80);
  try {
    await send('paste');
  } finally {
    if (s.restoreClipboard) {
      // Give the target app time to read the clipboard before restoring.
      await delay(600);
      clipboard.writeText(previous);
    }
  }
}

async function ping() {
  await send('ping', 8000);
  return true;
}

// Exercises the full command dispatch at runtime: an unknown command must
// come back as exactly 'unknown command'. A JXA parse or runtime error in
// the helper surfaces here as a different message instead.
async function probeChain() {
  try {
    await send('murmur-probe-unknown', 8000);
    return 'no-error';
  } catch (err) {
    return err.message;
  }
}

function dispose() {
  if (osa) {
    try { osa.stdin.end(); } catch {}
    try { osa.kill(); } catch {}
    osa = null;
  }
}

module.exports = { insert, ping, probeChain, dispose };
