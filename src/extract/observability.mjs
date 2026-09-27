// How you find out it broke. docs/SPEC.md §3B, and question 5 of the six.
//
// The architect skill splits this question in two and the split is the whole point: what RECORDS
// the failure, and what PUSHES to you. "A log nobody opens is not an alert." So every surface here
// carries one of two kinds, `records` or `pushes`, and derive keeps them in separate sentences. A
// system with ten log lines and nothing that pushes has answered half the question, and the report
// should say which half.
//
// `console.log` is deliberately not a surface. It records nothing anyone reads after the fact, and
// counting it would let a repo look instrumented because it is chatty.

import { languageOf, maskComments } from './text.mjs';

const RECORDING = /\b(console|logger|log|logging|LOGGER|_logger|self\.logger)\.(error|warn|warning|exception|critical|fatal)\s*\(/g;

const PUSHING_CALLS = [
  /\bSentry\.captureException\s*\(/g,
  /\bSentry\.captureMessage\s*\(/g,
  /\bsentry_sdk\.capture_exception\s*\(/g,
  /\bsentry_sdk\.capture_message\s*\(/g,
  /\bpagerduty[A-Za-z_]*\.(?:trigger|createIncident)\s*\(/g,
];

// Hosts whose only purpose is to interrupt a human. Finding one in the text is the strongest
// evidence a text scan can offer that something actually pushes.
const PUSHING_HOSTS = ['hooks.slack.com', 'events.pagerduty.com', 'discord.com/api/webhooks', 'api.telegram.org', 'api.pushover.net'];

export function extractObservability(path, text) {
  const language = languageOf(path);
  if (language === null) return { surfaces: [] };

  const lines = maskComments(text, language).split('\n');
  const found = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];

    for (const match of line.matchAll(RECORDING)) {
      found.push({ kind: 'records', name: `${match[1]}.${match[2]}`, line: index + 1 });
    }

    for (const pattern of PUSHING_CALLS) {
      for (const match of line.matchAll(pattern)) {
        found.push({ kind: 'pushes', name: match[0].replace(/\s*\($/, ''), line: index + 1 });
      }
    }

    for (const host of PUSHING_HOSTS) {
      if (line.includes(host)) found.push({ kind: 'pushes', name: host, line: index + 1 });
    }
  }

  // First citation wins, so one row per distinct surface.
  const first = new Map();
  for (const surface of found.sort((a, b) => a.line - b.line || a.name.localeCompare(b.name))) {
    if (first.has(surface.name)) continue;
    first.set(surface.name, { ...surface, path, cite: `${path}:${surface.line}` });
  }

  return { surfaces: [...first.values()] };
}
