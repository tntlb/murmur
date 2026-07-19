'use strict';

// Spoken text expansions, ported from VFlow: say a trigger phrase ("my
// email"), get the literal value. Applied deterministically at the very end
// of the pipeline, after transcription, corrections, and formatting, so the
// values never appear in any API request. Matching is whole-phrase with
// word boundaries and case-insensitive.

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function applyExpansions(text, list) {
  if (!text || !Array.isArray(list) || !list.length) return text;
  let out = text;
  for (const e of list) {
    if (!e || e.enabled === false || !e.trigger || !e.value) continue;
    const trigger = String(e.trigger).trim();
    if (!trigger) continue;
    // Lookarounds instead of \b so triggers work next to punctuation.
    const pattern = new RegExp(`(?<![\\w])${escapeRegExp(trigger)}(?![\\w])`, 'gi');
    out = out.replace(pattern, () => e.value);
  }
  return out;
}

module.exports = { applyExpansions };
