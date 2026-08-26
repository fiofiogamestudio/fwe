const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const appSource = fs.readFileSync(path.resolve(__dirname, '../public/app.js'), 'utf8');
const inspectorSource = fs.readFileSync(path.resolve(__dirname, '../public/inspector.js'), 'utf8');
const graphSource = fs.readFileSync(path.resolve(__dirname, '../public/graph.js'), 'utf8');
const indexSource = fs.readFileSync(path.resolve(__dirname, '../public/index.html'), 'utf8');

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

test('unsaved edits are guarded across navigation, refresh, and file-name collisions', () => {
  const discardSource = readFunctionSource('confirmDiscardChanges');
  const dirtySource = readFunctionSource('hasUnsavedChanges');
  const createSource = readFunctionSource('createFile');

  assert.match(discardSource, /hasUnsavedChanges\(\)/);
  assert.match(dirtySource, /state\.dirty \|\| state\.jsonDirty/);
  assert.match(appSource, /window\.addEventListener\('beforeunload'/);
  assert.match(appSource, /navigator\.userActivation\.hasBeenActive/);
  assert.match(appSource, /event\.returnValue = ''/);
  assert.match(createSource, /fileAlreadyExists/);
  assert.match(createSource, /existing\?\.exists !== false/);
});

test('framework tabs expose consistent semantics and keyboard navigation', () => {
  const keyboardSource = readFunctionSource('handleTabListKeydown');

  assert.match(indexSource, /id="collectionModeTabs"[^>]+role="tablist"/);
  assert.match(indexSource, /id="sidepanelModeTabs"[^>]+role="tablist"/);
  assert.match(indexSource, /id="inspectorFormModeButton"[^>]+role="tab"[^>]+aria-selected="true"/);
  assert.match(keyboardSource, /ArrowRight/);
  assert.match(keyboardSource, /ArrowLeft/);
  assert.match(keyboardSource, /Home/);
  assert.match(keyboardSource, /End/);
  assert.match(appSource, /button\.setAttribute\('aria-selected'/);
  assert.match(inspectorSource, /inspectorFormModeButton\.setAttribute\('aria-selected'/);
});

test('framework and graph interaction messages use configurable labels', () => {
  assert.doesNotMatch(appSource, /No sidepanel tabs configured\./);
  assert.doesNotMatch(appSource, /No editor configured\./);
  assert.match(inspectorSource, /getAppLabel\('markup'\)/);
  assert.match(inspectorSource, /formatAppLabel\('markupAlreadyApplied'/);
  assert.match(graphSource, /function formatGraphLabel/);
  assert.match(graphSource, /formatGraphLabel\('confirmDeleteNode'/);
  assert.match(graphSource, /formatGraphLabel\('statusAddedOption'/);
});

test('built-in history, blueprint forms, and validation messages use app labels', () => {
  const addSource = readFunctionSource('addSelectionItem');
  const blueprintValidationSource = readFunctionSource('validateBlueprintGraph');
  const objectValidationSource = readFunctionSource('validateObjectRule');

  assert.match(addSource, /formatAppLabel\('historyAddPath'/);
  assert.match(addSource, /formatAppLabel\('statusAddedPath'/);
  assert.match(blueprintValidationSource, /formatAppLabel\('diagnosticBlueprintDuplicateNodeId'/);
  assert.match(blueprintValidationSource, /formatAppLabel\('diagnosticBlueprintIncompatiblePorts'/);
  assert.match(objectValidationSource, /formatAppLabel\('diagnosticRequired'/);
  assert.match(objectValidationSource, /formatAppLabel\('diagnosticExpectedType'/);
  assert.match(inspectorSource, /getAppLabel\('blueprintNodeType'\)/);
  assert.match(inspectorSource, /getAppLabel\('blueprintNoEditableInputs'\)/);
});

test('resource extensions receive lifecycle metadata and can invoke host resource commands', () => {
  const openSource = readFunctionSource('openSelectedFile');
  const saveSource = readFunctionSource('saveFile');
  assert.match(appSource, /fweRuntime\.resources = \{/);
  assert.match(appSource, /saveCurrent: \(\) => saveFile\(\{ force: true \}\)/);
  assert.match(openSource, /result\.meta !== undefined/);
  assert.match(openSource, /dispatchResourceEvent\('fwe:resource-opened'\)/);
  assert.match(saveSource, /saved\?\.meta !== undefined/);
  assert.match(saveSource, /dispatchResourceEvent\('fwe:resource-saved'/);
});

test('browser resources expose structured selection and send a stable session header', () => {
  const snapshotSource = readFunctionSource('currentResourceSnapshot');
  const sessionSource = readFunctionSource('createBrowserSession');
  const apiSource = readFunctionSource('api');
  assert.match(snapshotSource, /selection: currentSelectionSnapshot\(\)/);
  assert.match(appSource, /dispatchResourceEvent\('fwe:selection-changed'/);
  assert.match(appSource, /fweRuntime\.session = fweSession/);
  assert.match(sessionSource, /window\.sessionStorage\.getItem/);
  assert.match(sessionSource, /'X-FWE-Session': id/);
  assert.match(apiSource, /fweSession\.headers\(optionHeaders\)/);
});

test('workbench resources expose stable deep links and restore collection items', () => {
  const hrefSource = readFunctionSource('buildNavigationHref');
  const applySource = readFunctionSource('applyWorkbenchNavigationTarget');
  const sessionSource = readFunctionSource('createBrowserSession');

  assert.match(appSource, /fweRuntime\.navigation = \{/);
  assert.match(appSource, /collectionId: 'fweCollection'/);
  assert.match(hrefSource, /FWE_NAVIGATION_QUERY\[key\]/);
  assert.match(hrefSource, /FWE_NAVIGATION_QUERY\.sessionId/);
  assert.match(applySource, /getCollectionItemId\(collection, item, rowIndex\)/);
  assert.match(applySource, /state\.workbench\.collectionId = collection\.id/);
  assert.match(sessionSource, /FWE_NAVIGATION_QUERY\.sessionId/);
  assert.match(sessionSource, /handoff = true/);
  assert.match(inspectorSource, /createResourceLink\(options = \{\}\)/);
});

test('collection columns support configured labels and readable value formatting', () => {
  const renderGridSource = readFunctionSource('renderCollectionGrid');
  const formatColumnSource = readFunctionSource('formatCollectionColumnValue');
  const subtitleSource = readFunctionSource('getCollectionItemSubtitle');

  assert.match(renderGridSource, /collection-grid-card__label/);
  assert.match(renderGridSource, /formatCollectionColumnValue\(column, item\)/);
  assert.match(subtitleSource, /formatCollectionColumnValue\(field, item\)/);
  assert.match(formatColumnSource, /column\.valueMap/);
  assert.match(formatColumnSource, /column, 'join'/);
  assert.match(formatColumnSource, /column, 'emptyText'/);
  assert.match(formatColumnSource, /column\.precision/);
});

test('collection workbenches support configuration-driven grouped navigation', () => {
  const groupSource = readFunctionSource('getWorkbenchCollectionGroups');
  const tabsSource = readFunctionSource('renderCollectionTabs');
  const activateSource = readFunctionSource('activateWorkbenchCollection');

  assert.match(groupSource, /workbench\?\.collectionGroups/);
  assert.match(groupSource, /collection\.group \|\| collection\.collectionGroup/);
  assert.match(tabsSource, /collection-tab-groups/);
  assert.match(tabsSource, /button\.dataset\.collectionGroupId/);
  assert.match(tabsSource, /button\.dataset\.collectionIds/);
  assert.match(tabsSource, /activeGroup\?\.collections \|\| collections/);
  assert.match(activateSource, /state\.workbench\.collectionId = collection\.id/);
});

test('optional-object fields toggle the whole object and render configured child fields', () => {
  assert.match(inspectorSource, /field\.type === 'optional-object'/);
  assert.match(inspectorSource, /function renderInspectorOptionalObjectField\(field, target, context\)/);
  assert.match(inspectorSource, /clone\(configured\)/);
  assert.match(inspectorSource, /deleteByPath\(target, field\.path\)/);
  assert.match(inspectorSource, /\(field\.fields \|\| \[\]\)\.forEach/);
  assert.match(inspectorSource, /targetPath: joinPath\(context\.targetPath, field\.path\)/);
});

test('dynamic select options support configuration-driven display labels', () => {
  assert.match(inspectorSource, /field\.optionLabels/);
  assert.match(inspectorSource, /mappedLabel \?\? item\.label/);
});

test('configured graphs support collection views, labeled details, and derived grid edges', () => {
  assert.match(graphSource, /configuredViews\[node\.collection\]/);
  assert.match(graphSource, /configured\.label \|\| formatGraphDetailLabel/);
  assert.match(graphSource, /appendDerivedGraphEdges\(config, nodes, nodeMap, baseCollection, edges\)/);
  assert.match(graphSource, /type !== 'orthogonal-grid'/);
  assert.match(graphSource, /raw === 'grid'/);
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
