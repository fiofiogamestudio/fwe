const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { compileFweDsl } = require('../src/dsl');
const source = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');
function fn(name) { const start = source.search(new RegExp(`^function ${name}\\(`, 'm')); assert.ok(start >= 0); const rest = source.slice(start), next = rest.search(/\n(?:async )?function /); return next < 0 ? rest : rest.slice(0, next); }

test('catalog thumbnail URL policy accepts local images and rejects executable or remote sources', () => {
  const c = { URL, window: { location: { href: 'http://127.0.0.1:3210/', origin: 'http://127.0.0.1:3210' } } }; vm.createContext(c); vm.runInContext(fn('safeCollectionThumbnailUrl'), c);
  for (const url of ['/art/one.png?rev=1', 'http://127.0.0.1:3210/art.webp', 'data:image/png;base64,YQ==', 'data:image/jpeg;base64,YWJj', 'data:image/webp;base64,YWI=']) assert.ok(c.safeCollectionThumbnailUrl(url), url);
  for (const url of ['javascript:alert(1)', '/\\remote.test/a.png', '//remote.test/a.png', 'https://remote.test/a.png', 'http://127.0.0.1:3211/a.png', 'data:image/svg+xml;base64,YQ==', 'data:text/html;base64,YQ==', 'data:image/png;base64,', 'data:image/png;base64,YQ=', 'file:///D:/image.png', '/a.png\n', 'relative.png', 'http://user:pass@127.0.0.1:3210/a.png']) assert.equal(c.safeCollectionThumbnailUrl(url), '', url);
});

test('catalog pages clamp to results and leave unconfigured collections unpaged', () => {
  const c = { state: { workbench: { page: 1 } } }; vm.createContext(c); vm.runInContext(fn('getCollectionPageSize') + '\n' + fn('getPagedCollectionRows'), c);
  const rows = Array.from({ length: 97 }, (_, index) => index), collection = { pageSize: 48 };
  assert.deepEqual(Array.from(c.getPagedCollectionRows(collection, rows)), rows.slice(48, 96));
  c.state.workbench.page = 20; assert.deepEqual(Array.from(c.getPagedCollectionRows(collection, rows)), [96]); assert.equal(c.state.workbench.page, 2);
  assert.equal(c.getPagedCollectionRows({}, rows), rows);
  assert.deepEqual(Array.from(c.getPagedCollectionRows(collection, [])), []); assert.equal(c.state.workbench.page, 0);
});

test('DSL preserves native thumbnail and pageSize configuration', () => {
  const domain = compileFweDsl('id images\nsource "folder-json:images"\ndata Images {\n images: Image[]\n}\ntype Image {\n id: string @key\n name: string\n thumbnailUrl: string\n}\nview workbench {\n layout catalog\n collection images {\n path images\n title name\n pageSize 48\n thumbnail {"src":"thumbnailUrl","alt":"name"}\n }\n}\n');
  assert.equal(domain.workbench.collections[0].pageSize, 48);
  assert.deepEqual(domain.workbench.collections[0].thumbnail, { src: 'thumbnailUrl', alt: 'name' });
});

test('DSL preserves native filters and the facets compatibility alias', () => {
  const filters = [{ id: 'current', path: 'current', default: 'current', options: [{ value: 'current', label: 'Current' }, { value: 'historical', label: 'Historical' }] },
    { id: 'asset', path: 'assetId', multiple: true, options: { path: 'assetOptions', value: 'id', label: 'name' } }];
  for (const key of ['filters', 'facets']) {
    const domain = compileFweDsl('id images\nsource "folder-json:images"\ndata Images {\n images: Image[]\n}\ntype Image {\n id: string @key\n name: string\n}\nview workbench {\n layout catalog\n collection images {\n path images\n ' + key + ' ' + JSON.stringify(filters) + '\n }\n}\n');
    assert.deepEqual(domain.workbench.collections[0][key], filters);
  }
});

test('native entry respects default filters while explicit deep links can reveal hidden rows', () => {
  const rows = [{ id: 'old', current: 'historical' }, { id: 'new', current: 'current' }], collection = { id: 'images', path: 'images', pageSize: 48 };
  const effects = { reveals: [], errors: [] }, c = { state: { domain: { id: 'catalog' }, file: { name: 'catalog.json' }, workbench: { search: '', filterValues: {} } },
    normalizeNavigationTarget: value => value, isCollectionWorkbench: () => true, getWorkbenchCollections: () => [collection], getCollectionRows: () => rows,
    getFilteredCollectionRows: () => rows.map((item, index) => ({ item, index })).filter(row => row.item.current === 'current'),
    getCollectionModes: () => [{ id: 'preview' }], getCollectionDefaultMode: () => 'preview', getCollectionItemId: (_collection, item) => item.id,
    getCollectionItemPath: (_collection, index) => `images[${index}]`, getCollectionPageSize: () => 48,
    revealCollectionItemInFilters: (_collection, item) => effects.reveals.push(item.id), getCollectionSearchText: (_collection, item) => item.id,
    setStatus: (...args) => effects.errors.push(args) };
  vm.createContext(c); vm.runInContext(fn('applyWorkbenchNavigationTarget'), c);
  assert.equal(c.applyWorkbenchNavigationTarget({ collectionId: 'images' }), true); assert.equal(c.state.selectedKey, 'images[1]'); assert.deepEqual(effects.reveals, []);
  c.getFilteredCollectionRows = () => []; c.state.workbench.search = 'no matches';
  assert.equal(c.applyWorkbenchNavigationTarget({ collectionId: 'images' }), true); assert.equal(c.state.selectedKey, ''); assert.equal(c.state.workbench.search, 'no matches'); assert.deepEqual(effects.errors, []);
  assert.equal(c.applyWorkbenchNavigationTarget({ collectionId: 'images', itemId: 'old' }), true); assert.equal(c.state.selectedKey, 'images[0]'); assert.equal(c.state.workbench.search, ''); assert.deepEqual(effects.reveals, ['old']);
  assert.equal(c.applyWorkbenchNavigationTarget({ collectionId: 'images', itemId: 'absent' }), false); assert.equal(effects.errors.length, 1);
});
