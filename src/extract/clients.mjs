// Third-party clients and external hosts. docs/SPEC.md §3B.
//
// Clients are not extracted from the text a second time: they are a READING of the edge list the
// import extractor already produced, against the registry. One pass, one citation, and a client
// that appears in the report always points at a real import statement.
//
// Hosts are the other half of egress, the calls that leave the machine without an SDK. Only a
// literal URL counts; a host assembled from variables is a NOTED limit, because inventing a name
// for it would put an uncited line in the map.

import { languageOf, maskComments } from './text.mjs';
import { lookupModule } from '../registry.mjs';

export function clientsFromEdges(edges) {
  const byName = new Map();

  for (const edge of edges) {
    const entry = lookupModule(edge.specifier);
    if (entry === null) continue;

    const existing = byName.get(entry.module);
    if (existing === undefined) {
      byName.set(entry.module, {
        name: entry.module,
        categories: [...entry.categories].sort(),
        note: entry.note,
        cites: [edge.cite],
      });
      continue;
    }
    existing.cites.push(edge.cite);
  }

  return [...byName.values()]
    .map((client) => {
      const cites = [...new Set(client.cites)].sort();
      return { ...client, cites, cite: cites[0] };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

// Loopback is not egress. A call to your own machine leaves no door open and bills nothing.
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1', '[::1]', 'host.docker.internal']);

const HOST_PATTERNS = [
  [/\bfetch\s*\(\s*(['"`])(https?:\/\/[^'"`\s]+)\1/g, 'fetch', 2],
  [/\b(?:requests)\.(?:get|post|put|patch|delete|head|request)\s*\(\s*(['"])(https?:\/\/[^'"\s]+)\1/g, 'requests', 2],
  [/\b(?:httpx)\.(?:get|post|put|patch|delete|head|request)\s*\(\s*(['"])(https?:\/\/[^'"\s]+)\1/g, 'httpx', 2],
  [/\baxios(?:\.(?:get|post|put|patch|delete))?\s*\(\s*(['"`])(https?:\/\/[^'"`\s]+)\1/g, 'axios', 2],
  [/\burlopen\s*\(\s*(['"])(https?:\/\/[^'"\s]+)\1/g, 'urlopen', 2],
];

export function extractHosts(path, text) {
  const language = languageOf(path);
  if (language === null) return { hosts: [] };

  const lines = maskComments(text, language).split('\n');
  const first = new Map();

  for (let index = 0; index < lines.length; index += 1) {
    for (const [pattern, via, group] of HOST_PATTERNS) {
      for (const match of lines[index].matchAll(pattern)) {
        let host;
        try {
          host = new URL(match[group]).hostname;
        } catch {
          continue;
        }
        if (host === '' || LOCAL_HOSTS.has(host)) continue;
        if (first.has(host)) continue;
        first.set(host, { host, via, line: index + 1, path, cite: `${path}:${index + 1}` });
      }
    }
  }

  return { hosts: [...first.values()].sort((a, b) => a.line - b.line || a.host.localeCompare(b.host)) };
}
