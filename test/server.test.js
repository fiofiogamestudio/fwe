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
  requestPublicApp,
  reuseRunningApp,
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

test('an older same-id server without a launch revision is rejected', () => {
  assert.throws(
    () => reuseRunningApp(
      { id: 'test-app', title: 'Test App', labels: {}, launchRevision: 'current' },
      { id: 'test-app', title: 'Test App', labels: {} },
      'http://127.0.0.1:3219',
      3219
    ),
    /outdated server/
  );
});

test('app navigation validates workspace sections against domain collections', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fwe-navigation-test-'));
  fs.mkdirSync(path.join(root, 'workspace'), { recursive: true });
  writeJson(path.join(root, 'workspace', 'content.json'), { items: [] });
  writeJson(path.join(root, 'content.fwe.json'), {
    id: 'content',
    kind: 'document',
    title: 'Content',
    source: { type: 'single-json', path: 'content.json' },
    model: { type: 'object' },
    workbench: { collections: [{ id: 'items', path: 'items' }] }
  });
  writeJson(path.join(root, 'app.fwe.json'), {
    id: 'navigation-test',
    workspace: './workspace',
    domains: ['./content.fwe.json'],
    navigation: {
      defaultWorkspace: 'authoring',
      defaultSection: 'items',
      workspaces: [{
        id: 'authoring',
        label: 'Authoring',
        sections: [{ id: 'items', label: 'Items', domain: 'content', collection: 'items', hideFile: true }]
      }]
    }
  });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const app = loadAppConfig(path.join(root, 'app.fwe.json'));
  assert.deepEqual(app.navigation, {
    defaultWorkspaceId: 'authoring',
    defaultSectionId: 'items',
    workspaces: [{
      id: 'authoring',
      label: 'Authoring',
      sections: [{
        id: 'items',
        label: 'Items',
        group: '',
        domainId: 'content',
        collectionId: 'items',
        hideFile: true
      }]
    }]
  });

  const invalid = readJson(path.join(root, 'app.fwe.json'));
  invalid.navigation.workspaces[0].sections[0].collection = 'missing';
  writeJson(path.join(root, 'app.fwe.json'), invalid);
  assert.throws(() => loadAppConfig(path.join(root, 'app.fwe.json')), /unknown collection: content\/missing/);
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

test('built-in sources reject stale revisions without overwriting external changes', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fwe-built-in-revision-test-'));
  const workspace = path.join(root, 'workspace');
  const file = path.join(workspace, 'settings.json');
  fs.mkdirSync(workspace, { recursive: true });
  writeJson(file, { value: 1 });
  writeJson(path.join(root, 'domain.fwe.json'), {
    id: 'settings',
    kind: 'document',
    title: 'Settings',
    source: { type: 'single-json', path: 'settings.json' },
    model: { type: 'object' }
  });
  writeJson(path.join(root, 'app.fwe.json'), {
    id: 'built-in-revision-test',
    workspace: './workspace',
    domains: ['./domain.fwe.json']
  });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const app = loadAppConfig(path.join(root, 'app.fwe.json'));
  const domain = app.domains[0];
  const opened = readDomainFile(app, domain, 'settings.json');
  assert.ok(opened.revision);

  writeJson(file, { value: 2 });
  assert.throws(
    () => writeDomainFile(app, domain, 'settings.json', {
      data: { value: 3 },
      revision: opened.revision
    }),
    (error) => error.status === 409 && error.issues?.[0]?.code === 'revision-conflict'
  );
  assert.deepEqual(readJson(file), { value: 2 });

  const refreshed = readDomainFile(app, domain, 'settings.json');
  const saved = writeDomainFile(app, domain, 'settings.json', {
    data: { value: 3 },
    revision: refreshed.revision
  });
  assert.ok(saved.revision);
  assert.notEqual(saved.revision, refreshed.revision);
  assert.deepEqual(readJson(file), { value: 3 });
});

test('custom sources receive automatic revisions when providers omit them', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fwe-auto-revision-test-'));
  const workspace = path.join(root, 'workspace');
  fs.mkdirSync(workspace, { recursive: true });
  writeJson(path.join(workspace, 'data.json'), { value: 1 });
  fs.writeFileSync(path.join(root, 'source.js'), [
    'module.exports = function register(fwe) {',
    "  fwe.registerSource('auto-revision', {",
    "    list() { return [{ name: 'data.json', exists: true }]; },",
    "    read(ctx) { return { name: 'data.json', type: 'json', data: ctx.readJson('data.json') }; },",
    "    write(ctx, name, payload) { ctx.writeJson('data.json', payload.data); return { name }; }",
    '  });',
    '};',
    ''
  ].join('\n'), 'utf8');
  writeJson(path.join(root, 'domain.fwe.json'), {
    id: 'data',
    kind: 'document',
    source: { type: 'auto-revision', path: '.' },
    model: { type: 'object' }
  });
  writeJson(path.join(root, 'app.fwe.json'), {
    id: 'auto-revision-test',
    workspace: './workspace',
    extensions: ['./source.js'],
    domains: ['./domain.fwe.json']
  });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const app = loadAppConfig(path.join(root, 'app.fwe.json'));
  const domain = app.domains[0];
  const opened = await readDomainFile(app, domain, 'data.json');
  assert.ok(opened.revision);

  writeJson(path.join(workspace, 'data.json'), { value: 2 });
  await assert.rejects(
    writeDomainFile(app, domain, 'data.json', {
      data: { value: 3 },
      revision: opened.revision
    }),
    (error) => error.status === 409 && error.issues?.[0]?.code === 'revision-conflict'
  );
  assert.deepEqual(readJson(path.join(workspace, 'data.json')), { value: 2 });

  const refreshed = await readDomainFile(app, domain, 'data.json');
  const saved = await writeDomainFile(app, domain, 'data.json', {
    data: { value: 3 },
    revision: refreshed.revision
  });
  assert.ok(saved.revision);
  assert.notEqual(saved.revision, refreshed.revision);
  assert.deepEqual(readJson(path.join(workspace, 'data.json')), { value: 3 });
});

test('multi-json writes prepare every file before replacing any target', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fwe-multi-json-transaction-test-'));
  const workspace = path.join(root, 'workspace');
  fs.mkdirSync(workspace, { recursive: true });
  writeJson(path.join(workspace, 'first.json'), { value: 1 });
  fs.writeFileSync(path.join(workspace, 'blocked'), 'not a directory', 'utf8');
  writeJson(path.join(root, 'domain.fwe.json'), {
    id: 'aggregate',
    kind: 'document',
    source: {
      type: 'multi-json',
      fileName: 'aggregate.json',
      files: {
        first: { path: 'first.json', target: 'first' },
        second: { path: 'blocked/second.json', target: 'second' }
      }
    },
    model: { type: 'object' },
    defaults: { data: { first: {}, second: {} } }
  });
  writeJson(path.join(root, 'app.fwe.json'), {
    id: 'multi-json-transaction-test',
    workspace: './workspace',
    domains: ['./domain.fwe.json']
  });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const app = loadAppConfig(path.join(root, 'app.fwe.json'));
  const domain = app.domains[0];
  const opened = readDomainFile(app, domain, 'aggregate.json');
  assert.throws(() => writeDomainFile(app, domain, 'aggregate.json', {
    data: { first: { value: 2 }, second: { value: 2 } },
    revision: opened.revision
  }));
  assert.deepEqual(readJson(path.join(workspace, 'first.json')), { value: 1 });
  assert.equal(fs.readdirSync(workspace).some((name) => name.endsWith('.tmp') || name.endsWith('.bak')), false);
});

test('custom source revision tokens round-trip through read and write results', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fwe-source-revision-test-'));
  fs.mkdirSync(path.join(root, 'workspace'), { recursive: true });
  fs.writeFileSync(path.join(root, 'revision-source.js'), [
    'module.exports = function register(fwe) {',
    "  fwe.registerSource('revision-source', {",
    "    list() { return [{ name: 'data.json', exists: true }]; },",
    "    read() { return { name: 'data.json', type: 'json', data: { value: 1 }, revision: 'rev-1', meta: { source: 'base' } }; },",
    '    write(ctx, name, payload) {',
    "      if (payload.revision !== 'rev-1') throw new Error('revision was not forwarded');",
    "      return { ok: true, name, revision: 'rev-2', meta: { source: 'mod' } };",
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
  assert.deepEqual(opened.meta, { source: 'base' });
  const saved = await writeDomainFile(app, domain, 'data.json', {
    data: opened.data,
    revision: opened.revision
  });
  assert.equal(saved.revision, 'rev-2');
  assert.deepEqual(saved.meta, { source: 'mod' });
});

test('browser session ids reach source providers and extension APIs independently', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fwe-session-context-test-'));
  const workspace = path.join(root, 'workspace');
  fs.mkdirSync(workspace, { recursive: true });
  fs.writeFileSync(path.join(root, 'session-source.js'), [
    'module.exports = function register(fwe) {',
    "  fwe.registerSource('session-source', {",
    "    list(ctx) { return [{ name: `${ctx.sessionId}.json`, exists: true }]; },",
    "    read(ctx) { return { name: `${ctx.sessionId}.json`, type: 'json', data: { sessionId: ctx.sessionId } }; }",
    '  });',
    "  fwe.registerApi('/api/session-probe', ({ sessionId, req, url, sendJson }) => {",
    "    if (req.method !== 'GET' || url.pathname !== '/api/session-probe') return false;",
    '    sendJson(200, { sessionId });',
    '    return true;',
    '  });',
    '};',
    ''
  ].join('\n'), 'utf8');
  writeJson(path.join(root, 'domain.fwe.json'), {
    id: 'session-data',
    kind: 'document',
    title: 'Session data',
    source: { type: 'session-source' },
    model: { type: 'object' }
  });
  writeJson(path.join(root, 'app.fwe.json'), {
    id: 'session-test-app',
    title: 'Session Test',
    workspace: './workspace',
    extensions: ['./session-source.js'],
    domains: ['./domain.fwe.json']
  });

  const app = loadAppConfig(path.join(root, 'app.fwe.json'));
  const server = await startServer(app, DEFAULT_TEST_HOST, 0, { open: false });
  const port = server.address().port;
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(root, { recursive: true, force: true });
  });

  const request = async (url, sessionId) => {
    const response = await fetch(`http://${DEFAULT_TEST_HOST}:${port}${url}`, {
      headers: { 'X-FWE-Session': sessionId }
    });
    return { status: response.status, body: await response.json() };
  };
  for (const sessionId of ['browser-session-a', 'browser-session-b']) {
    const files = await request('/api/domains/session-data/files', sessionId);
    assert.equal(files.status, 200);
    assert.deepEqual(files.body.files.map((file) => file.name), [`${sessionId}.json`]);
    const opened = await request(`/api/domains/session-data/files/${sessionId}.json`, sessionId);
    assert.equal(opened.body.data.sessionId, sessionId);
    const extension = await request('/api/session-probe', sessionId);
    assert.equal(extension.body.sessionId, sessionId);
  }

  const invalid = await request('/api/session-probe', 'bad id');
  assert.equal(invalid.status, 400);
  assert.match(invalid.body.error, /Invalid X-FWE-Session/);
});

test('CLI reuses only the same app launch revision', async (t) => {
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
  const extensionPath = path.join(root, 'extension.js');
  fs.writeFileSync(extensionPath, 'module.exports = function setup() {};\n', 'utf8');
  writeJson(appPath, {
    id: 'start-test',
    title: 'Start Test',
    workspace: './workspace',
    extensions: ['./extension.js'],
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

  const runningApp = await requestPublicApp(`http://${DEFAULT_TEST_HOST}:${port}`);
  assert.equal(runningApp.launchRevision, app.launchRevision);
  await main(['--app', appPath, '--host', DEFAULT_TEST_HOST, '--port', String(port), '--no-open']);

  writeJson(path.join(workspace, 'settings.json'), { changed: true });
  assert.equal(loadAppConfig(appPath).launchRevision, app.launchRevision);

  fs.writeFileSync(extensionPath, 'module.exports = function changedSetup() {};\n', 'utf8');
  assert.notEqual(loadAppConfig(appPath).launchRevision, app.launchRevision);
  await assert.rejects(
    main(['--app', appPath, '--host', DEFAULT_TEST_HOST, '--port', String(port), '--no-open']),
    /outdated server/
  );
  await assert.rejects(
    main(['--app', otherAppPath, '--host', DEFAULT_TEST_HOST, '--port', String(port), '--no-open']),
    /already serving "Start Test"/
  );
});

test('launch revision includes shared extension dependencies inside the workspace', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fwe-shared-extension-revision-test-'));
  const workspace = path.join(root, 'workspace');
  const appDir = path.join(workspace, 'editor');
  const sharedDir = path.join(workspace, 'shared');
  fs.mkdirSync(appDir, { recursive: true });
  fs.mkdirSync(sharedDir, { recursive: true });
  const sharedPath = path.join(sharedDir, 'shared.js');
  const extensionPath = path.join(appDir, 'extension.js');
  fs.writeFileSync(sharedPath, 'module.exports = { value: 1 };\n', 'utf8');
  fs.writeFileSync(extensionPath, "const shared = require('../shared/shared'); module.exports = function setup() { return shared.value; };\n", 'utf8');
  writeJson(path.join(appDir, 'domain.fwe.json'), {
    id: 'settings',
    kind: 'document',
    source: { type: 'single-json', path: '.', fileName: 'settings.json' },
    model: { type: 'object' }
  });
  const appPath = path.join(appDir, 'app.fwe.json');
  writeJson(appPath, {
    id: 'shared-revision-test',
    workspace: '..',
    extensions: ['./extension.js'],
    domains: ['./domain.fwe.json']
  });
  const previous = process.cwd();
  process.chdir(appDir);
  t.after(() => {
    process.chdir(previous);
    fs.rmSync(root, { recursive: true, force: true });
  });

  const before = loadAppConfig(appPath).launchRevision;
  fs.writeFileSync(sharedPath, 'module.exports = { value: 2 };\n', 'utf8');
  delete require.cache[require.resolve(sharedPath)];
  delete require.cache[require.resolve(extensionPath)];
  const after = loadAppConfig(appPath).launchRevision;
  assert.notEqual(after, before);
});

test('launch revisions do not inherit modules from previously loaded applications', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fwe-launch-revision-isolation-test-'));
  const workspace = path.join(root, 'workspace');
  const appDirs = [path.join(workspace, 'app-a'), path.join(workspace, 'app-b')];
  appDirs.forEach((appDir, index) => {
    fs.mkdirSync(appDir, { recursive: true });
    fs.writeFileSync(path.join(appDir, 'extension.js'), `module.exports = function setup${index}() {};\n`, 'utf8');
    writeJson(path.join(appDir, 'domain.fwe.json'), {
      id: `settings-${index}`,
      kind: 'document',
      source: { type: 'single-json', path: '.', fileName: 'settings.json' },
      model: { type: 'object' }
    });
    writeJson(path.join(appDir, 'app.fwe.json'), {
      id: `revision-app-${index}`,
      workspace: '..',
      extensions: ['./extension.js'],
      domains: ['./domain.fwe.json']
    });
  });
  t.after(() => {
    for (const appDir of appDirs) {
      const extensionPath = path.join(appDir, 'extension.js');
      try {
        delete require.cache[require.resolve(extensionPath)];
      } catch {
        // The extension may already have been evicted by another config load.
      }
    }
    fs.rmSync(root, { recursive: true, force: true });
  });

  const appBPath = path.join(appDirs[1], 'app.fwe.json');
  const before = loadAppConfig(appBPath).launchRevision;
  loadAppConfig(path.join(appDirs[0], 'app.fwe.json'));
  const after = loadAppConfig(appBPath).launchRevision;

  assert.equal(after, before);
});

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJson(file, data) {
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}
