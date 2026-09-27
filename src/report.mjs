// Rendering the reconcile report. docs/SPEC.md §3G.
//
// Two rules shape this file. Every one of the seven sections is printed even when it is empty,
// because an absent heading reads as "nothing to say" when it means "never checked". And a finding
// is never printed without its citation, because the only reason a heuristic tool is allowed to be
// wrong is that the reader can go and look.

export const SECTION_ORDER = [
  ['unnamedPieces', 'Pieces present in code the map does not name'],
  ['undeclaredEdges', 'Edges present the map omits'],
  ['undeclaredEnv', 'Env vars read that section 3 never lists'],
  ['unpricedClients', 'Metered clients section 4 never prices'],
  ['vanishedSurfaces', 'Alert and log surfaces that vanished'],
  ['drift', 'Drift since the committed baseline'],
];

export const LIMITS_HEADING = 'What this run could not see';

function dayOf(now) {
  return now.slice(0, 10);
}

export function renderReconcile(outcome, { now }) {
  const lines = [];

  lines.push(`# system-map reconcile — ${dayOf(now)}`);
  lines.push('');

  // What this run read, before anything it concluded. A report that does not name its inputs cannot be
  // told apart from one that read the wrong ones, which is exactly what happened: `reconcile ../repo`
  // compared one repo's code against another project's design and the report looked entirely normal.
  if (outcome.inputs.length > 0) {
    lines.push('## What this run read');
    lines.push('');
    for (const input of outcome.inputs) {
      const size = input.bytes === null ? '' : ` — ${input.bytes} bytes`;
      lines.push(`- **${input.label}** \`${input.path}\`${size}${input.present ? '' : ' — **not found**'}`);
    }
    lines.push('');
  }

  lines.push(
    outcome.verdict === 'cannot-judge'
      ? 'This run could not read enough to judge. The sections below are incomplete, and the gaps are named at the bottom.'
      : outcome.findings === 0
        ? 'The declared design and the code agree, and nothing moved since the committed baseline.'
        : `${outcome.findings} finding${outcome.findings === 1 ? '' : 's'}. Every line below cites the file it came from.`,
  );
  lines.push('');

  for (const [key, heading] of SECTION_ORDER) {
    const findings = outcome.sections[key] ?? [];
    lines.push(`## ${heading}`);
    lines.push('');

    if (findings.length === 0) {
      lines.push('_None._');
      lines.push('');
      continue;
    }

    for (const finding of findings) {
      lines.push(`- \`${finding.id}\` — ${finding.detail} (${finding.cite ?? 'no citation'})`);
    }
    lines.push('');
  }

  lines.push(`## ${LIMITS_HEADING}`);
  lines.push('');

  const blocking = outcome.gaps.filter((gap) => gap.tier === 'BLOCKING');
  const noted = outcome.gaps.filter((gap) => gap.tier === 'NOTED');

  if (blocking.length === 0 && noted.length === 0 && outcome.limits.length === 0) {
    lines.push('_Nothing. Every file the walk named opened, the declared document parsed, and the committed baseline was read._');
    lines.push('');
  } else {
    if (blocking.length > 0) {
      lines.push('**Blocking — the verdict above is not trustworthy until these are fixed.**');
      lines.push('');
      for (const gap of blocking) lines.push(`- \`${gap.code}\` — ${gap.detail} (${gap.cite ?? gap.path})`);
      lines.push('');
    }

    if (noted.length > 0) {
      lines.push('**Noted — known limits of reading a repo as text. These do not change the verdict.**');
      lines.push('');
      for (const gap of noted) lines.push(`- \`${gap.code}\` — ${gap.detail} (${gap.cite ?? gap.path})`);
      lines.push('');
    }

    if (outcome.limits.length > 0) {
      lines.push('**Declared, but not found or not understood.**');
      lines.push('');
      for (const limit of outcome.limits) lines.push(`- ${limit}`);
      lines.push('');
    }
  }

  lines.push('---');
  lines.push('');
  lines.push(
    `Exit ${outcome.exitCode}: ${
      { 0: 'read what it needed, no drift', 1: 'drift found, and the run was trustworthy', 3: 'could not read enough to judge' }[outcome.exitCode]
    }.`,
  );
  lines.push('');

  return lines.join('\n');
}
