// Prints tests/golden.ts: the golden fingerprints of the seeded office day (tests/scenario.ts).
// Run from pixel-office/ (node only, so not type-checked; tests/ has no fs):
//   npx -y esbuild@0.24.0 tools/golden.ts --bundle --platform=node --format=cjs --log-level=error | node > tests/golden.ts
// Only remake the hashes after a change people can SEE that the user approved (Approved design in CLAUDE.md).

import { fingerprints } from '../tests/scenario'

const TICKS = 3000
const EVERY = 100
const t0 = Date.now()
const hashes = fingerprints(TICKS, EVERY)
console.error('golden: ' + hashes.length + ' hashes in ' + (Date.now() - t0) + ' ms')
console.log(
  [
    '// Made by tools/golden.ts: one hash per ' + EVERY + ' ticks of the seeded office day (tests/scenario.ts), of every',
    '// frame drawn (full office, two cameras, a short office, the list). Remake only for an approved change people can see.',
    '',
    'export const TICKS = ' + TICKS,
    'export const EVERY = ' + EVERY,
    'export const GOLDEN: readonly string[] = [',
    ...Array.from({ length: Math.ceil(hashes.length / 10) }, (_, k) => '  ' + hashes.slice(k * 10, k * 10 + 10).map(h => "'" + h + "'").join(', ') + ','),
    ']',
    '',
  ].join('\n'),
)
