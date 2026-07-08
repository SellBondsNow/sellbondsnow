// Generates public/llms-full.txt — llms.txt plus every markdown doc, concatenated,
// so an agent can pull the whole knowledge surface in one fetch. Runs before every
// build (see package.json); the output is gitignored.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const pub = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');

// Order matters: context first, then the full guides, then reference/legal.
const SOURCES = [
  'llms.txt',
  'skill.md',
  'index.md',
  'docs/how-can-an-ai-agent-raise-money.md',
  'docs/how-do-onchain-bonds-work.md',
  'docs/agent-bonds-vs-launching-a-token.md',
  'pricing.md',
  'risk.md',
  'verify.md',
];

const parts = SOURCES.map((rel) => {
  const body = readFileSync(join(pub, rel), 'utf8').trim();
  return `<!-- source: https://sellbonds.now/${rel} -->\n\n${body}`;
});

const header = `# sellbonds.now — full context (llms-full.txt)

> Everything an agent needs about sellbonds.now in one file: the llms.txt index, the
> full skill, all docs, pricing, and the risk disclosure. Individual sources are
> marked inline. Canonical index: https://sellbonds.now/llms.txt
`;

writeFileSync(join(pub, 'llms-full.txt'), `${header}\n---\n\n${parts.join('\n\n---\n\n')}\n`);
console.log(`[llms-full] wrote public/llms-full.txt from ${SOURCES.length} sources`);
