const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

// Execute the actual shell functions, with only DOM and transport effects stubbed.
// These tests exercise ordering and contents rather than matching source strings.
const source = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');
function functionSource(name) {
  const start = source.search(new RegExp(`^(?:async )?function ${name}\\(`, 'm'));
  assert.notEqual(start, -1, `Missing shell function ${name}`);
  const rest = source.slice(start);
  const next = rest.search(/\n(?:async )?function /);
  return next < 0 ? rest : rest.slice(0, next);
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

const tick = () => new Promise((resolve) => setImmediate(resolve));
const plain = (value) => JSON.parse(JSON.stringify(value));

function shell(options = {}) {
  const effects = { requests: [], statuses: [], events: [], renders: 0, diagnostics: 0 };
  const state = {
    domain: { id: 'notes', kind: 'text', defaults: {} },
    file: { name: 'a.txt', exists: true, revision: 'r0' },
    files: [{ name: 'a.txt', exists: true }, { name: 'b.txt', exists: true }],
    data: null, text: 'initial', dirty: true, jsonDirty: false, inspectorMode: 'form',
    selectionVersion: 1, fileOpenVersion: 1, resourceLoading: false, resourceReady: true,
    pendingInspectorControl: null, serverDiagnostics: [], view: {},
    ...options.state
  };
  const context = {
    state, resourceSaveQueues: new Map(), textView: { value: state.text }, fileSelect: {},
    window: { prompt: () => options.name ?? 'new.txt' },
    domainAllowsNewFile: (domain) => domain.actions?.new !== false,
    confirmDiscardChanges: () => options.discard !== false,
    clone: plain, getAppLabel: (key) => key,
    formatAppLabel: (key, fallback, values) => `${key}:${JSON.stringify(values)}`,
    getResourceDisplayName: (name) => name,
    commitFocusedInspectorControl: () => {},
    validateCurrent: () => [], applyJsonDraft: () => true,
    normalizeApiDiagnostics: (issues) => issues || [],
    clearServerDiagnostics: () => { state.serverDiagnostics = []; },
    renderDiagnostics: () => { effects.diagnostics += 1; },
    setStatus: (...args) => effects.statuses.push(args),
    render: () => { effects.renders += 1; },
    dispatchResourceEvent: (name, extra) => effects.events.push({ name, extra }),
    hasUnsavedChanges: () => state.dirty || state.jsonDirty,
    resetWorkbenchState: () => {}, resetJsonDraftState: () => { state.jsonDirty = false; },
    resetHistory: () => {}, renderFileSelect: () => {}, updateActionButtons: () => {},
    setResourceLoading: (loading) => { state.resourceLoading = loading; },
    normalizeNavigationTarget: (value) => value || {}, readNavigationTarget: () => ({}),
    applyWorkbenchNavigationTarget: () => {},
    api: (url, request) => {
      effects.requests.push({ url, ...request, payload: request?.body ? JSON.parse(request.body) : null });
      return options.api ? options.api(url, request) : Promise.resolve({ revision: 'r1' });
    }
  };
  vm.createContext(context);
  vm.runInContext(['createFile', 'saveFile', 'openSelectedFile', 'loadFiles', 'refreshCurrentResource', 'resourceSaveKey', 'isCurrentResource', 'getManagedWorkspaces']
    .map(functionSource).join('\n'), context);
  return { state, effects, context, save: context.saveFile, create: context.createFile, open: context.openSelectedFile, refresh: context.refreshCurrentResource };
}

test('unique file creation produces a dirty create-only draft without overwriting existing files', async () => {
  const app = shell({ name: 'brand-new.txt' });
  assert.equal(await app.create(), true);
  assert.equal(app.state.file.name, 'brand-new.txt');
  assert.equal(app.state.file.exists, false);
  assert.equal(app.state.dirty, true);
  assert.equal(app.state.fileOpenVersion, 2);
  assert.equal(await app.save(), true);
  assert.equal(app.effects.requests[0].payload.createOnly, true);
  assert.equal(app.state.file.exists, true);
  assert.equal(app.state.file.revision, 'r1');
});

test('API collection navigation refreshes status and keeps unsaved state visible', async () => {
  const app = shell({ state: {
    app: { domains: [{ id: 'art', kind: 'document' }] },
    domain: { id: 'art', kind: 'document' }, file: { name: 'drafts.json' },
    workbench: { collectionId: 'reskin' }, dirty: false, data: { values: [] }
  } });
  app.context.applyWorkbenchNavigationTarget = target => {
    if (target.collectionId === 'missing') return false;
    app.state.workbench.collectionId = target.collectionId; return true;
  };
  app.context.getResourceDisplayName = () => app.state.workbench.collectionId;
  vm.runInContext(functionSource('navigateToResource'), app.context);
  assert.equal(await app.context.navigateToResource({ domainId: 'art', fileName: 'drafts.json', collectionId: 'generate' }), true);
  assert.equal(app.effects.statuses.at(-1)[0], 'opened generate');
  app.state.app.navigation = { workspaces: [{ id: 'art' }] };
  assert.equal(await app.context.navigateToResource({ collectionId: 'models' }), true);
  assert.equal(app.effects.statuses.at(-1)[0], '', 'managed navigation has no redundant opened banner');
  app.state.dirty = true;
  assert.equal(await app.context.navigateToResource({ collectionId: 'images' }), true);
  assert.equal(app.effects.statuses.at(-1)[0], 'dirty:{"title":"images"}');
  const statuses = app.effects.statuses.length;
  assert.equal(await app.context.navigateToResource({ collectionId: 'images', itemId: 'next' }), true);
  assert.equal(app.effects.statuses.length, statuses, 'same-collection item hydration does not replace detailed status');
  assert.equal(await app.context.navigateToResource({ collectionId: 'missing' }), false);
  assert.equal(app.effects.statuses.length, statuses);
});

test('existing names (case-insensitive), disabled New, and cancelled discard preserve current edits', async () => {
  for (const options of [{ name: 'A.TXT' }, { discard: false }, { state: { domain: { actions: { new: false } } } }]) {
    const app = shell(options);
    const before = plain(app.state);
    assert.equal(await app.create(), false);
    assert.deepEqual(plain(app.state), before);
    assert.equal(app.effects.requests.length, 0);
  }
});

test('save acknowledges only the sent text snapshot, preserving later text and dirty state', async () => {
  const response = deferred();
  const app = shell({ api: () => response.promise });
  const saving = app.save();
  app.state.text = app.context.textView.value = 'edited while saving';
  response.resolve({ revision: 'r1', meta: { host: 1 } });
  assert.equal(await saving, true);
  assert.equal(app.effects.requests[0].payload.content, 'initial');
  assert.equal(app.state.text, 'edited while saving');
  assert.equal(app.state.dirty, true);
  assert.equal(app.state.file.revision, 'r1');
  assert.deepEqual(plain(app.state.file.meta), { host: 1 });
  assert.equal(app.effects.renders, 0, 'save must not destroy a newer editor control');
  assert.equal(app.effects.requests.length, 1, 'save must not run the selection-changing file listing');
});

test('unchanged successful save clears dirty and preserves file identity', async () => {
  const app = shell();
  assert.equal(await app.save(), true);
  assert.equal(app.state.dirty, false);
  assert.equal(app.state.file.name, 'a.txt');
  assert.equal(app.state.file.revision, 'r1');
  assert.equal(app.effects.events.at(-1).name, 'fwe:resource-saved');
  assert.equal(app.effects.renders, 1, 'clean saves refresh derived views');
});

test('JSON mutations, raw JSON drafts and focused inspector drafts survive save responses', async () => {
  for (const mutate of [
    (app) => { app.state.data.value = 2; },
    (app) => { app.state.jsonDirty = true; app.state.jsonDraft = '{"value":2}'; },
    (app) => { app.state.pendingInspectorControl = { isConnected: true, value: 'new input' }; }
  ]) {
    const response = deferred();
    const app = shell({ state: { domain: { id: 'settings', kind: 'document' }, data: { value: 1 } }, api: () => response.promise });
    const saving = app.save();
    mutate(app);
    response.resolve({ revision: 'r1' });
    assert.equal(await saving, true);
    assert.equal(app.effects.requests[0].payload.data.value, 1);
    assert.equal(app.state.dirty, true);
    assert.equal(app.effects.renders, 0);
  }
});

test('same-resource saves are serialized with immutable snapshots and the last confirmed revision', async () => {
  const responses = [deferred(), deferred()];
  let calls = 0;
  const app = shell({ api: () => responses[calls++].promise });
  const first = app.save();
  app.state.text = app.context.textView.value = 'second';
  const second = app.save();
  assert.equal(calls, 1);
  responses[0].resolve({ revision: 'r1' });
  assert.equal(await first, true);
  await tick();
  assert.equal(app.state.dirty, true);
  assert.equal(calls, 2);
  assert.deepEqual(app.effects.requests.map((request) => request.payload), [
    { content: 'initial', revision: 'r0' }, { content: 'second', revision: 'r1' }
  ]);
  responses[1].resolve({ revision: 'r2' });
  assert.equal(await second, true);
  assert.equal(app.state.dirty, false);
  assert.equal(app.state.file.revision, 'r2');
  assert.equal(app.context.resourceSaveQueues.size, 0);
});

test('queued draft saves create once, then update using the create revision', async () => {
  const responses = [deferred(), deferred()];
  let calls = 0;
  const app = shell({ state: { file: { name: 'new.txt', exists: false } }, api: () => responses[calls++].promise });
  const first = app.save();
  app.state.text = app.context.textView.value = 'second';
  const second = app.save();
  responses[0].resolve({ revision: 'created-r1' });
  await first;
  await tick();
  assert.deepEqual(app.effects.requests.map((request) => request.payload), [
    { content: 'initial', createOnly: true }, { content: 'second', revision: 'created-r1' }
  ]);
  responses[1].resolve({ revision: 'r2' });
  assert.equal(await second, true);
  assert.equal(app.state.file.exists, true);
});

test('late success and failure cannot mutate another file, domain, or reopened session', async () => {
  for (const outcome of ['success', 'failure']) {
    for (const switchResource of [
      (state) => { state.file = { name: 'b.txt', revision: 'other' }; state.fileOpenVersion += 1; },
      (state) => { state.domain = { id: 'other', kind: 'text' }; state.selectionVersion += 1; },
      (state) => { state.fileOpenVersion += 1; }
    ]) {
      const response = deferred();
      const app = shell({ api: () => response.promise });
      const saving = app.save();
      switchResource(app.state);
      app.state.text = app.context.textView.value = 'new session';
      app.state.dirty = false;
      const before = plain(app.state);
      if (outcome === 'success') response.resolve({ revision: 'old-save' });
      else response.reject(Object.assign(new Error('conflict'), { issues: [{ code: 'revision-conflict' }] }));
      assert.equal(await saving, outcome === 'success');
      assert.deepEqual(plain(app.state), before);
      assert.equal(app.effects.events.length, 0);
      assert.equal(app.effects.statuses.length, 0);
    }
  }
});

test('failed writes retain structured diagnostics, draft contents and dirty status', async () => {
  const response = deferred();
  const app = shell({ api: () => response.promise });
  const saving = app.save();
  app.state.text = app.context.textView.value = 'newer edit';
  response.reject(Object.assign(new Error('conflict'), { issues: [{ code: 'revision-conflict', message: 'changed' }] }));
  assert.equal(await saving, false);
  assert.equal(app.state.dirty, true);
  assert.equal(app.state.text, 'newer edit');
  assert.equal(app.state.serverDiagnostics[0].code, 'revision-conflict');
  assert.equal(app.state.file.revision, 'r0');
  assert.equal(app.effects.renders, 0);
});

test('returning to a saving resource waits for queued writes before reading its latest revision', async () => {
  const response = deferred();
  const app = shell({ api: (url, request) => request?.method === 'PUT' ? response.promise
    : Promise.resolve({ type: 'text', name: 'a.txt', content: 'saved content', revision: 'r1' }) });
  const saving = app.save();
  app.state.fileOpenVersion += 1; // Leave and return to this file.
  const opening = app.open({ skipDirtyCheck: true });
  assert.equal(app.effects.requests.length, 1);
  assert.equal(app.state.resourceLoading, true);
  assert.equal(await app.save(), false, 'old displayed contents cannot be saved while a read is pending');
  response.resolve({ revision: 'r1' });
  await saving;
  assert.equal(await opening, true);
  assert.equal(app.effects.requests.length, 2);
  assert.equal(app.state.text, 'saved content');
  assert.equal(app.state.file.revision, 'r1');
  assert.equal(app.state.dirty, false);
  assert.equal(app.state.resourceLoading, false);
});

test('a superseded pending read cannot regain selection or clear a newer loading flag', async () => {
  const response = deferred();
  const app = shell({ api: () => response.promise });
  const opening = app.open({ skipDirtyCheck: true });
  app.state.file = { name: 'b.txt' };
  app.state.fileOpenVersion += 1;
  response.resolve({ type: 'text', name: 'a.txt', content: 'old', revision: 'r1' });
  assert.equal(await opening, false);
  assert.equal(app.state.file.name, 'b.txt');
  assert.equal(app.state.resourceLoading, true);
});

test('failed file switches keep loaded data attached to the original resource', async () => {
  const app = shell({ api: () => Promise.reject(new Error('read failed')) });
  assert.equal(await app.open({ skipDirtyCheck: true, file: { name: 'b.txt' } }), false);
  assert.equal(app.state.file.name, 'a.txt');
  assert.equal(app.state.text, 'initial');
  assert.equal(app.state.resourceReady, true);
  assert.equal(app.state.resourceLoading, false);
});

test('a failed first read never enables saving uninitialized contents', async () => {
  const app = shell({ state: { resourceReady: false }, api: () => Promise.reject(new Error('read failed')) });
  assert.equal(await app.open({ skipDirtyCheck: true }), false);
  assert.equal(await app.save(), false);
  assert.equal(app.effects.requests.length, 1);
});

test('different-resource saves may finish out of order without exchanging identity or revisions', async () => {
  const responses = [deferred(), deferred()];
  let calls = 0;
  const app = shell({ api: () => responses[calls++].promise });
  const first = app.save();
  app.state.file = { name: 'b.txt', revision: 'b0', exists: true };
  app.state.fileOpenVersion += 1;
  app.state.text = app.context.textView.value = 'b edit';
  const second = app.save();
  assert.equal(calls, 2);
  responses[1].resolve({ revision: 'b1' });
  await second;
  responses[0].resolve({ revision: 'a1' });
  await first;
  assert.equal(app.state.file.name, 'b.txt');
  assert.equal(app.state.file.revision, 'b1');
  assert.equal(app.state.text, 'b edit');
  assert.equal(app.state.dirty, false);
  assert.deepEqual(app.effects.requests.map((request) => request.payload), [
    { content: 'initial', revision: 'r0' }, { content: 'b edit', revision: 'b0' }
  ]);
});

test('refresh keeps the selected file instead of reopening the first listed file', async () => {
  const app = shell({ state: { file: { name: 'b.txt', revision: 'b0' } }, api: (url) => url.endsWith('/files')
    ? Promise.resolve({ files: [{ name: 'a.txt' }, { name: 'b.txt' }] })
    : Promise.resolve({ type: 'text', name: 'b.txt', content: 'b current', revision: 'b1' }) });
  assert.equal(await app.refresh(), true);
  assert.equal(app.effects.requests[1].url, '/api/domains/notes/files/b.txt');
  assert.equal(app.state.file.name, 'b.txt');
  assert.equal(app.state.text, 'b current');
});

test('a delayed refresh does not reopen over newer file or domain navigation', async () => {
  for (const change of [
    (state) => { state.file = { name: 'b.txt' }; state.fileOpenVersion += 1; },
    (state) => { state.domain = { id: 'other', kind: 'text' }; state.selectionVersion += 1; }
  ]) {
    const response = deferred();
    const app = shell({ api: () => response.promise });
    const refreshing = app.refresh();
    change(app.state);
    app.state.text = 'new resource';
    response.resolve({ files: [{ name: 'a.txt' }, { name: 'b.txt' }] });
    assert.equal(await refreshing, false);
    assert.equal(app.effects.requests.length, 1, 'stale refresh must not open any resource');
    assert.equal(app.state.text, 'new resource');
  }
});
