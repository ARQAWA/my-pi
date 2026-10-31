import { appendFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export default function (pi) {
  pi.on('session_start', (_event, ctx) => {
    const file = join(process.env.PI_CODING_AGENT_DIR, `pcli-ready-${process.pid}`);
    ctx.ui.onTerminalInput((data) => { appendFileSync(file, JSON.stringify(data) + '\n'); });
    writeFileSync(file, '');
  });
}
