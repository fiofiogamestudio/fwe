const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const DEFAULT_TEST_HOST = '127.0.0.1';

const {
  buildApiErrorPayload,
  listFiles,
  loadAppConfig,
  main,
  parseArgs,
  readDomainFile,
  startServer,
  writeDomainFile
} = require('../src/server');

test('API error payload preserves structured validation issues', () => {
  const error = Object.assign(new Error('Validation failed.'), {
    status: 400,
    issues: [
      { path: 'items[0].id', message: 'ID is required.' },
      { path: 'items[1].name', message: 'Name is required.', level: 'warning' }
    ]
  });

  assert.deepEqual(buildApiErrorPayload(error), {
    error: 'Validation failed.',
    issues: error.issues
  });
  assert.deepEqual(buildApiErrorPayload(new Error('Plain failure.')), {
    error: 'Plain failure.'
  });
});

test('FWE_NO_BROWSER keeps batch launches headless even when they request --open', () => {
  assert.equal(parseArgs(['--open'], { FWE_NO_BROWSER: '1' }).open, false);
  assert.equal(parseArgs([], { FWE_OPEN_BROWSER: '1' }).open, true);
  assert.equal(parseArgs(['--no-open'], { FWE_OPEN_BROWSER: '1' }).open, false);
});

test('built-in folder-json source lists, reads, and writes inside its workspace', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fwe-server-test-'));
  const workspace = path.join(root, 'workspace');
  const dataDir = path.join(workspace, 'items');
  fs.mkdirSync(dataDir, { recursive: true });
  writeJson(path.join(dataDir, 'items.json'), { items: [{ id: 1, name: 'One' }] });
  writeJson(path.join(root, 'domain.fwe.json'), {
    id: 'items',
    kind: 'table',
    title: 'Items',
    source: { type: 'folder-json', path: 'items' },
    model: { type: 'table', rows: 'items', rowId: 'id' },
    columns: ['id', 'name']
  });
  writeJson(path.join(root, 'app.fwe.json'), {
    id: 'test-app',
    title: 'Test',
    workspace: './workspace',
    domains: ['./domain.fwe.json']
  });
  const previous = process.cwd();
  process.chdir(root);
  t.after(() => {
    process.chdir(previous);
    fs.rmSync(root, { recursive: true, force: true });
  });
  const app = loadAppConfig('app.fwe.json');
  const domain = app.domains[0];
  assert.deepEqual(listFiles(app, domain).map((file) => file.name), ['items.json']);
  assert.equal(readDomainFile(app, domain, 'items.json').data.items[0].name, 'One');

  writeDomainFile(app, domain, 'items.json', { data: { items: [{ id: 1, name: 'Changed' }] } });
  assert.equal(readJson(path.join(dataDir, 'items.json')).items[0].name, 'Changed');
});

test('custom source revision tokens round-trip through read and write results', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fwe-source-revision-test-'));
  fs.mkdirSync(path.join(root, 'workspace'), { recursive: true });
  fs.writeFileSync(path.join(root, 'revision-source.js'), [
    'module.exports = function register(fwe) {',
    "  fwe.registerSource('revision-source', {",
    "    list() { return [{ name: 'data.json', exists: true }]; },",
    "    read() { return { name: 'data.json', type: 'json', data: { value: 1 }, revision: 'rev-1' }; },",
    '    write(ctx, name, payload) {',
    "      if (payload.revision !== 'rev-1') throw new Error('revision was not forwarded');",
    "      return { ok: true, name, revision: 'rev-2' };",
    '    }',
    '  });',
    '};',
    ''
  ].join('\n'), 'utf8');
  writeJson(path.join(root, 'domain.fwe.json'), {
    id: 'revision-data',
    kind: 'document',
    title: 'Revision data',
    source: { type: 'revision-source', path: '.' },
    model: { type: 'object' }
  });
  writeJson(path.join(root, 'app.fwe.json'), {
    id: 'revision-test-app',
    title: 'Revision Test',
    workspace: './workspace',
    extensions: ['./revision-source.js'],
    domains: ['./domain.fwe.json']
  });
  const previous = process.cwd();
  process.chdir(root);
  t.after(() => {
    process.chdir(previous);
    fs.rmSync(root, { recursive: true, force: true });
  });

  const app = loadAppConfig('app.fwe.json');
  const domain = app.domains[0];
  const opened = await readDomainFile(app, domain, 'data.json');
  assert.equal(opened.revision, 'rev-1');
  const saved = await writeDomainFile(app, domain, 'data.json', {
    data: opened.data,
    revision: opened.revision
  });
  assert.equal(saved.revision, 'rev-2');
});

test('CLI reuses the running app and rejects a different app on the same port', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fwe-start-test-'));
  const workspace = path.join(root, 'workspace');
  fs.mkdirSync(workspace, { recursive: true });
  writeJson(path.join(root, 'domain.fwe.json'), {
    id: 'settings',
    kind: 'document',
    title: 'Settings',
    source: { type: 'single-json', path: '.', fileName: 'settings.json' },
    model: { type: 'object' }
  });
  const appPath = path.join(root, 'app.fwe.json');
  const otherAppPath = path.join(root, 'other.fwe.json');
  writeJson(appPath, {
    id: 'start-test',
    title: 'Start Test',
    workspace: './workspace',
    domains: ['./domain.fwe.json']
  });
  writeJson(otherAppPath, {
    id: 'other-start-test',
    title: 'Other Start Test',
    workspace: './workspace',
    domains: ['./domain.fwe.json']
  });

  const app = loadAppConfig(appPath);
  const server = await startServer(app, DEFAULT_TEST_HOST, 0, { open: false });
  const port = server.address().port;
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(root, { recursive: true, force: true });
  });

  await main(['--app', appPath, '--host', DEFAULT_TEST_HOST, '--port', String(port), '--no-open']);
  await assert.rejects(
    main(['--app', otherAppPath, '--host', DEFAULT_TEST_HOST, '--port', String(port), '--no-open']),
    /already serving "Start Test"/
  );
});

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJson(file, data) {
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}
