'use strict';

// Local usage analytics, ported from VFlow: one JSONL line per dictation in
// userData/analytics.jsonl with duration, word count, models, and estimated
// cost. Read by the Analytics tab, cleared from there, gated by the
// analyticsEnabled setting in main. Nothing is ever sent anywhere.

const fs = require('fs');
const path = require('path');
const { app } = require('electron');

// Pay-as-you-go rates, verified against groq.com/pricing on 2026-07-19.
// Unknown models (local servers, alternate endpoints) estimate as $0, which
// is exactly what a local server costs.
const STT_RATES_PER_HOUR = {
  'whisper-large-v3-turbo': 0.04,
  'whisper-large-v3': 0.111,
  'distil-whisper-large-v3-en': 0.02,
};
const LLM_RATES_PER_M = {
  'llama-3.1-8b-instant': { in: 0.05, out: 0.08 },
  'openai/gpt-oss-20b': { in: 0.075, out: 0.30 },
  'openai/gpt-oss-120b': { in: 0.15, out: 0.60 },
  'llama-3.3-70b-versatile': { in: 0.59, out: 0.79 },
};

let filePath = null;

function init(overridePath) {
  filePath = overridePath || path.join(app.getPath('userData'), 'analytics.jsonl');
}

// A dictation's formatter call is roughly the transcript in and the cleaned
// transcript out (~1.4 tokens per word) plus the system prompt (~200 tokens).
function estimateCost(seconds, words, model, formatModel) {
  const stt = ((STT_RATES_PER_HOUR[model] || 0) * seconds) / 3600;
  let llm = 0;
  const rate = LLM_RATES_PER_M[formatModel];
  if (rate) {
    const t = words * 1.4;
    llm = ((200 + t) * rate.in + t * rate.out) / 1e6;
  }
  return stt + llm;
}

function add({ seconds, words, model, formatModel }) {
  const event = {
    ts: Date.now(),
    seconds: Math.max(0, Math.round(seconds * 10) / 10),
    words,
    model,
    formatModel: formatModel || null,
    cost: estimateCost(seconds, words, model, formatModel),
  };
  try {
    fs.appendFileSync(filePath, JSON.stringify(event) + '\n');
  } catch (err) {
    console.error('analytics: could not append:', err.message);
  }
  return event;
}

function list() {
  try {
    if (!fs.existsSync(filePath)) return [];
    return fs.readFileSync(filePath, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => { try { return JSON.parse(line); } catch { return null; } })
      .filter(Boolean);
  } catch (err) {
    console.error('analytics: could not read:', err.message);
    return [];
  }
}

function clear() {
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch (err) {
    console.error('analytics: could not clear:', err.message);
  }
}

module.exports = { init, add, list, clear, estimateCost };
