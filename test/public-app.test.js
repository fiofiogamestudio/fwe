const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const appSource = fs.readFileSync(path.resolve(__dirname, '../public/app.js'), 'utf8');
const inspectorSource = fs.readFileSync(path.resolve(__dirname, '../public/inspector.js'), 'utf8');

test('domain actions.new=false disables both the visible command and createFile path', () => {
  const domainAllowsNewFile = loadFunction('domainAllowsNewFile');
  assert.equal(domainAllowsNewFile(null), false);
  assert.equal(domainAllowsNewFile({}), true);
  assert.equal(domainAllowsNewFile({ actions: {} }), true);
  assert.equal(domainAllowsNewFile({ actions: { new: true } }), true);
  assert.equal(domainAllowsNewFile({ actions: { new: false } }), false);

  assert.match(appSource, /setCommandVisible\(newButton, canCreateFile\)/);
  assert.match(appSource, /async function createFile\(\) \{\s*if \(!domainAllowsNewFile\(state\.domain\)\)/);
});

test('structured API diagnostics are normalized and deduplicated with local diagnostics', () => {
  const normalizeApiDiagnostics = loadFunction('normalizeApiDiagnostics');
  const mergeDiagnostics = loadFunction('mergeDiagnostics');
  const normalized = plain(normalizeApiDiagnostics([
    'General failure',
    { path: 'items[0].id', message: 'ID is required.' }
  ]));

  assert.deepEqual(normalized, [
    { path: '', message: 'General failure', level: 'error', source: 'server' },
    { path: 'items[0].id', message: 'ID is required.', level: 'error', source: 'server' }
  ]);
  assert.deepEqual(plain(mergeDiagnostics(
    [{ path: 'items[0].id', message: 'ID is required.', level: 'error' }],
    normalized
  )), [
    { path: 'items[0].id', message: 'ID is required.', level: 'error' },
    { path: '', message: 'General failure', level: 'error', source: 'server' }
  ]);
});

test('saveFile catches rejected writes and retains structured diagnostics', () => {
  const saveSource = readFunctionSource('saveFile');
  assert.match(saveSource, /catch \(error\)/);
  assert.match(saveSource, /state\.dirty = true/);
  assert.match(saveSource, /state\.serverDiagnostics = normalizeApiDiagnostics\(error\?\.issues\)/);
  assert.match(saveSource, /setStatus\(formatAppLabel\('saveFailedWithIssues'/);
  assert.match(appSource, /return mergeDiagnostics\(diagnostics, state\.serverDiagnostics\)/);
  assert.match(appSource, /error\.issues = normalizeApiDiagnostics\(data\.issues\)/);
});

test('open and save retain source revision tokens for optimistic concurrency', () => {
  const openSource = readFunctionSource('openSelectedFile');
  const saveSource = readFunctionSource('saveFile');
  assert.match(openSource, /result\.revision !== undefined/);
  assert.match(saveSource, /payload\.revision = state\.file\.revision/);
  assert.match(saveSource, /saved\?\.revision !== undefined/);
});

test('optional-object fields toggle the whole object and render configured child fields', () => {
  assert.match(inspectorSource, /field\.type === 'optional-object'/);
  assert.match(inspectorSource, /function renderInspectorOptionalObjectField\(field, target, context\)/);
  assert.match(inspectorSource, /clone\(configured\)/);
  assert.match(inspectorSource, /deleteByPath\(target, field\.path\)/);
  assert.match(inspectorSource, /\(field\.fields \|\| \[\]\)\.forEach/);
  assert.match(inspectorSource, /targetPath: joinPath\(context\.targetPath, field\.path\)/);
});

function loadFunction(name) {
  const context = {};
  vm.runInNewContext(`${readFunctionSource(name)}\nresult = ${name};`, context);
  return context.result;
}

function readFunctionSource(name) {
  const candidates = [`function ${name}(`, `async function ${name}(`];
  const start = candidates
    .map((candidate) => appSource.indexOf(candidate))
    .filter((index) => index >= 0)
    .sort((left, right) => left - right)[0];
  assert.notEqual(start, undefined, `Function ${name} is missing from app.js.`);
  const header = appSource.slice(start).match(/\)\s*\{/);
  assert.ok(header, `Function ${name} has no body in app.js.`);
  const open = start + header.index + header[0].lastIndexOf('{');
  let depth = 0;
  let quote = '';
  let escaped = false;
  for (let index = open; index < appSource.length; index += 1) {
    const char = appSource[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = '';
      continue;
    }
    if (char === "'" || char === '"' || char === '`') {
      quote = char;
      continue;
    }
    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) return appSource.slice(start, index + 1);
    }
  }
  throw new Error(`Function ${name} is incomplete in app.js.`);
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}
