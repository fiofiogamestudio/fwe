#!/usr/bin/env node

const { main } = require('../src/server');

main(process.argv.slice(2)).catch((error) => {
  console.error(`[fwe] ${error.stack || error.message || error}`);
  process.exit(1);
});
