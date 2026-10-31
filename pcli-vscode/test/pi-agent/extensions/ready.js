import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

export default function (pi) {
  pi.on('session_start', () => {
    writeFileSync(join(process.env.PI_CODING_AGENT_DIR, `pcli-ready-${process.pid}`), '');
  });
}
