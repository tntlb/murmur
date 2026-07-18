'use strict';

// The correction learning loop. When the user edits a transcript in History,
// we diff their fix against what was heard, keep the substitution pairs, and
// apply them to every future transcript. Pairs fixed twice promote their
// corrected term into the dictionary.

const MAX_PAIRS = 100;
const MAX_RUN_WORDS = 4;

function tokenize(text) {
  return String(text).trim().split(/\s+/).filter(Boolean);
}

function lcsTable(a, b) {
  const dp = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  return dp;
}

// Case-sensitive word diff, so "cloud code" -> "Claude Code" comes out as one
// phrase-level pair instead of a risky single-word swap.
function diffPairs(oldText, newText) {
  const a = tokenize(oldText);
  const b = tokenize(newText);
  const dp = lcsTable(a, b);
  const pairs = [];
  let fromRun = [];
  let toRun = [];
  const flush = () => {
    if (fromRun.length && toRun.length) {
      const from = fromRun.join(' ');
      const to = toRun.join(' ');
      const caseOnly = from.toLowerCase() === to.toLowerCase();
      // A single-word capitalization tweak is style, not a mishearing, and
      // would make a dangerously broad replacement rule.
      if (from !== to && !(caseOnly && fromRun.length === 1) &&
          fromRun.length <= MAX_RUN_WORDS && toRun.length <= MAX_RUN_WORDS) {
        pairs.push({ from, to });
      }
    }
    fromRun = [];
    toRun = [];
  };
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      flush();
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      fromRun.push(a[i]);
      i++;
    } else {
      toRun.push(b[j]);
      j++;
    }
  }
  while (i < a.length) fromRun.push(a[i++]);
  while (j < b.length) toRun.push(b[j++]);
  flush();
  return pairs;
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Deterministic pass over a fresh transcript: case-insensitive, whole-word.
// Runs even when Smart formatting is off.
function applyCorrections(text, pairs) {
  let out = text;
  for (const { from, to } of pairs || []) {
    if (!from || !to) continue;
    const re = new RegExp(`(?<![\\w])${escapeRegex(from)}(?![\\w])`, 'gi');
    out = out.replace(re, to);
  }
  return out;
}

// Merges new pairs into the stored list, bumping counts for repeats and
// promoting twice-fixed terms into the dictionary.
function learn(oldText, newText, current) {
  const pairs = diffPairs(oldText, newText);
  const corrections = (current.corrections || []).map((c) => ({ ...c }));
  const dictionary = (current.dictionary || []).slice();
  const promoted = [];
  for (const p of pairs) {
    let entry = corrections.find(
      (c) => c.from.toLowerCase() === p.from.toLowerCase() && c.to === p.to
    );
    if (entry) {
      entry.count += 1;
      entry.ts = Date.now();
    } else {
      entry = { ...p, count: 1, ts: Date.now() };
      corrections.push(entry);
    }
    if (entry.count >= 2 && !dictionary.some((w) => w.toLowerCase() === p.to.toLowerCase())) {
      dictionary.push(p.to);
      promoted.push(p.to);
    }
  }
  corrections.sort((x, y) => y.ts - x.ts);
  corrections.length = Math.min(corrections.length, MAX_PAIRS);
  return { pairs, corrections, dictionary, promoted };
}

module.exports = { diffPairs, applyCorrections, learn };
