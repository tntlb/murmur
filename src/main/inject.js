'use strict';

// Inserts text into whatever app has focus. Two methods:
//   paste: clipboard swap + synthesized Ctrl+V, then clipboard restore
//   type:  literal SendKeys typing, for apps that block paste
// Keystrokes come from one persistent PowerShell child (SendKeys via
// System.Windows.Forms), so there is no native module and no per-insert
// process spawn latency.

const { spawn } = require('child_process');
const { clipboard } = require('electron');

// A real multi-line script passed via -EncodedCommand, so PowerShell parses
// it exactly as written. (An earlier version joined these lines with
// semicolons, which breaks if/elseif chains at runtime.)
const PS_SCRIPT = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
while ($true) {
  $l = [Console]::In.ReadLine()
  if ($null -eq $l) { break }
  try {
    if ($l -eq 'ping') {
      [Console]::Out.WriteLine('ok')
    } elseif ($l -eq 'paste') {
      [System.Windows.Forms.SendKeys]::SendWait('^v')
      [Console]::Out.WriteLine('ok')
    } elseif ($l.StartsWith('type:')) {
      $b = [Convert]::FromBase64String($l.Substring(5))
      $t = [System.Text.Encoding]::UTF8.GetString($b)
      [System.Windows.Forms.SendKeys]::SendWait($t)
      [Console]::Out.WriteLine('ok')
    } else {
      [Console]::Out.WriteLine('err:unknown command')
    }
  } catch {
    [Console]::Out.WriteLine('err:' + $_.Exception.Message)
  }
}
`;
const PS_ENCODED = Buffer.from(PS_SCRIPT, 'utf16le').toString('base64');

let ps = null;
let pending = [];
let stdoutBuf = '';

function ensureHelper() {
  if (ps) return;
  ps = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Sta', '-EncodedCommand', PS_ENCODED], {
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  ps.stdout.on('data', (d) => {
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
  ps.on('exit', () => {
    const waiters = pending;
    pending = [];
    ps = null;
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
    ps.stdin.write(command + '\n');
  });
}

// SendKeys treats + ^ % ~ ( ) { } [ ] as commands; wrap them in braces.
function escapeSendKeys(text) {
  let out = '';
  for (const ch of text.replace(/\r\n/g, '\n')) {
    if (ch === '\n') out += '{ENTER}';
    else if (ch === '\t') out += '{TAB}';
    else if ('+^%~(){}[]'.includes(ch)) out += `{${ch}}`;
    else out += ch;
  }
  return out;
}

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

async function insert(text, s) {
  if (!text) return;
  if (s.insertMethod === 'type') {
    const payload = Buffer.from(escapeSendKeys(text), 'utf8').toString('base64');
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

// Exercises the full if/elseif/else chain at runtime: an unknown command must
// come back as exactly 'unknown command'. A broken chain surfaces a PowerShell
// parse or term error here instead, which is how the elseif bug was caught.
async function probeChain() {
  try {
    await send('murmur-probe-unknown', 8000);
    return 'no-error';
  } catch (err) {
    return err.message;
  }
}

function dispose() {
  if (ps) {
    try { ps.stdin.end(); } catch {}
    try { ps.kill(); } catch {}
    ps = null;
  }
}

module.exports = { insert, ping, probeChain, dispose, escapeSendKeys };
