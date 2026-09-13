'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { prepareStartup } = require('../bin/start');

test('example launcher checks without writing and preserves edited demo across launches', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fwe-launcher-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.cpSync(path.join(__dirname, '../examples'), path.join(root, 'examples'), { recursive: true });
  const before = fs.readFileSync(path.join(root, 'examples/app.fwe.json'));
  prepareStartup(['--check'], root, {});
  assert.equal(fs.existsSync(path.join(root, '.local')), false);
  const invocation = prepareStartup(['--no-open'], root, {});
  assert.equal(invocation[1], path.join(root, '.local/demo/app.fwe.json'));
  const saved = path.join(root, '.local/demo/workspace/launcher-preserved.txt');
  fs.writeFileSync(saved, 'user edits');
  prepareStartup([], root, {});
  assert.equal(fs.readFileSync(saved, 'utf8'), 'user edits');
  assert.deepEqual(fs.readFileSync(path.join(root, 'examples/app.fwe.json')), before);
});

test('explicit app and invalid launcher arguments do not create demo files', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fwe-launcher-options-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  assert.deepEqual(prepareStartup(['--app', 'project with spaces/app.json', '--check'], root, {}), ['--open', '--app', 'project with spaces/app.json', '--check']);
  assert.throws(() => prepareStartup(['--unknown'], root, {}), /Unknown argument/);
  assert.equal(fs.existsSync(path.join(root, '.local')), false);
});
