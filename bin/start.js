#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { main, parseArgs, loadAppConfig } = require('../src/server');

function physicalPath(target) {
  for (let cursor = path.resolve(target);; cursor = path.dirname(cursor)) {
    try {
      if (fs.lstatSync(cursor).isSymbolicLink()) throw new Error(`Demo path cannot use a link: ${cursor}`);
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (path.dirname(cursor) === cursor) break;
  }
}

function prepareStartup(argv, root = path.resolve(__dirname, '..'), env = process.env) {
  const args = parseArgs(argv, env);
  const explicitApp = argv.includes('--app') || Boolean(env.FWE_APP);
  if (explicitApp || args.help || args.explain || args.compare.length) return ['--open', ...argv];
  const examples = path.join(root, 'examples');
  const demo = path.join(root, '.local', 'demo');
  const appPath = path.join(demo, 'app.fwe.json');
  physicalPath(demo);
  if (!fs.existsSync(demo)) {
    const app = loadAppConfig(path.join(examples, 'app.fwe.json'));
    const port = Number(args.port || app.port || 3219);
    if (!Number.isInteger(port) || port <= 0 || port > 65535) throw new Error(`Invalid port: ${args.port}`);
    if (args.check) {
      console.log(`[fwe] First launch will copy the example to ${demo}; check did not create it.`);
      return ['--app', path.join(examples, 'app.fwe.json'), '--open', ...argv];
    }
    fs.cpSync(examples, demo, { recursive: true, errorOnExist: true, force: false });
  }
  if (!fs.existsSync(appPath)) throw new Error(`Demo is incomplete: ${demo}. Select an existing app with --app; no files were overwritten.`);
  return ['--app', appPath, '--open', ...argv];
}

if (require.main === module) {
  Promise.resolve().then(() => main(prepareStartup(process.argv.slice(2)))).catch(error => {
    console.error(`[fwe] ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { prepareStartup };
