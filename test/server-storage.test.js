const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const test = require('node:test');
const { loadAppConfig, readDomainFile, startServer, writeDomainFile } = require('../src/server');

const json = (file, data) => fs.writeFileSync(file, JSON.stringify(data), 'utf8');
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

function fixture(t, domains, extension = '') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fwe-storage-test-'));
  const workspace = path.join(root, 'workspace');
  fs.mkdirSync(workspace);
  const refs = domains.map((domain, index) => {
    const name = `domain-${index}.fwe.json`;
    json(path.join(root, name), { kind: 'document', model: { type: 'object' }, ...domain });
    return name;
  });
  if (extension) fs.writeFileSync(path.join(root, 'source.js'), extension, 'utf8');
  const appPath = path.join(root, 'app.fwe.json');
  json(appPath, { id: 'storage-test', workspace: './workspace', domains: refs, extensions: extension ? ['./source.js'] : [] });
  const app = loadAppConfig(appPath);
  t.after(() => {
    assert.equal(path.dirname(root), os.tmpdir());
    fs.rmSync(root, { recursive: true, force: true });
  });
  return { root, workspace, appPath, app };
}

async function httpFixture(t, domains, extension = '') {
  const context = fixture(t, domains, extension);
  const server = await startServer(context.app, '127.0.0.1', 0);
  t.after(async () => {
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
  });
  context.request = async (domain, name, method = 'GET', payload, session = 'storage-test') => {
    const route = `/api/domains/${domain}/files${name === null ? '' : `/${encodeURIComponent(name)}`}`;
    const response = await fetch(`http://127.0.0.1:${server.address().port}${route}`, {
      method,
      headers: { 'Content-Type': 'application/json', 'X-FWE-Session': session },
      ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
      signal: AbortSignal.timeout(5000)
    });
    return { status: response.status, body: await response.json() };
  };
  return context;
}

const customSource = `module.exports = (fwe) => fwe.registerSource('async-json', {
  async read(ctx, name) {
    if (!ctx.exists(name) && ctx.source.missingTemplate) return {exists:false, type:'json', data:{value:0}};
    const data = ctx.readJson(name);
    await new Promise(resolve => setTimeout(resolve, 20));
    return {name, type:'json', data};
  },
  async write(ctx, name, payload) {
    await new Promise(resolve => setTimeout(resolve, 20));
    if (payload.data.fail) throw Object.assign(new Error('Host rejected value'), {status:422});
    ctx.writeJson(name, payload.data);
    return {name};
  },
  async create(ctx, payload) {
    await new Promise(resolve => setTimeout(resolve, 20));
    ctx.writeJson(payload.name, payload.data);
    return {ok:true, name:payload.name};
  },
  delete(ctx, name) { ctx.fs.rmSync(ctx.resolveSourcePath(name)); return {ok:true,name}; }
});`;

for (const [type, kind, name, payload] of [
  ['folder-json', 'document', 'nested/new.json', { data: { value: 1 } }],
  ['single-json', 'document', 'single.json', { data: { value: 1 } }],
  ['folder-text', 'text', 'nested/new.txt', { content: 'hello\r\n' }],
  ['single-text', 'text', 'single.txt', { content: 'hello\r\n' }]
]) {
  test(`${type} creates missing files exclusively and rejects stale saves after deletion`, async (t) => {
    const folder = type.startsWith('folder');
    const context = await httpFixture(t, [{ id: 'data', kind, source: { type, path: folder ? 'data' : name } }]);
    const target = path.join(context.workspace, folder ? 'data' : '', name);
    const created = await context.request('data', name, 'PUT', { ...payload, createOnly: true });
    assert.equal(created.status, 200);
    assert.ok(created.body.revision);
    const original = fs.readFileSync(target, 'utf8');
    const conflict = await context.request('data', null, 'POST', { name, ...payload });
    assert.equal(conflict.status, 409);
    assert.equal(conflict.body.issues[0].code, 'file-exists');
    assert.equal(fs.readFileSync(target, 'utf8'), original);
    fs.rmSync(target);
    const missing = await context.request('data', name, 'PUT', { ...payload, revision: created.body.revision });
    assert.equal(missing.status, 409);
    assert.equal(missing.body.issues[0].code, 'revision-conflict');
    assert.equal(fs.existsSync(target), false);
  });
}

test('concurrent HTTP creates publish exactly one complete JSON document', async (t) => {
  const context = await httpFixture(t, [{ id: 'data', source: { type: 'folder-json', path: 'data' } }]);
  const results = await Promise.all([1, 2].map(value => context.request('data', null, 'POST', { name: 'race.json', data: { value } })));
  assert.deepEqual(results.map(result => result.status).sort(), [200, 409]);
  const winner = results.findIndex(result => result.status === 200) + 1;
  assert.deepEqual(readJson(path.join(context.workspace, 'data', 'race.json')), { value: winner });
  assert.deepEqual(fs.readdirSync(path.join(context.workspace, 'data')), ['race.json']);
});

test('text HTTP saves preserve CRLF, empty content, trailing whitespace, blank lines and BOM', async (t) => {
  const context = await httpFixture(t, [{ id: 'text', kind: 'text', source: { type: 'folder-text', path: '.' } }]);
  let revision;
  for (const content of ['hello\r\nworld\r\n', '', 'trailing \t  ', 'blank\n\n\n', '\ufeffBOM\r\n']) {
    const saved = await context.request('text', 'notes.txt', 'PUT', { content, ...(revision ? { revision } : { createOnly: true }) });
    assert.equal(saved.status, 200);
    revision = saved.body.revision;
    assert.equal(fs.readFileSync(path.join(context.workspace, 'notes.txt'), 'utf8'), content);
    const opened = await context.request('text', 'notes.txt');
    assert.equal(opened.body.content, content);
    assert.equal(opened.body.revision, revision);
  }
});

for (const type of ['single-json', 'single-text', 'multi-json']) {
  test(`${type} read revisions describe the returned snapshot, not a later disk read`, (t) => {
    const source = type === 'multi-json'
      ? { type, files: { first: 'first.json', second: 'second.json' } }
      : { type, path: type === 'single-text' ? 'first.txt' : 'first.json' };
    const context = fixture(t, [{ id: 'data', kind: type === 'single-text' ? 'text' : 'document', source }]);
    const target = path.join(context.workspace, type === 'single-text' ? 'first.txt' : 'first.json');
    fs.writeFileSync(target, type === 'single-text' ? 'original' : '[1]');
    json(path.join(context.workspace, 'second.json'), [9]);
    const domain = context.app.domains[0];
    const before = readDomainFile(context.app, domain, 'data');
    const originalRead = fs.readFileSync;
    let changed = false;
    fs.readFileSync = (file, options) => {
      const value = originalRead(file, options);
      if (file === target && !changed) {
        changed = true;
        fs.writeFileSync(target, type === 'single-text' ? 'external change' : '[2]');
      }
      return value;
    };
    let opened;
    try {
      opened = readDomainFile(context.app, domain, 'data');
    } finally {
      fs.readFileSync = originalRead;
    }
    assert.equal(changed, true);
    assert.equal(opened.revision, before.revision);
    assert.throws(() => writeDomainFile(context.app, domain, 'data', { revision: opened.revision, data: {}, content: 'edit' }), error => error.status === 409);
  });

  test(`${type} save revisions describe published content, not an external replacement`, (t) => {
    const source = type === 'multi-json'
      ? { type, files: { first: 'first.json', second: 'second.json' } }
      : { type, path: type === 'single-text' ? 'first.txt' : 'first.json' };
    const context = fixture(t, [{ id: 'data', kind: type === 'single-text' ? 'text' : 'document', source }]);
    const target = path.join(context.workspace, type === 'single-text' ? 'first.txt' : 'first.json');
    const payload = type === 'single-text' ? { content: 'original' } : { data: type === 'multi-json' ? { first: [1], second: [9] } : [1] };
    const domain = context.app.domains[0];
    const before = writeDomainFile(context.app, domain, 'data', { ...payload, createOnly: true });
    const originalRename = fs.renameSync;
    let changed = false;
    fs.renameSync = (from, to) => {
      const result = originalRename(from, to);
      if (to === target && from.endsWith('.tmp')) {
        changed = true;
        fs.writeFileSync(target, type === 'single-text' ? 'external change' : '[2]');
      }
      return result;
    };
    let saved;
    try {
      saved = writeDomainFile(context.app, domain, 'data', { ...payload, revision: before.revision });
    } finally {
      fs.renameSync = originalRename;
    }
    assert.equal(changed, true);
    assert.equal(saved.revision, before.revision);
    assert.throws(() => writeDomainFile(context.app, domain, 'data', { ...payload, revision: saved.revision }), error => error.status === 409);
  });
}

test('create publication does not replace a target created after its existence check', (t) => {
  const context = fixture(t, [{ id: 'data', source: { type: 'folder-json', path: '.' } }]);
  const target = path.join(context.workspace, 'race.json');
  const originalLink = fs.linkSync;
  fs.linkSync = (source, destination) => {
    if (destination === target) json(target, { owner: 'concurrent-writer' });
    return originalLink(source, destination);
  };
  try {
    assert.throws(() => writeDomainFile(context.app, context.app.domains[0], 'race.json', { createOnly: true, data: { owner: 'fwe' } }), error => error.status === 409);
  } finally {
    fs.linkSync = originalLink;
  }
  assert.deepEqual(readJson(target), { owner: 'concurrent-writer' });
  assert.deepEqual(fs.readdirSync(context.workspace), ['race.json']);
});

test('separate FWE processes cannot overwrite each other during exclusive creation', async (t) => {
  const context = fixture(t, [{ id: 'data', source: { type: 'folder-json', path: '.' } }]);
  const serverPath = require.resolve('../src/server');
  const program = `const {loadAppConfig,writeDomainFile}=require(process.argv[1]);
    const app=loadAppConfig(process.argv[2]); process.stdout.write('ready\\n');
    process.stdin.once('data',()=>{try {const saved=writeDomainFile(app,app.domains[0],'race.json',{createOnly:true,data:{value:Number(process.argv[3])}}); console.log(JSON.stringify({status:200,revision:saved.revision}));}
    catch(error){console.log(JSON.stringify({status:error.status||500}));} process.stdin.destroy();});`;
  const children = [1, 2].map(value => {
    const child = spawn(process.execPath, ['-e', program, serverPath, context.appPath, String(value)], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    t.after(() => { if (child.exitCode === null) child.kill(); });
    let stdout = '';
    let stderr = '';
    let readyResolve;
    const ready = new Promise(resolve => { readyResolve = resolve; });
    child.stdout.on('data', chunk => { stdout += chunk; if (stdout.includes('ready\n')) readyResolve(); });
    child.stderr.on('data', chunk => { stderr += chunk; });
    const closed = new Promise((resolve, reject) => {
      const timer = setTimeout(() => { child.kill(); reject(new Error('Create child timed out')); }, 5000);
      child.on('error', error => { clearTimeout(timer); reject(error); });
      child.on('close', code => {
        clearTimeout(timer);
        if (code !== 0) reject(new Error(`Create child failed: ${code}: ${stderr}`));
        else resolve(JSON.parse(stdout.trim().split('\n').at(-1)));
      });
    });
    return { child, ready, closed };
  });
  const resultsPromise = Promise.all(children.map(item => item.closed));
  await Promise.race([Promise.all(children.map(item => item.ready)), resultsPromise]);
  children.forEach(item => item.child.stdin.end('create'));
  const results = await resultsPromise;
  assert.deepEqual(results.map(result => result.status).sort(), [200, 409]);
  assert.deepEqual(readJson(path.join(context.workspace, 'race.json')), { value: results.findIndex(result => result.status === 200) + 1 });
});

test('multi-json exclusive create preserves partial existing resources and rolls back its own files', async (t) => {
  const context = await httpFixture(t, [{ id: 'data', source: { type: 'multi-json', files: { first: 'first.json', second: 'second.json' } } }]);
  json(path.join(context.workspace, 'second.json'), { original: true });
  const conflict = await context.request('data', null, 'POST', { name: 'data.json', data: { first: [1], second: [2] } });
  assert.equal(conflict.status, 409);
  assert.deepEqual(fs.readdirSync(context.workspace), ['second.json']);
  assert.deepEqual(readJson(path.join(context.workspace, 'second.json')), { original: true });
  fs.rmSync(path.join(context.workspace, 'second.json'));
  const created = await context.request('data', null, 'POST', { name: 'data.json', data: { first: [1], second: [2] } });
  assert.equal(created.status, 200);
  assert.ok(created.body.revision);
  assert.deepEqual(readJson(path.join(context.workspace, 'first.json')), [1]);
  assert.deepEqual(readJson(path.join(context.workspace, 'second.json')), [2]);
});

test('async source same-revision saves across browser sessions admit only one writer', async (t) => {
  const context = await httpFixture(t, [{ id: 'data', source: { type: 'async-json', path: '.' } }], customSource);
  json(path.join(context.workspace, 'data.json'), { value: 0 });
  const opened = await context.request('data', 'data.json');
  const results = await Promise.all([1, 2].map(value => context.request('data', 'data.json', 'PUT', { revision: opened.body.revision, data: { value } }, `session-${value}`)));
  assert.deepEqual(results.map(result => result.status).sort(), [200, 409]);
  assert.equal(results.find(result => result.status === 409).body.issues[0].code, 'revision-conflict');
  const winner = results.findIndex(result => result.status === 200) + 1;
  assert.deepEqual(readJson(path.join(context.workspace, 'data.json')), { value: winner });
  const refreshed = await context.request('data', 'data.json');
  const failed = await context.request('data', 'data.json', 'PUT', { revision: refreshed.body.revision, data: { fail: true } });
  assert.equal(failed.status, 422);
  const saved = await context.request('data', 'data.json', 'PUT', { revision: refreshed.body.revision, data: { value: 3 } });
  assert.equal(saved.status, 200, 'a rejected mutation must not poison the queue');
});

for (const missingTemplate of [false, true]) {
  test(`custom source exclusive creation recognizes ${missingTemplate ? 'exists:false' : 'ENOENT'} and protects concurrent creates`, async (t) => {
    const context = await httpFixture(t, [{ id: 'data', source: { type: 'async-json', path: '.', missingTemplate } }], customSource);
    const results = await Promise.all([1, 2].map(value => context.request('data', 'data.json', 'PUT', { createOnly: true, data: { value } })));
    assert.deepEqual(results.map(result => result.status).sort(), [200, 409]);
    const winner = results.findIndex(result => result.status === 200) + 1;
    assert.deepEqual(readJson(path.join(context.workspace, 'data.json')), { value: winner });
    const duplicate = await context.request('data', null, 'POST', { name: 'data.json', data: { value: 9 } });
    assert.equal(duplicate.status, 409);
    const opened = await context.request('data', 'data.json');
    fs.rmSync(path.join(context.workspace, 'data.json'));
    const missing = await context.request('data', 'data.json', 'PUT', { revision: opened.body.revision, data: { value: 10 } });
    assert.equal(missing.status, 409);
    assert.equal(fs.existsSync(path.join(context.workspace, 'data.json')), false);
    const created = await context.request('data', null, 'POST', { name: 'data.json', data: { value: 11 } });
    assert.equal(created.status, 200);
  });
}

test('custom preconditions fail closed without read support or when the host cannot read', async (t) => {
  const extension = `module.exports = fwe => {
    const write = () => { throw new Error('write must not run'); };
    fwe.registerSource('no-read', { write, create: write });
    fwe.registerSource('read-error', { read() { throw Object.assign(new Error('Host unavailable'), {status:503}); }, write, create:write });
  };`;
  const context = await httpFixture(t, [
    { id: 'no-read', source: { type: 'no-read', path: '.' } },
    { id: 'read-error', source: { type: 'read-error', path: '.' } }
  ], extension);
  for (const [domain, expected] of [['no-read', 501], ['read-error', 503]]) {
    const created = await context.request(domain, null, 'POST', { name: 'data.json', data: {} });
    assert.equal(created.status, expected);
    const saved = await context.request(domain, 'data.json', 'PUT', { createOnly: true, data: {} });
    assert.equal(saved.status, expected);
  }
  assert.deepEqual(fs.readdirSync(context.workspace), []);
});

test('directory links cannot expose outside JSON, text, multi-json or custom-source resources', async (t) => {
  const context = await httpFixture(t, [
    { id: 'json', source: { type: 'folder-json', path: '.' } },
    { id: 'text', kind: 'text', source: { type: 'folder-text', path: '.' } },
    { id: 'multi', source: { type: 'multi-json', files: { outside: 'linked/outside.json' } } },
    { id: 'custom', source: { type: 'async-json', path: '.' } },
    { id: 'root-link', source: { type: 'folder-json', path: 'linked' } }
  ], customSource);
  const outside = path.join(context.root, 'outside');
  fs.mkdirSync(outside);
  json(path.join(outside, 'outside.json'), { original: true });
  fs.writeFileSync(path.join(outside, 'outside.txt'), 'original');
  fs.symlinkSync(outside, path.join(context.workspace, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
  for (const [domain, name, payload] of [
    ['json', 'linked/outside.json', { data: { modified: true } }],
    ['text', 'linked/outside.txt', { content: 'modified' }],
    ['multi', 'multi.json', { data: { outside: { modified: true } } }],
    ['custom', 'linked/outside.json', { data: { modified: true } }],
    ['root-link', 'outside.json', { data: { modified: true } }]
  ]) {
    for (const method of ['GET', 'PUT']) {
      const result = await context.request(domain, name, method, method === 'GET' ? undefined : payload);
      assert.equal(result.status, 403, `${domain} ${method}`);
      assert.equal(result.body.issues[0].code, 'workspace-path-escape');
    }
  }
  for (const method of ['PUT', 'DELETE']) {
    const result = await context.request('json', 'linked/outside.json', method, method === 'PUT' ? { createOnly: true, data: {} } : undefined);
    assert.equal(result.status, 403);
  }
  const missing = await context.request('json', 'linked/new/absent.json', 'PUT', { createOnly: true, data: {} });
  assert.equal(missing.status, 403, 'missing targets must still check their existing linked ancestors');
  assert.deepEqual(readJson(path.join(outside, 'outside.json')), { original: true });
  assert.equal(fs.readFileSync(path.join(outside, 'outside.txt'), 'utf8'), 'original');
  assert.equal(fs.existsSync(path.join(outside, 'new')), false);
});

test('an explicitly configured workspace link works but descendant links remain rejected', (t) => {
  const context = fixture(t, [{ id: 'data', source: { type: 'folder-json', path: '.' } }]);
  const alias = path.join(context.root, 'workspace-alias');
  fs.symlinkSync(context.workspace, alias, process.platform === 'win32' ? 'junction' : 'dir');
  context.app.workspaceDir = alias;
  writeDomainFile(context.app, context.app.domains[0], 'safe.json', { createOnly: true, data: { value: 1 } });
  assert.deepEqual(readDomainFile(context.app, context.app.domains[0], 'safe.json').data, { value: 1 });
  const childAlias = path.join(context.workspace, 'child-alias');
  fs.symlinkSync(context.workspace, childAlias, process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => readDomainFile(context.app, context.app.domains[0], 'child-alias/safe.json'), error => error.status === 403);
});

test('file symlinks are rejected without changing their targets', (t) => {
  const context = fixture(t, [{ id: 'data', source: { type: 'folder-json', path: '.' } }]);
  const outside = path.join(context.root, 'outside.json');
  const linked = path.join(context.workspace, 'linked.json');
  json(outside, { original: true });
  try {
    fs.symlinkSync(outside, linked, 'file');
  } catch (error) {
    if (process.platform === 'win32' && error.code === 'EPERM') {
      t.skip('Windows does not grant file-symlink creation; directory junction coverage still runs.');
      return;
    }
    throw error;
  }
  assert.throws(() => readDomainFile(context.app, context.app.domains[0], 'linked.json'), error => error.status === 403);
  assert.throws(() => writeDomainFile(context.app, context.app.domains[0], 'linked.json', { data: {} }), error => error.status === 403);
  assert.deepEqual(readJson(outside), { original: true });
});
