#!/usr/bin/env node
import { main } from '../src/cli.js';

main().catch((error) => {
  process.stderr.write(
    `Error: ${String(error.message).replace(/[\u0000-\u001f\u007f]/g, ' ')}\n`
  );
  process.exitCode = 1;
});
