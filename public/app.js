const state = {
  app: null,
  domain: null,
  files: [],
  file: null,
  data: null,
  text: '',
  selectedKey: '',
  pendingInspectorControl: null,
  drag: null,
  contextGraphNodeKey: '',
  workbench: {
    collectionId: '',
    listLayout: 'detail',
    search: '',
    mode: 'overview',
    variant: ''
  },
  view: {
    scale: 1,
    tx: 0,
    ty: 0,
    contentWidth: 1200,
    contentHeight: 640,
    resetPending: true,
    pan: null
  },
  inspectorMode: 'form',
  selectedEdge: null,
  jsonDraft: '',
  jsonDirty: false,
  jsonError: '',
  jsonTargetSignature: '',
  history: {
    undo: [],
    redo: [],
    limit: 50,
    textBaseline: null,
    dragBaseline: null
  },
  dirty: false
};

const DEFAULT_LABELS = {
  open: '打开',
  new: '新建',
  save: '保存',
  undo: '撤销',
  redo: '重做',
  add: '添加',
  duplicate: '复制',
  delete: '删除',
  inspector: '检查器',
  form: '表单',
  json: 'JSON',
  apply: '应用',
  revert: '还原',
  search: '搜索',
  detail: '详情',
  grid: '网格',
  overview: '概览',
  editor: '编辑器',
  preview: '预览',
  references: '引用',
  diagnostics: '诊断',
  domain: '数据域',
  metaButton: '元数据',
  more: '更多',
  reset: '重置',
  files: '个文件',
  opened: '已打开',
  saved: '已保存',
  createdDraft: '已创建草稿',
  noFileSelected: '未选择文件',
  noFileToSave: '没有可保存的文件',
  newFileName: '新文件名',
  openOrCreateFile: '打开或新建一个文件。',
  textDirectEdit: '文本文件在左侧直接编辑。',
  saveBlocked: '保存被阻止：{count} 个错误',
  jsonDraftChanged: 'JSON 草稿已修改',
  dirtyText: '已修改',
  dirty: '已修改 - {title}',
  discardUnsavedChanges: '放弃未保存的修改？',
  noStructuredSelection: '没有结构化选择。',
  selectionReadOnly: '当前选择为只读。',
  invalidJson: 'JSON 无效：{message}',
  editNestedJson: '嵌套对象请在 JSON 状态编辑。',
  noFormSchema: '当前选择没有配置表单。',
  fields: '字段',
  items: '条目',
  item: '条目',
  object: '对象',
  variant: '变体',
  up: '上移',
  down: '下移',
  remove: '移除',
  noDiagnostics: '没有诊断。',
  noCollections: '没有配置集合。',
  noItems: '没有条目。',
  noItemSelected: '未选择条目。',
  noListSource: '没有列表来源。',
  noPreviewSource: '未选择预览来源。',
  noRouteNodes: '没有路线节点。',
  pool: '池',
  node: '节点',
  collection: '集合',
  duplicateAsKey: '复制为字段名',
  newFieldName: '新字段名',
  loadScriptFailed: '加载失败：{label}',
  deleteSelectionConfirm: '删除 {path}？',
  referencedBy: '被以下位置引用：'
};

const DEFAULT_GRAPH_GRID = 10;
const GRAPH_NODE_WIDTH = 240;
const GRAPH_NODE_HEIGHT = 140;
const GRAPH_PSEUDO_NODE_HEIGHT = 74;
const GRAPH_OPTION_NODE_HEIGHT = 132;
const GRAPH_TEXT_LINE_WIDTH = 18;
const GRAPH_ACTOR_LINE_HEIGHT = 18;
const GRAPH_TEXT_LINE_HEIGHT = 20;
const GRAPH_DETAIL_LINE_HEIGHT = 16;
const GRAPH_DETAIL_ROW_EXTRA_HEIGHT = 14;
const GRAPH_DETAIL_LIST_TOP_HEIGHT = 14;
const GRAPH_DETAIL_GAP = 6;
const FIXED_GRAPH_MARGIN = 48;
const FIXED_COLUMN_STEP = 360;
const FIXED_DEPTH_GAP = 44;
const FIXED_GRAPH_SAFE_X = 56;
const FIXED_ROUTE_LANE_GAP = 28;
const FIXED_ROUTE_GUTTER = FIXED_ROUTE_LANE_GAP;
const FIXED_EDGE_VERTICAL_GAP = 18;
const FIXED_ROUTE_INTERVAL_GAP = FIXED_ROUTE_LANE_GAP;
const MIN_VIEW_SCALE = 0.1;
const MAX_VIEW_SCALE = 1;
const FIT_VIEW_PADDING = 28;
const FIT_VIEW_HUD_RESERVE = 58;
const RESET_READABLE_MIN_SCALE = 0.35;
const PAN_DRAG_THRESHOLD = 4;
const START_NODE_KEY = '__start__';
const END_NODE_PREFIX = '__end__:';
const BUILT_IN_GRAPH_PROFILES = {
  dialog: {
    kindLabels: {
      0: '对白',
      1: '选项',
      2: '条件',
      3: '变量',
      4: '调用',
      5: '结束'
    }
  }
};
const BUILT_IN_VIEW_MODULES = [
  './views/form-json.js',
  './views/table.js',
  './views/graph-fixed.js',
  './views/graph-free.js',
  './views/graph-blueprint.js',
  './views/workbench.js',
  './views/text.js'
];

const fweRuntime = window.createFweRuntime({
  context: () => createViewContext(resolveDomainView(state.domain).spec)
});
const {
  viewRegistry,
  formRegistry,
  workbenchLayoutRegistry
} = fweRuntime.registries;
const { normalizeWorkbenchLayoutId } = fweRuntime;
window.fwe = fweRuntime;
window.fweRuntime = fweRuntime;

const appTitle = document.querySelector('#appTitle');
const statusText = document.querySelector('#statusText');
const workspace = document.querySelector('.workspace');
const domainSelect = document.querySelector('#domainSelect');
const fileSelect = document.querySelector('#fileSelect');
const surfaceHeader = document.querySelector('#surfaceHeader');
const surfaceTitle = document.querySelector('#surfaceTitle');
const surfaceSelection = document.querySelector('#surfaceSelection');
const newButton = document.querySelector('#newButton');
const openButton = document.querySelector('#openButton');
const saveButton = document.querySelector('#saveButton');
const undoButton = document.querySelector('#undoButton');
const redoButton = document.querySelector('#redoButton');
const addButton = document.querySelector('#addButton');
const duplicateButton = document.querySelector('#duplicateButton');
const deleteButton = document.querySelector('#deleteButton');
const resourceMoreButton = document.querySelector('#resourceMoreButton');
const resourceMenu = document.querySelector('#resourceMenu');
const surfaceMore = document.querySelector('#surfaceMore');
const surfaceMoreButton = document.querySelector('#surfaceMoreButton');
const surfaceMenu = document.querySelector('#surfaceMenu');
const domainSummary = document.querySelector('#domainSummary');
const domainSummaryCard = document.querySelector('#domainSummaryCard');
const diagnosticsRoot = document.querySelector('#diagnostics');
const diagnosticsCard = document.querySelector('#diagnosticsCard');
const inspectorForm = document.querySelector('#inspectorForm');
const inspectorFormView = document.querySelector('#inspectorFormView');
const inspectorJsonView = document.querySelector('#inspectorJsonView');
const inspectorFormModeButton = document.querySelector('#inspectorFormModeButton');
const inspectorJsonModeButton = document.querySelector('#inspectorJsonModeButton');
const jsonScopeText = document.querySelector('#jsonScopeText');
const jsonApplyButton = document.querySelector('#jsonApplyButton');
const jsonRevertButton = document.querySelector('#jsonRevertButton');
const jsonErrorText = document.querySelector('#jsonErrorText');
const editorPanel = document.querySelector('#editorPanel');
const emptyView = document.querySelector('#emptyView');
const documentView = document.querySelector('#documentView');
const documentTree = document.querySelector('#documentTree');
const tableView = document.querySelector('#tableView');
const tableHead = document.querySelector('#tableHead');
const tableBody = document.querySelector('#tableBody');
const collectionWorkbench = document.querySelector('#collectionWorkbench');
const collectionTabs = document.querySelector('#collectionTabs');
const collectionSearch = document.querySelector('#collectionSearch');
const collectionLayoutTabs = document.querySelector('#collectionLayoutTabs');
const collectionDetailButton = document.querySelector('#collectionDetailButton');
const collectionGridButton = document.querySelector('#collectionGridButton');
const collectionList = document.querySelector('#collectionList');
const collectionTitle = document.querySelector('#collectionTitle');
const collectionSubtitle = document.querySelector('#collectionSubtitle');
const collectionModeTabs = document.querySelector('#collectionModeTabs');
const collectionVariantTabs = document.querySelector('#collectionVariantTabs');
const collectionEditorBody = document.querySelector('#collectionEditorBody');
const sidepanelWorkbench = document.querySelector('#sidepanelWorkbench');
const sidepanelTabs = document.querySelector('#sidepanelTabs');
const sidepanelList = document.querySelector('#sidepanelList');
const sidepanelTitle = document.querySelector('#sidepanelTitle');
const sidepanelSubtitle = document.querySelector('#sidepanelSubtitle');
const sidepanelEditorBody = document.querySelector('#sidepanelEditorBody');
const sidepanelReferencesCard = document.querySelector('#sidepanelReferencesCard');
const sidepanelReferences = document.querySelector('#sidepanelReferences');
const sidepanelDiagnosticsCard = document.querySelector('#sidepanelDiagnosticsCard');
const sidepanelDiagnostics = document.querySelector('#sidepanelDiagnostics');
const sidepanelModeTabs = document.querySelector('#sidepanelModeTabs');
const sidepanelFormModeButton = document.querySelector('#sidepanelFormModeButton');
const sidepanelJsonModeButton = document.querySelector('#sidepanelJsonModeButton');
const graphView = document.querySelector('#graphView');
const graphViewport = document.querySelector('#graphViewport');
const graphStage = document.querySelector('#graphStage');
const graphEdges = document.querySelector('#graphEdges');
const graphNodes = document.querySelector('#graphNodes');
const graphContextMenu = document.querySelector('#graphContextMenu');
const selectMetaButton = document.querySelector('#selectMetaButton');
const viewHudResetButton = document.querySelector('#viewHudResetButton');
const viewScaleText = document.querySelector('#viewScaleText');
const textView = document.querySelector('#textView');
const inspectorTitle = document.querySelector('#inspectorTitle');
const jsonEditor = document.querySelector('#jsonEditor');

domainSelect.addEventListener('change', async () => {
  const domain = state.app.domains.find((item) => item.id === domainSelect.value);
  if (!domain || domain.id === state.domain?.id) {
    return;
  }
  if (!confirmDiscardChanges()) {
    domainSelect.value = state.domain?.id || '';
    return;
  }
  await selectDomain(domain);
});

fileSelect.addEventListener('change', async () => {
  const previousFile = state.file;
  const nextFile = state.files.find((item) => item.name === fileSelect.value) || null;
  if (!nextFile) {
    fileSelect.value = previousFile?.name || '';
    return;
  }
  if (nextFile.name === previousFile?.name && (state.data || state.text || state.domain?.kind === 'text')) {
    return;
  }
  if (!confirmDiscardChanges()) {
    fileSelect.value = previousFile?.name || '';
    return;
  }
  state.file = nextFile;
  await openSelectedFile({ skipDirtyCheck: true });
});

openButton.addEventListener('click', () => {
  closeCommandMenu(resourceMenu, resourceMoreButton);
  openSelectedFile();
});
newButton.addEventListener('click', () => {
  closeCommandMenu(resourceMenu, resourceMoreButton);
  createFile();
});
saveButton.addEventListener('click', () => saveFile());
undoButton.addEventListener('click', () => undoAction());
redoButton.addEventListener('click', () => redoAction());
addButton.addEventListener('click', () => addSelectionItem());
duplicateButton.addEventListener('click', () => duplicateSelection());
deleteButton.addEventListener('click', () => deleteSelection());
selectMetaButton.addEventListener('click', () => {
  closeCommandMenu(surfaceMenu, surfaceMoreButton);
  state.selectedKey = '';
  state.selectedEdge = null;
  state.contextGraphNodeKey = '';
  resetJsonDraftState();
  renderInspector();
  if (state.domain?.kind === 'graph') {
    renderGraph();
  }
  updateActionButtons();
});
viewHudResetButton.addEventListener('click', () => resetGraphView());
resourceMoreButton.addEventListener('click', (event) => {
  event.stopPropagation();
  toggleCommandMenu(resourceMenu, resourceMoreButton);
});
surfaceMoreButton.addEventListener('click', (event) => {
  event.stopPropagation();
  if (surfaceMoreButton.dataset.command === 'meta') {
    selectMetaButton.click();
    return;
  }
  toggleCommandMenu(surfaceMenu, surfaceMoreButton);
});
document.addEventListener('click', (event) => {
  if (!event.target?.closest?.('.resource-menu-host')) {
    closeCommandMenu(resourceMenu, resourceMoreButton);
  }
  if (!event.target?.closest?.('.surface-menu-host')) {
    closeCommandMenu(surfaceMenu, surfaceMoreButton);
  }
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    closeCommandMenu(resourceMenu, resourceMoreButton);
    closeCommandMenu(surfaceMenu, surfaceMoreButton);
  }
});
inspectorFormModeButton.addEventListener('click', () => switchInspectorMode('form'));
inspectorJsonModeButton.addEventListener('click', () => switchInspectorMode('json'));
sidepanelFormModeButton.addEventListener('click', () => switchSidepanelMode('form'));
sidepanelJsonModeButton.addEventListener('click', () => switchSidepanelMode('json'));
jsonApplyButton.addEventListener('click', () => {
  if (applyJsonDraft()) {
    renderInspector();
  }
});
jsonRevertButton.addEventListener('click', () => {
  state.jsonDirty = false;
  state.jsonError = '';
  state.jsonTargetSignature = '';
  renderInspector();
  updateActionButtons();
});
jsonEditor.addEventListener('input', () => {
  if (state.domain?.kind !== 'text') {
    state.jsonDraft = jsonEditor.value;
    state.jsonDirty = true;
    state.jsonError = '';
    setStatus(getAppLabel('jsonDraftChanged'));
    jsonApplyButton.disabled = false;
    jsonRevertButton.disabled = false;
    renderJsonError();
    updateActionButtons();
  }
});
textView.addEventListener('input', () => {
  if (state.domain?.kind === 'text') {
    if (!state.history.textBaseline) {
      state.history.textBaseline = createHistorySnapshot('编辑文本');
      pushHistorySnapshot(state.history.textBaseline);
    }
    state.text = textView.value;
    state.dirty = true;
    setStatus(getAppLabel('dirtyText', '已修改'));
    updateActionButtons();
  }
});
textView.addEventListener('blur', () => {
  state.history.textBaseline = null;
});
collectionSearch.addEventListener('input', () => {
  state.workbench.search = collectionSearch.value.trim().toLowerCase();
  renderCollectionWorkbench();
});
collectionDetailButton.addEventListener('click', () => {
  state.workbench.listLayout = 'detail';
  renderCollectionWorkbench();
});
collectionGridButton.addEventListener('click', () => {
  state.workbench.listLayout = 'grid';
  renderCollectionWorkbench();
});
graphContextMenu.addEventListener('click', (event) => {
  const button = event.target?.closest?.('button[data-action]');
  if (!button) {
    return;
  }
  event.preventDefault();
  event.stopPropagation();
  runGraphContextAction(button.dataset.action, Number(button.dataset.kind));
});
graphViewport.addEventListener('click', (event) => {
  const target = event.target;
  const graphNode = target?.closest?.('.graph-node');
  const edge = target?.closest?.('.graph-edge-hit, .graph-edge__label');
  const hud = target?.closest?.('.graph-view-hud');
  if (!graphNode && !edge && !hud) {
    state.selectedKey = '';
    state.selectedEdge = null;
    resetJsonDraftState();
    renderInspector();
    renderGraph();
    updateActionButtons();
  }
  hideGraphContextMenu();
});
graphViewport.addEventListener('wheel', (event) => {
  event.preventDefault();
  const rect = graphViewport.getBoundingClientRect();
  const pointerX = event.clientX - rect.left;
  const pointerY = event.clientY - rect.top;
  const factor = event.deltaY > 0 ? 0.9 : 1.1;
  zoomGraphView(state.view.scale * factor, pointerX, pointerY);
}, { passive: false });
graphViewport.addEventListener('mousedown', (event) => {
  if (event.button !== 2) {
    return;
  }
  state.view.pan = {
    startX: event.clientX,
    startY: event.clientY,
    baseTx: state.view.tx,
    baseTy: state.view.ty,
    moved: false
  };
});
graphViewport.addEventListener('contextmenu', (event) => {
  const nodeElement = event.target?.closest?.('.graph-node');
  if (nodeElement && state.domain?.kind === 'graph' && !isBlueprintGraph() && !state.view.pan?.moved) {
    event.preventDefault();
    event.stopPropagation();
    showGraphContextMenu(event.clientX, event.clientY, nodeElement.dataset.key);
    return;
  }
  if (state.view.pan?.moved || !nodeElement) {
    event.preventDefault();
  }
}, true);
document.addEventListener('click', (event) => {
  if (!graphContextMenu.contains(event.target)) {
    hideGraphContextMenu();
  }
});
window.addEventListener('mousemove', (event) => {
  if (!state.view.pan) {
    return;
  }
  const deltaX = event.clientX - state.view.pan.startX;
  const deltaY = event.clientY - state.view.pan.startY;
  if (!state.view.pan.moved && (Math.abs(deltaX) >= PAN_DRAG_THRESHOLD || Math.abs(deltaY) >= PAN_DRAG_THRESHOLD)) {
    state.view.pan.moved = true;
  }
  if (!state.view.pan.moved) {
    return;
  }
  state.view.tx = state.view.pan.baseTx + deltaX;
  state.view.ty = state.view.pan.baseTy + deltaY;
  clampGraphView();
  applyGraphView();
});
window.addEventListener('mouseup', (event) => {
  if (event.button === 2) {
    state.view.pan = null;
  }
});
window.addEventListener('resize', () => {
  clampGraphView();
  applyGraphView();
});
window.addEventListener('keydown', (event) => {
  const key = event.key.toLowerCase();
  const editable = event.target?.matches?.('input, textarea, select');
  if ((event.ctrlKey || event.metaKey) && key === 's') {
    event.preventDefault();
    saveFile({ sourceElement: event.target });
    return;
  }
  if ((event.ctrlKey || event.metaKey) && key === 'z' && !editable) {
    event.preventDefault();
    if (event.shiftKey) {
      redoAction();
    } else {
      undoAction();
    }
    return;
  }
  if ((event.ctrlKey || event.metaKey) && key === 'y' && !editable) {
    event.preventDefault();
    redoAction();
  }
});

init().catch((error) => {
  setStatus(error.message, true);
});

async function init() {
  state.app = await api('/api/app');
  await loadBuiltInViewModules();
  await loadClientExtensions(state.app.extensions || state.app.clientExtensions || []);
  validateAllDomainViews();
  validateAllDomainForms();
  appTitle.textContent = state.app.title;
  applyAppLabels();
  domainSelect.innerHTML = '';
  for (const domain of state.app.domains) {
    const option = document.createElement('option');
    option.value = domain.id;
    option.textContent = domain.title;
    domainSelect.append(option);
  }
  selectDomain(state.app.domains[0]);
}

function applyAppLabels() {
  openButton.textContent = getAppLabel('open');
  newButton.textContent = getAppLabel('new');
  saveButton.textContent = getAppLabel('save');
  undoButton.textContent = getAppLabel('undo');
  redoButton.textContent = getAppLabel('redo');
  addButton.textContent = getAppLabel('add');
  duplicateButton.textContent = getAppLabel('duplicate');
  deleteButton.textContent = getAppLabel('delete');
  inspectorTitle.textContent = getAppLabel('inspector');
  inspectorFormModeButton.textContent = getAppLabel('form');
  inspectorJsonModeButton.textContent = getAppLabel('json');
  sidepanelFormModeButton.textContent = getAppLabel('form');
  sidepanelJsonModeButton.textContent = getAppLabel('json');
  jsonApplyButton.textContent = getAppLabel('apply');
  jsonRevertButton.textContent = getAppLabel('revert');
  collectionSearch.placeholder = getAppLabel('search');
  collectionDetailButton.textContent = getAppLabel('detail');
  collectionGridButton.textContent = getAppLabel('grid');
  resourceMoreButton.title = getAppLabel('more');
  surfaceMoreButton.title = getAppLabel('more');
  viewHudResetButton.textContent = getAppLabel('reset');
  viewHudResetButton.title = getAppLabel('reset');
}

function getAppLabel(key, fallback = '') {
  return state.app?.labels?.[key] ?? DEFAULT_LABELS[key] ?? fallback ?? key;
}

function formatAppLabel(key, fallback, values = {}) {
  const template = getAppLabel(key, fallback);
  return String(template).replace(/\{([^}]+)\}/g, (_, name) => values[name] ?? '');
}

function toggleCommandMenu(menu, button) {
  const willOpen = menu.classList.contains('hidden');
  closeCommandMenu(resourceMenu, resourceMoreButton);
  closeCommandMenu(surfaceMenu, surfaceMoreButton);
  menu.classList.toggle('hidden', !willOpen);
  button.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
}

function closeCommandMenu(menu, button) {
  if (!menu || !button) {
    return;
  }
  menu.classList.add('hidden');
  button.setAttribute('aria-expanded', 'false');
}

async function loadBuiltInViewModules() {
  for (const url of BUILT_IN_VIEW_MODULES) {
    await loadScript(url, `built-in view ${url}`);
  }
}

async function loadClientExtensions(entries) {
  const list = Array.isArray(entries) ? entries : [];
  for (const entry of list) {
    await loadClientExtension(entry);
  }
}

function loadClientExtension(entry) {
  return new Promise((resolve, reject) => {
    if (!entry?.url) {
      resolve();
      return;
    }
    loadScript(entry.url, `client extension ${entry.name || entry.url}`).then(resolve, reject);
  });
}

function loadScript(url, label = url) {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = url;
    script.async = false;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(formatAppLabel('loadScriptFailed', '加载失败：{label}', { label })));
    document.head.append(script);
  });
}

function resetWorkbenchState(domain = state.domain) {
  const collections = getWorkbenchCollections(domain);
  const defaultState = getWorkbenchDefault(domain);
  const initialCollectionId = defaultState.collection || collections[0]?.id || '';
  state.workbench = {
    collectionId: initialCollectionId,
    listLayout: defaultState.list,
    search: '',
    mode: defaultState.mode,
    variant: ''
  };
  if (collectionSearch) {
    collectionSearch.value = '';
  }
}

async function selectDomain(domain) {
  state.domain = domain;
  state.file = null;
  state.data = null;
  state.text = '';
  state.selectedKey = '';
  state.selectedEdge = null;
  resetWorkbenchState(domain);
  resetJsonDraftState();
  state.view.resetPending = true;
  state.dirty = false;
  resetHistory();
  domainSelect.value = domain.id;
  renderDomainSummary();
  await loadFiles();
  if (state.file) {
    await openSelectedFile({ skipDirtyCheck: true });
  } else {
    render();
  }
}

async function loadFiles() {
  const result = await api(`/api/domains/${encodeURIComponent(state.domain.id)}/files`);
  state.files = result.files || [];
  fileSelect.innerHTML = '';
  for (const file of state.files) {
    const option = document.createElement('option');
    option.value = file.name;
    option.textContent = file.name;
    fileSelect.append(option);
  }
  state.file = state.files[0] || null;
  if (state.file) {
    fileSelect.value = state.file.name;
  }
  setStatus(`${state.domain.title}: ${state.files.length} ${getAppLabel('files')}`);
}

async function openSelectedFile(options = {}) {
  if (!state.file) {
    setStatus(getAppLabel('noFileSelected'), true);
    return;
  }
  if (!options.skipDirtyCheck && !confirmDiscardChanges()) {
    return;
  }

  const result = await api(`/api/domains/${encodeURIComponent(state.domain.id)}/files/${encodeURIComponent(state.file.name)}`);
  state.file = { name: result.name, path: result.path };
  if (result.type === 'text') {
    state.text = result.content || '';
    state.data = null;
  } else {
    state.data = result.data;
    state.text = '';
  }
  state.selectedKey = '';
  state.selectedEdge = null;
  resetWorkbenchState(state.domain);
  resetJsonDraftState();
  state.view.resetPending = true;
  state.dirty = false;
  resetHistory();
  setStatus(`${getAppLabel('opened')} ${state.file.name}`);
  render();
}

async function createFile() {
  if (!confirmDiscardChanges()) {
    return;
  }
  const defaults = state.domain.defaults || {};
  const fallback = defaults.fileName || (state.domain.kind === 'text' ? 'new.txt' : 'new.json');
  const name = window.prompt(getAppLabel('newFileName'), fallback);
  if (!name) {
    return;
  }

  state.file = { name };
  state.data = clone(defaults.data || {});
  state.text = defaults.text || '';
  state.selectedKey = '';
  state.selectedEdge = null;
  resetWorkbenchState(state.domain);
  resetJsonDraftState();
  state.view.resetPending = true;
  state.dirty = true;
  resetHistory();
  if (!state.files.some((file) => file.name === name)) {
    state.files.push({ name, exists: false });
    state.files.sort((a, b) => a.name.localeCompare(b.name));
    renderFileSelect();
  }
  fileSelect.value = name;
  setStatus(`${getAppLabel('createdDraft')} ${name}`);
  render();
}

async function saveFile(options = {}) {
  if (!state.file) {
    setStatus(getAppLabel('noFileToSave'), true);
    return;
  }

  commitFocusedInspectorControl(options.sourceElement);

  let payload;
  if (state.domain.kind === 'text') {
    payload = { content: textView.value };
  } else {
    if (state.inspectorMode === 'json' && state.jsonDirty && !applyJsonDraft({ rerender: false })) {
      return;
    }
    const diagnostics = validateCurrent();
    const blocking = diagnostics.filter((item) => (item.level || 'error') === 'error');
    if (blocking.length && state.domain.save?.allowInvalid !== true) {
      renderDiagnostics(diagnostics);
      setStatus(formatAppLabel('saveBlocked', '保存被阻止：{count} 个错误', { count: blocking.length }), true);
      return;
    }
    payload = { data: state.data };
  }

  await api(`/api/domains/${encodeURIComponent(state.domain.id)}/files/${encodeURIComponent(state.file.name)}`, {
    method: 'PUT',
    body: JSON.stringify(payload)
  });
  state.dirty = false;
  setStatus(`${getAppLabel('saved')} ${state.file.name}`);
  await loadFiles();
  fileSelect.value = state.file.name;
  render();
}

function commitFocusedInspectorControl(sourceElement = null) {
  const activeControl = document.activeElement?.matches?.('input, textarea, select')
    ? document.activeElement
    : null;
  const pendingControl = state.pendingInspectorControl?.isConnected ? state.pendingInspectorControl : null;
  const control = sourceElement?.matches?.('input, textarea, select')
    ? sourceElement
    : activeControl || pendingControl;
  if (!control || !control.matches?.('input, textarea, select')) {
    return;
  }
  if (!inspectorForm.contains(control) && !collectionEditorBody.contains(control) && !sidepanelEditorBody.contains(control)) {
    return;
  }
  control.dispatchEvent(new Event('change', { bubbles: true }));
  if (state.pendingInspectorControl === control) {
    state.pendingInspectorControl = null;
  }
  if (control === document.activeElement) {
    control.blur();
  }
}

function renderFileSelect() {
  fileSelect.innerHTML = '';
  for (const file of state.files) {
    const option = document.createElement('option');
    option.value = file.name;
    option.textContent = file.exists === false ? `${file.name} *` : file.name;
    fileSelect.append(option);
  }
}

function resetHistory() {
  state.history.undo = [];
  state.history.redo = [];
  state.history.textBaseline = null;
  state.history.dragBaseline = null;
  updateActionButtons();
}

function createHistorySnapshot(label = '') {
  return {
    label,
    domainId: state.domain?.id || '',
    fileName: state.file?.name || '',
    data: state.data === null || state.data === undefined ? null : clone(state.data),
    text: state.text,
    selectedKey: state.selectedKey,
    inspectorMode: state.inspectorMode
  };
}

function pushHistory(label) {
  if (!state.file) {
    return;
  }
  pushHistorySnapshot(createHistorySnapshot(label));
}

function pushHistorySnapshot(snapshot) {
  if (!snapshot?.fileName) {
    return;
  }
  const currentKey = JSON.stringify({
    data: snapshot.data,
    text: snapshot.text,
    selectedKey: snapshot.selectedKey
  });
  const previous = state.history.undo[state.history.undo.length - 1];
  if (previous?.key === currentKey) {
    return;
  }
  state.history.undo.push({ ...snapshot, key: currentKey });
  if (state.history.undo.length > state.history.limit) {
    state.history.undo.shift();
  }
  state.history.redo = [];
  updateActionButtons();
}

function undoAction() {
  if (!state.history.undo.length) {
    return;
  }
  const current = createHistorySnapshot('重做点');
  state.history.redo.push({ ...current, key: JSON.stringify({ data: current.data, text: current.text, selectedKey: current.selectedKey }) });
  const snapshot = state.history.undo.pop();
  restoreHistorySnapshot(snapshot, getAppLabel('undo'));
}

function redoAction() {
  if (!state.history.redo.length) {
    return;
  }
  const current = createHistorySnapshot('撤销点');
  state.history.undo.push({ ...current, key: JSON.stringify({ data: current.data, text: current.text, selectedKey: current.selectedKey }) });
  const snapshot = state.history.redo.pop();
  restoreHistorySnapshot(snapshot, getAppLabel('redo'));
}

function restoreHistorySnapshot(snapshot, label) {
  state.data = snapshot.data === null || snapshot.data === undefined ? null : clone(snapshot.data);
  state.text = snapshot.text || '';
  state.selectedKey = snapshot.selectedKey || '';
  state.selectedEdge = null;
  state.inspectorMode = snapshot.inspectorMode || 'form';
  resetJsonDraftState();
  state.dirty = true;
  setStatus(`${label}: ${snapshot.label || state.file?.name || ''}`);
  render();
  updateActionButtons();
}

function confirmDiscardChanges() {
  if (!state.dirty && !state.jsonDirty) {
    return true;
  }
  return window.confirm(getAppLabel('discardUnsavedChanges'));
}

function updateActionButtons() {
  const hasFile = !!state.file;
  setCommandVisible(undoButton, isActionVisible('undo'));
  setCommandVisible(redoButton, isActionVisible('redo'));
  setCommandVisible(addButton, hasSurfaceActions() && isActionVisible('add'));
  setCommandVisible(duplicateButton, hasSurfaceActions() && isActionVisible('duplicate'));
  setCommandVisible(deleteButton, hasSurfaceActions() && isActionVisible('delete'));
  setCommandVisible(selectMetaButton, state.domain?.kind === 'graph');
  selectMetaButton.textContent = getGraphLabel('metaButton', getAppLabel('metaButton'));
  undoButton.disabled = !state.history.undo.length;
  redoButton.disabled = !state.history.redo.length;
  newButton.disabled = !state.domain;
  openButton.disabled = !hasFile;
  addButton.disabled = !hasFile || state.domain?.kind === 'text' || isSidepanelPreviewActive();
  duplicateButton.disabled = !canDuplicateSelection() || isSidepanelPreviewActive();
  deleteButton.disabled = !canDeleteSelection() || isSidepanelPreviewActive();
  saveButton.disabled = !hasFile || (!state.dirty && !state.jsonDirty);
  updateSurfaceMoreVisibility();
  updateSurfaceHeader();
}

function setCommandVisible(button, visible) {
  button.hidden = !visible;
}

function hasSurfaceActions() {
  return !!state.file && state.domain?.kind !== 'text' && !isBlueprintGraph();
}

function updateSurfaceMoreVisibility() {
  const metaVisible = !selectMetaButton.hidden;
  const hasDirectAction = [addButton, duplicateButton, deleteButton].some((button) => !button.hidden);
  surfaceMore.classList.toggle('hidden', !metaVisible);
  if (!metaVisible) {
    closeCommandMenu(surfaceMenu, surfaceMoreButton);
    surfaceMoreButton.dataset.command = '';
    surfaceMoreButton.textContent = '...';
    surfaceMoreButton.setAttribute('aria-haspopup', 'menu');
    surfaceMoreButton.setAttribute('aria-label', getAppLabel('more'));
    return;
  }

  if (hasDirectAction) {
    surfaceMoreButton.dataset.command = '';
    surfaceMoreButton.textContent = '...';
    surfaceMoreButton.setAttribute('aria-haspopup', 'menu');
    surfaceMoreButton.setAttribute('aria-label', getAppLabel('more'));
    return;
  }

  closeCommandMenu(surfaceMenu, surfaceMoreButton);
  surfaceMoreButton.dataset.command = 'meta';
  surfaceMoreButton.textContent = selectMetaButton.textContent || getAppLabel('metaButton');
  surfaceMoreButton.setAttribute('aria-haspopup', 'false');
  surfaceMoreButton.setAttribute('aria-label', surfaceMoreButton.textContent);
}

function updateSurfaceHeader() {
  const hasFile = !!state.file && (state.data || state.text || state.domain?.kind === 'text');
  const hasVisibleAction = [addButton, duplicateButton, deleteButton, selectMetaButton].some((button) => !button.hidden);
  const hidden = !hasFile || !hasVisibleAction;
  surfaceHeader.classList.toggle('hidden', hidden);
  if (hidden) {
    closeCommandMenu(surfaceMenu, surfaceMoreButton);
  }
  surfaceTitle.textContent = state.domain?.title || getAppLabel('editor');
  surfaceSelection.textContent = getSurfaceSelectionText();
}

function getSurfaceSelectionText() {
  if (!state.file) {
    return '';
  }
  if (state.selectedEdge) {
    return getGraphLabel('edgeKind', '连线');
  }
  if (state.selectedKey) {
    return formatSurfaceSelectionKey(state.selectedKey);
  }
  return state.file.name || '';
}

function formatSurfaceSelectionKey(key) {
  if (state.domain?.kind === 'graph' && state.data) {
    const graph = isBlueprintGraph() ? buildBlueprintModel() : buildGraphModel();
    const node = graph.nodeMap.get(key);
    if (node) {
      const label = node.text || node.value?.title || node.value?.name || node.title || node.typeSpec?.title || '';
      return `#${node.id} ${label}`.trim();
    }
  }
  return String(key || '');
}

function isActionVisible(action) {
  const actions = state.domain?.actions || {};
  const toolbar = actions.toolbar;
  if (Array.isArray(toolbar)) {
    return toolbar.includes(action);
  }
  if (toolbar && typeof toolbar === 'object') {
    return toolbar[action] !== false && toolbar[action] !== undefined;
  }
  return actions[action] !== false;
}

function addSelectionItem() {
  if (!state.data || state.domain?.kind === 'text') {
    return;
  }
  if (state.domain?.kind === 'graph' && !isBlueprintGraph() && !isDialogGraphProfile() && addGraphSelectionItem()) {
    return;
  }
  const targetPath = getActionInsertPath();
  if (!targetPath) {
    return;
  }
  const rows = ensureArray(getByPath(state.data, targetPath));
  pushHistory(`添加 ${targetPath}`);
  rows.push(createDefaultItemForPath(targetPath));
  setByPath(state.data, targetPath, rows);
  state.selectedKey = `${targetPath}[${rows.length - 1}]`;
  state.selectedEdge = null;
  markDirtyAndRender(`已添加 ${targetPath}`);
}

function duplicateSelection() {
  const info = getSelectedPathInfo();
  if (!info?.exists) {
    return;
  }
  pushHistory(`复制 ${info.path}`);
  if (info.parentIsArray) {
    const copy = clone(info.value);
    ensureUniqueIdentity(copy, info.parentPath);
    info.parent.splice(info.key + 1, 0, copy);
    if (state.domain?.kind === 'graph') {
      const collection = getGraphCollectionNameForPath(info.parentPath);
      const idKey = getGraphCollectionIdKey(collection);
      state.selectedKey = `${collection}:${copy?.[idKey]}`;
    } else {
      state.selectedKey = `${info.parentPath}[${info.key + 1}]`;
    }
  } else {
    const nextKey = window.prompt(getAppLabel('duplicateAsKey'), `${String(info.key)}Copy`);
    if (!nextKey) {
      state.history.undo.pop();
      updateActionButtons();
      return;
    }
    info.parent[nextKey] = clone(info.value);
    state.selectedKey = info.parentPath ? `${info.parentPath}.${nextKey}` : nextKey;
  }
  state.selectedEdge = null;
  markDirtyAndRender(`已复制 ${info.path}`);
}

function deleteSelection() {
  if (state.domain?.kind === 'graph' && !isBlueprintGraph() && !isDialogGraphProfile() && deleteGraphSelectionItem()) {
    return;
  }
  const info = getSelectedPathInfo();
  if (!info?.exists || info.path === '') {
    return;
  }
  const refs = findReferencesToSelection(info);
  const suffix = refs.length ? `\n\n${getAppLabel('referencedBy')}\n${refs.slice(0, 12).join('\n')}` : '';
  if (!window.confirm(`${formatAppLabel('deleteSelectionConfirm', '删除 {path}？', { path: info.path })}${suffix}`)) {
    return;
  }
  pushHistory(`删除 ${info.path}`);
  if (info.parentIsArray) {
    info.parent.splice(info.key, 1);
  } else {
    delete info.parent[info.key];
  }
  state.selectedKey = '';
  state.selectedEdge = null;
  markDirtyAndRender(`已删除 ${info.path}`);
}

function canDuplicateSelection() {
  const info = getSelectedPathInfo();
  return !!info?.exists && state.domain?.kind !== 'text' && !state.selectedEdge && info.path !== '';
}

function canDeleteSelection() {
  const info = getSelectedPathInfo();
  return !!info?.exists && state.domain?.kind !== 'text' && !state.selectedEdge && info.path !== '';
}

function addGraphSelectionItem() {
  const graph = buildGraphModel();
  const selected = graph.nodeMap.get(state.selectedKey);
  const selectedNode = selected && !isVirtualGraphNode(selected)
    ? selected
    : null;

  const mutation = selectedNode ? getDefaultGenericGraphAddMutation(selectedNode, graph) : null;
  if (mutation && runGenericGraphMutation(selectedNode, mutation, graph)) {
    return true;
  }

  const targetPath = state.domain.graph?.nodes || state.domain.model?.nodes || 'nodes';
  const rows = ensureArray(getByPath(state.data, targetPath));
  const selectedBaseNode = selectedNode?.collection === graph.baseCollection ? selectedNode : null;
  const edgeRule = getPrimaryEditableGraphEdgeRule(graph.baseCollection);
  const item = createDefaultItemForPath(targetPath);
  const idKey = getGraphCollectionIdKey(graph.baseCollection);
  const itemId = item?.[idKey];

  pushHistory(`添加 ${targetPath}`);
  if (selectedBaseNode && edgeRule && itemId !== undefined && itemId !== null && itemId !== '') {
    const previousTarget = getByPath(selectedBaseNode.value, edgeRule.field);
    if (previousTarget !== undefined && previousTarget !== null && previousTarget !== '') {
      setByPath(item, edgeRule.field, previousTarget);
    }
    setByPath(selectedBaseNode.value, edgeRule.field, itemId);
  }
  rows.push(item);
  setByPath(state.data, targetPath, rows);
  state.selectedKey = `${graph.baseCollection}:${itemId}`;
  state.selectedEdge = null;
  markDirtyAndRender(`已添加 ${targetPath}`);
  return true;
}

function deleteGraphSelectionItem() {
  const graph = buildGraphModel();
  const node = graph.nodeMap.get(state.selectedKey);
  if (!node || isVirtualGraphNode(node)) {
    return false;
  }

  const pathText = getGraphNodeDataPath(node);
  const info = getPathInfo(pathText);
  if (!info?.exists || !info.parentIsArray) {
    return false;
  }

  const refs = findReferencesToSelection(info);
  const suffix = refs.length ? `\n\n${getAppLabel('referencedBy')}\n${refs.slice(0, 12).join('\n')}` : '';
  if (!window.confirm(`${formatAppLabel('deleteSelectionConfirm', '删除 {path}？', { path: info.path })}${suffix}`)) {
    return true;
  }

  const idKey = getGraphCollectionIdKey(node.collection);
  const removedId = node.value?.[idKey] ?? node.id;
  const edgeRule = node.collection === graph.baseCollection
    ? getPrimaryEditableGraphEdgeRule(node.collection)
    : null;
  const fallback = getGraphDeleteFallbackTarget(node, edgeRule, graph, removedId);

  pushHistory(`删除 ${info.path}`);
  rewriteGraphReferences(node.collection, removedId, fallback);
  info.parent.splice(info.key, 1);
  if (node.collection === graph.baseCollection) {
    updateGraphEntryAfterDelete(removedId, fallback, graph);
  }
  state.selectedKey = '';
  state.selectedEdge = null;
  markDirtyAndRender(`已删除 ${info.path}`);
  return true;
}

function getDefaultGenericGraphAddMutation(node, graph) {
  if (typeof getGenericGraphMutationActions !== 'function') {
    return null;
  }
  const actions = getGenericGraphMutationActions(node, graph)
    .filter((action) => action.type !== 'delete' && action.default !== false);
  return actions.find((action) => action.default === true) || actions[0] || null;
}

function runGenericGraphMutation(node, action, graph = buildGraphModel()) {
  if (!node || !action) {
    return false;
  }
  if (action.type === 'delete') {
    state.selectedKey = node.key;
    return deleteGraphSelectionItem();
  }
  if (action.type === 'append' || action.type === 'add-child' || action.type === 'add-reference') {
    return appendGenericGraphReference(node, action, graph);
  }
  if (action.type === 'chain' || action.type === 'add-next') {
    return chainGenericGraphNode(node, action, graph);
  }
  return false;
}

function chainGenericGraphNode(node, action, graph) {
  const edgeField = action.edge || action.field || 'next';
  const targetCollection = action.target || action.collection || graph.baseCollection;
  const targetPath = getGraphCollectionPath(targetCollection);
  const rows = ensureArray(getByPath(state.data, targetPath));
  const item = createDefaultGraphCollectionItem(targetCollection);
  const idKey = getGraphCollectionIdKey(targetCollection);
  const itemId = item?.[idKey];
  if (itemId === undefined || itemId === null || itemId === '') {
    return false;
  }

  const previousTarget = getByPath(node.value, edgeField);
  pushHistory(action.historyLabel || `${action.label || '添加'} ${targetPath}`);
  if (action.carry !== false && !isGraphEmptyMutationValue(previousTarget, action)) {
    setByPath(item, action.carryTo || edgeField, previousTarget);
  }
  setByPath(node.value, edgeField, itemId);
  applyGenericGraphMutationClears(node.value, action);
  rows.push(item);
  setByPath(state.data, targetPath, rows);
  state.selectedKey = `${targetCollection}:${itemId}`;
  state.selectedEdge = null;
  markDirtyAndRender(action.doneLabel || `已添加 ${targetPath}`);
  return true;
}

function appendGenericGraphReference(node, action) {
  const edgeField = action.edge || action.field;
  const targetCollection = action.target || action.collection;
  if (!edgeField || !targetCollection) {
    return false;
  }

  const targetPath = getGraphCollectionPath(targetCollection);
  const rows = ensureArray(getByPath(state.data, targetPath));
  const item = createDefaultGraphCollectionItem(targetCollection);
  const idKey = getGraphCollectionIdKey(targetCollection);
  const itemId = item?.[idKey];
  if (itemId === undefined || itemId === null || itemId === '') {
    return false;
  }

  pushHistory(action.historyLabel || `${action.label || '添加'} ${targetPath}`);
  const current = getByPath(node.value, edgeField);
  const refs = Array.isArray(current)
    ? [...current]
    : (isGraphEmptyMutationValue(current, action) ? [] : [current]);
  refs.push(itemId);
  setByPath(node.value, edgeField, refs);
  applyGenericGraphMutationClears(node.value, action);
  rows.push(item);
  setByPath(state.data, targetPath, rows);
  state.selectedKey = `${targetCollection}:${itemId}`;
  state.selectedEdge = null;
  markDirtyAndRender(action.doneLabel || `已添加 ${targetPath}`);
  return true;
}

function applyGenericGraphMutationClears(target, action) {
  ensureArray(action.clear, { scalar: true }).forEach((pathText) => {
    if (action.clearValue !== undefined) {
      setByPath(target, pathText, clone(action.clearValue));
    } else {
      deleteByPath(target, pathText);
    }
  });
}

function createDefaultGraphCollectionItem(collection) {
  const pathText = getGraphCollectionPath(collection);
  const item = createDefaultItemForPath(pathText);
  const idKey = getGraphCollectionIdKey(collection);
  if (item && typeof item === 'object' && !Array.isArray(item)
    && (item[idKey] === undefined || item[idKey] === null || item[idKey] === '')) {
    item[idKey] = getNextNumericId(getByPath(state.data, pathText), idKey);
  }
  return item;
}

function getGraphCollectionPath(collection) {
  const model = state.domain.model || {};
  const graph = state.domain.graph || {};
  if (collection === getBaseGraphCollection()) {
    return graph.nodes || model.nodes || collection;
  }
  return graph[collection] || model[collection] || collection;
}

function isGraphEmptyMutationValue(value, action = {}) {
  const configured = ensureArray(action.emptyValues, { scalar: true });
  if (configured.length && configured.map(String).includes(String(value))) {
    return true;
  }
  return value === undefined || value === null || value === '';
}

function getPathInfo(pathText) {
  if (!pathText) {
    return { exists: false, path: pathText || '' };
  }
  const parts = parsePathParts(pathText);
  if (!parts.length) {
    return { exists: false, path: pathText };
  }
  const key = parts[parts.length - 1];
  const parentPath = formatPathParts(parts.slice(0, -1));
  const parent = parentPath ? getByPath(state.data, parentPath) : state.data;
  if (!parent || typeof parent !== 'object') {
    return { exists: false, path: pathText };
  }
  return {
    exists: Object.prototype.hasOwnProperty.call(parent, key),
    path: pathText,
    parentPath,
    parent,
    key,
    value: parent[key],
    parentIsArray: Array.isArray(parent)
  };
}

function getPrimaryEditableGraphEdgeRule(collection) {
  const baseCollection = getBaseGraphCollection();
  return (state.domain.graph?.edges || [])
    .map(parseEdgeRule)
    .filter(Boolean)
    .find((rule) => rule.sourceCollection === collection && rule.targetCollection === baseCollection)
    || null;
}

function getGraphDeleteFallbackTarget(node, edgeRule, graph, removedId) {
  if (!edgeRule) {
    return null;
  }
  const value = getByPath(node.value, edgeRule.field);
  const candidates = Array.isArray(value) ? value : [value];
  return candidates.find((item) => isValidGraphDeleteFallback(item, edgeRule, graph, removedId)) ?? null;
}

function isValidGraphDeleteFallback(value, edgeRule, graph, removedId) {
  if (value === null || value === undefined || value === '') {
    return false;
  }
  if (String(value) === String(removedId)) {
    return false;
  }
  const targetCollection = edgeRule?.targetCollection || graph?.baseCollection || getBaseGraphCollection();
  return !!graph?.nodeMap?.has?.(`${targetCollection}:${value}`);
}

function rewriteGraphReferences(removedCollection, removedId, fallback) {
  (state.domain.graph?.edges || [])
    .map(parseEdgeRule)
    .filter(Boolean)
    .filter((rule) => rule.targetCollection === removedCollection)
    .forEach((rule) => {
      const sourcePath = state.domain.model?.[rule.sourceCollection] || rule.sourceCollection;
      ensureArray(getByPath(state.data, sourcePath)).forEach((item) => {
        rewriteGraphReferenceAtPath(item, rule.field, removedId, fallback);
      });
    });
}

function rewriteGraphReferenceAtPath(root, pathText, removedId, fallback) {
  const parts = parsePathParts(pathText);
  if (!parts.length) {
    return;
  }

  const visit = (value, index) => {
    if (value === null || value === undefined) {
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((item) => visit(item, index));
      return;
    }
    if (typeof value !== 'object') {
      return;
    }

    const key = parts[index];
    if (index === parts.length - 1) {
      if (!Object.prototype.hasOwnProperty.call(value, key)) {
        return;
      }
      value[key] = rewriteGraphReferenceValue(value[key], removedId, fallback);
      return;
    }
    visit(value[key], index + 1);
  };

  visit(root, 0);
}

function rewriteGraphReferenceValue(value, removedId, fallback) {
  if (Array.isArray(value)) {
    return value
      .map((item) => (String(item) === String(removedId) ? fallback : item))
      .filter((item) => item !== null && item !== undefined && item !== '');
  }
  return String(value) === String(removedId) ? fallback : value;
}

function updateGraphEntryAfterDelete(removedId, fallback, graph) {
  const entryPath = state.domain.graph?.entry || state.domain.model?.entry || 'entry';
  if (!entryPath || String(getByPath(state.data, entryPath)) !== String(removedId)) {
    return;
  }
  const rowsPath = state.domain.model?.[graph.baseCollection] || graph.baseCollection;
  const idKey = getGraphCollectionIdKey(graph.baseCollection);
  const remaining = ensureArray(getByPath(state.data, rowsPath))
    .filter((item) => String(item?.[idKey]) !== String(removedId));
  setByPath(state.data, entryPath, fallback ?? remaining[0]?.[idKey] ?? null);
}

function getActionInsertPath() {
  if (isSidepanelPreviewActive()) {
    return '';
  }
  if (isCollectionWorkbench()) {
    return getActiveWorkbenchCollection()?.path || '';
  }
  if (state.domain?.kind === 'table') {
    return state.domain.model?.rows || 'items';
  }
  if (state.domain?.kind === 'graph') {
    return state.domain.graph?.nodes || state.domain.model?.nodes || 'nodes';
  }
  const context = buildInspectorContext();
  const value = context.target;
  if (Array.isArray(value) && context.targetPath) {
    return context.targetPath;
  }
  const key = window.prompt(getAppLabel('newFieldName'), 'field');
  if (!key) {
    return '';
  }
  pushHistory(`添加 ${key}`);
  const target = value && typeof value === 'object' && !Array.isArray(value) ? value : state.data;
  target[key] = '';
  state.selectedKey = context.targetPath ? `${context.targetPath}.${key}` : key;
  state.selectedEdge = null;
  markDirtyAndRender(`已添加 ${key}`);
  return '';
}

function createDefaultItemForPath(pathText) {
  const actions = state.domain.actions || {};
  const configured = actions.defaults?.[pathText] ?? actions.defaultItem;
  if (configured !== undefined) {
    const item = clone(configured);
    ensureUniqueIdentity(item, pathText);
    return item;
  }
  if (state.domain.kind === 'table') {
    const item = clone(state.domain.defaults?.row || {});
    ensureUniqueIdentity(item, pathText);
    return item;
  }
  if (isCollectionWorkbench()) {
    const collection = getWorkbenchCollections().find((item) => item.path === pathText);
    const item = clone(collection?.defaultItem || {});
    const idKey = getCollectionIdKey(collection);
    if (item[idKey] === undefined || item[idKey] === null || item[idKey] === '') {
      item[idKey] = getNextIdentityValue(getByPath(state.data, pathText), idKey, collection?.idPrefix || singular(collection?.id || 'item'));
    } else {
      ensureUniqueIdentity(item, pathText);
    }
    return item;
  }
  if (state.domain.kind === 'graph') {
    const collection = getGraphCollectionNameForPath(pathText);
    const idKey = getGraphCollectionIdKey(collection);
    const kindKey = collection === getBaseGraphCollection() ? (state.domain.graph?.nodeKind || 'kind') : '';
    const item = {
      [idKey]: getNextNumericId(getByPath(state.data, pathText), idKey)
    };
    if (kindKey) {
      item[kindKey] = state.domain.defaults?.nodeKind ?? 0;
    }
    return item;
  }
  return {};
}

function ensureUniqueIdentity(item, collectionPath) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) {
    return;
  }
  const idKey = getCollectionIdentityKey(collectionPath);
  if (!idKey || item[idKey] === undefined || item[idKey] === null || item[idKey] === '') {
    return;
  }
  if (typeof item[idKey] === 'number') {
    item[idKey] = getNextNumericId(getByPath(state.data, collectionPath), idKey);
  } else {
    const base = String(item[idKey]);
    const rows = ensureArray(getByPath(state.data, collectionPath));
    let index = 2;
    let next = `${base}_copy`;
    while (rows.some((row) => String(row?.[idKey]) === next)) {
      next = `${base}_copy${index}`;
      index += 1;
    }
    item[idKey] = next;
  }
}

function getCollectionIdentityKey(collectionPath) {
  if (isCollectionWorkbench()) {
    const collection = getWorkbenchCollections().find((item) => item.path === collectionPath);
    if (collection) {
      return getCollectionIdKey(collection);
    }
  }
  if (state.domain.kind === 'table' && collectionPath === (state.domain.model?.rows || 'items')) {
    return state.domain.model?.rowId || 'id';
  }
  if (state.domain.kind === 'graph') {
    const collection = getGraphCollectionNameForPath(collectionPath);
    return getGraphCollectionIdKey(collection);
  }
  return state.domain.source?.identity || 'id';
}

function getGraphCollectionNameForPath(collectionPath) {
  const model = state.domain.model || {};
  const graph = state.domain.graph || {};
  const match = Object.entries(model).find(([, pathText]) => pathText === collectionPath);
  if (match) {
    return match[0];
  }
  const graphMatch = Object.entries(graph).find(([, pathText]) => pathText === collectionPath);
  if (graphMatch) {
    return graphMatch[0];
  }
  if (collectionPath === (graph.nodes || model.nodes || 'nodes')) {
    return getBaseGraphCollection();
  }
  return collectionPath;
}

function getNextIdentityValue(rows, idKey, prefix) {
  const list = ensureArray(rows);
  const numeric = list
    .map((item) => Number(item?.[idKey]))
    .filter((value) => Number.isFinite(value));
  if (numeric.length) {
    return Math.max(...numeric) + 1;
  }
  let index = 1;
  let next = `${prefix}_${index}`;
  while (list.some((item) => String(item?.[idKey]) === next)) {
    index += 1;
    next = `${prefix}_${index}`;
  }
  return next;
}

function getNextNumericId(rows, idKey) {
  const values = ensureArray(rows)
    .map((item) => Number(item?.[idKey]))
    .filter((value) => Number.isFinite(value));
  return values.length ? Math.max(...values) + 1 : 1;
}

function getSelectedPathInfo() {
  const context = buildInspectorContext();
  const pathText = context.targetPath || state.selectedKey || '';
  if (!pathText || context.readonly) {
    return { exists: false, path: pathText };
  }
  const parts = parsePathParts(pathText);
  if (!parts.length) {
    return { exists: false, path: pathText };
  }
  const key = parts[parts.length - 1];
  const parentPath = formatPathParts(parts.slice(0, -1));
  const parent = parentPath ? getByPath(state.data, parentPath) : state.data;
  if (!parent || typeof parent !== 'object') {
    return { exists: false, path: pathText };
  }
  return {
    exists: Object.prototype.hasOwnProperty.call(parent, key),
    path: pathText,
    parentPath,
    parent,
    key,
    value: parent[key],
    parentIsArray: Array.isArray(parent)
  };
}

function markDirtyAndRender(message) {
  state.dirty = true;
  resetJsonDraftState();
  setStatus(formatAppLabel('dirty', '已修改 - {title}', { title: message }));
  render();
}

function getDomainViews(domain = state.domain) {
  const configured = readConfiguredViewSpecs(domain);
  if (configured.length) {
    return configured.map((view) => normalizeViewSpec(view, domain));
  }
  return [legacyViewForDomain(domain)];
}

function getWorkbenchDefault(domain = state.domain, view = null) {
  const workbench = domain?.workbench || {};
  const viewDefault = readDefaultObject(view?.default);
  const workbenchDefault = readDefaultObject(workbench.default);
  const collections = getWorkbenchCollections(domain);
  return {
    collection: viewDefault.collection
      || viewDefault.collectionId
      || view?.defaultCollection
      || readDefaultScalar(view?.default)
      || workbenchDefault.collection
      || workbenchDefault.collectionId
      || workbench.defaultCollection
      || readDefaultScalar(workbench.default)
      || collections[0]?.id
      || '',
    list: viewDefault.list
      || viewDefault.listLayout
      || view?.defaultList
      || view?.defaultLayout
      || view?.defaultView
      || workbenchDefault.list
      || workbenchDefault.listLayout
      || workbench.defaultList
      || readLegacyWorkbenchDefaultList(domain)
      || 'detail',
    mode: viewDefault.mode
      || view?.defaultMode
      || workbenchDefault.mode
      || workbench.defaultMode
      || 'overview'
  };
}

function readLegacyWorkbenchDefaultList(domain) {
  return domain?.workbench?.defaultLayout || domain?.workbench?.defaultView || '';
}

function readDefaultObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function readDefaultScalar(value) {
  return value && (typeof value !== 'object' || Array.isArray(value)) ? value : '';
}

function readConfiguredViewSpecs(domain) {
  if (Array.isArray(domain?.view) && domain.view.length) {
    return domain.view;
  }
  return readLegacyConfiguredViewSpecs(domain);
}

function readLegacyConfiguredViewSpecs(domain) {
  if (Array.isArray(domain?.views) && domain.views.length && typeof domain.views[0] === 'object') {
    return domain.views;
  }
  if (Array.isArray(domain?.surfaces) && domain.surfaces.length) {
    return domain.surfaces;
  }
  return [];
}

function normalizeViewSpec(view, domain = state.domain) {
  const result = { ...view };
  result.view = getViewSpecId(result, domain);
  delete result.renderer;
  return result;
}

function legacyViewForDomain(domain = state.domain) {
  if (!domain) {
    return { type: 'form', view: 'form-json' };
  }
  if (domain.kind === 'text' || domain.format === 'text') {
    return { type: 'text', view: 'text' };
  }
  if (isWorkbenchDomain(domain)) {
    const defaultState = getWorkbenchDefault(domain);
    return {
      type: 'workbench',
      view: 'workbench',
      layout: getWorkbenchLayout(domain),
      target: defaultState.collection || ''
    };
  }
  if (domain.kind === 'table' || domain.model?.type === 'table') {
    return { type: 'table', view: 'table', target: domain.model?.rows || 'items' };
  }
  if (domain.kind === 'graph' || domain.model?.type === 'graph') {
    const viewId = domain.graph?.blueprint
      ? 'graph-blueprint'
      : (domain.graph?.layout === 'free' ? 'graph-free' : 'graph-fixed');
    return {
      type: domain.graph?.blueprint ? 'blueprint' : 'graph',
      view: viewId,
      target: domain.graph?.nodes || domain.model?.nodes || 'nodes'
    };
  }
  return { type: 'form', view: 'form-json' };
}

function fallbackViewIdForSpec(view, domain = state.domain) {
  if (view?.type === 'text') {
    return 'text';
  }
  if (view?.type === 'table') {
    return 'table';
  }
  if (view?.type === 'blueprint') {
    return 'graph-blueprint';
  }
  if (view?.type === 'graph') {
    return domain?.graph?.layout === 'free' || view.layout === 'free' ? 'graph-free' : 'graph-fixed';
  }
  if (view?.type === 'workbench' || view?.type === 'browser' || view?.type === 'sidepanel') {
    return 'workbench';
  }
  if (view?.type === 'form') {
    return 'form-json';
  }
  return view?.view || readLegacyViewSpecId(view) || view?.type || 'form-json';
}

function getViewSpecId(view, domain = state.domain) {
  return view?.view || readLegacyViewSpecId(view) || fallbackViewIdForSpec(view, domain);
}

function validateAllDomainViews() {
  for (const domain of state.app?.domains || []) {
    for (const viewSpec of getDomainViews(domain)) {
      const viewId = getViewSpecId(viewSpec, domain);
      const view = viewRegistry.get(viewId);
      if (!view || typeof view.render !== 'function') {
        throw new Error(`Domain "${domain.id}" view "${viewSpec.type}" needs view "${viewId}", but it is not registered.`);
      }
      const issues = normalizeValidationResult(validateViewSpec(view, viewSpec, domain));
      if (issues.length) {
        throw new Error(`Domain "${domain.id}" view "${viewSpec.type}" is invalid for view "${viewId}": ${issues.join('; ')}`);
      }
    }
  }
}

function validateViewSpec(view, viewSpec, domain) {
  if (typeof view.validateView === 'function') {
    return view.validateView(viewSpec, domain, state);
  }
  return runLegacyViewValidation(view, viewSpec, domain);
}

function readLegacyViewSpecId(view) {
  return view?.renderer || '';
}

function runLegacyViewValidation(view, viewSpec, domain) {
  return typeof view.validateSurface === 'function'
    ? view.validateSurface(viewSpec, domain, state)
    : [];
}

function readLegacyFormExtensionId(field) {
  if (field.widget) {
    return String(field.widget);
  }
  return field.type === 'widget' || field.type === 'form'
    ? String(field.view || field.renderer || field.kind || '')
    : '';
}

function validateAllDomainForms() {
  for (const domain of state.app?.domains || []) {
    const forms = domain.inspector?.forms || {};
    Object.entries(forms).forEach(([formId, form]) => {
      collectInspectorFields(form).forEach((field) => {
        const formExtensionId = resolveFormExtensionId(field);
        if (!formExtensionId) {
          return;
        }
        const formExtension = formRegistry.get(formExtensionId);
        if (!formExtension || typeof formExtension.render !== 'function') {
          throw new Error(`Domain "${domain.id}" form "${formId}" field "${field.path || field.label || formExtensionId}" needs form extension "${formExtensionId}", but it is not registered.`);
        }
        const issues = normalizeValidationResult(
          typeof formExtension.validateField === 'function'
            ? formExtension.validateField(field, domain, state)
            : typeof formExtension.validateForm === 'function'
            ? formExtension.validateForm(field, domain, state)
            : []
        );
        if (issues.length) {
          throw new Error(`Domain "${domain.id}" form "${formId}" field "${field.path || field.label || formExtensionId}" is invalid for form extension "${formExtensionId}": ${issues.join('; ')}`);
        }
      });
    });
  }
}

function collectInspectorFields(formOrField) {
  const result = [];
  const visitField = (field) => {
    if (!field || typeof field !== 'object') {
      return;
    }
    result.push(field);
    if (field.item) {
      visitField(field.item);
    }
    (field.fields || []).forEach(visitField);
    Object.values(field.variants || {}).forEach((variant) => {
      (variant?.fields || []).forEach(visitField);
    });
  };
  const groups = formOrField?.groups || formOrField?.sections || [];
  groups.forEach((group) => (group.fields || []).forEach(visitField));
  return result;
}

function resolveFormExtensionId(field) {
  if (!field || typeof field !== 'object') {
    return '';
  }
  if (field.form && typeof field.form === 'string') {
    return field.form;
  }
  return readLegacyFormExtensionId(field);
}

function normalizeValidationResult(result) {
  if (result === undefined || result === null || result === true) {
    return [];
  }
  if (result === false) {
    return ['validation failed'];
  }
  if (typeof result === 'string') {
    return result ? [result] : [];
  }
  if (Array.isArray(result)) {
    return result
      .flatMap((item) => normalizeValidationResult(item))
      .filter(Boolean);
  }
  if (typeof result === 'object') {
    if (Array.isArray(result.errors)) {
      return normalizeValidationResult(result.errors);
    }
    if (result.message) {
      return [String(result.message)];
    }
  }
  return [String(result)];
}

function resolveDomainView(domain = state.domain) {
  const viewSpecs = getDomainViews(domain);
  for (const spec of viewSpecs) {
    const viewId = getViewSpecId(spec, domain);
    if (viewId && viewRegistry.has(viewId)) {
      const view = viewRegistry.get(viewId);
      if (typeof view?.render === 'function') {
        return { view, spec };
      }
    }
  }

  const candidates = [];
  for (const spec of viewSpecs) {
    viewRegistry.all().forEach((view) => {
      const rank = typeof view.test === 'function'
        ? Number(view.test(spec, domain, state)) || 0
        : 0;
      if (rank > 0 && typeof view.render === 'function') {
        candidates.push({ view, spec, rank });
      }
    });
  }
  candidates.sort((left, right) => right.rank - left.rank);
  return candidates[0] || {
    view: viewRegistry.get('form-json'),
    spec: viewSpecs[0] || { type: 'form', view: 'form-json' }
  };
}

function createViewContext(viewSpec) {
  const context = {
    app: state.app,
    domain: state.domain,
    view: viewSpec,
    file: state.file,
    get data() {
      return state.data;
    },
    get text() {
      return state.text;
    },
    get selection() {
      return {
        key: state.selectedKey,
        edge: state.selectedEdge,
        workbench: state.workbench
      };
    },
    getByPath,
    setByPath,
    label: getAppLabel,
    formatLabel: formatAppLabel,
    getArray(pathText) {
      return ensureArray(getByPath(state.data, pathText));
    },
    ensureArray,
    pushHistory,
    markDirty: markDirtyAndRender,
    selectPath(pathText) {
      state.selectedKey = pathText || '';
      state.selectedEdge = null;
      resetJsonDraftState();
      render();
    },
    showView(name) {
      if (name !== 'graph') {
        editorPanel.classList.remove('hidden');
      }
      const viewHosts = {
        document: documentView,
        table: tableView,
        collection: collectionWorkbench,
        sidepanel: sidepanelWorkbench,
        graph: graphView,
        text: textView
      };
      viewHosts[name]?.classList.remove('hidden');
    },
    hosts: {
      editorPanel,
      documentView,
      documentTree,
      tableView,
      collectionWorkbench,
      sidepanelWorkbench,
      graphView,
      textView,
      inspectorForm,
      inspectorTitle,
      jsonEditor
    },
    render,
    renderInspector,
    renderInspectorMode,
    renderDocument,
    renderTable,
    renderGraph,
    renderBlueprintGraph,
    renderCollectionWorkbench,
    renderSidepanelWorkbench,
    resetJsonDraftState,
    save: saveFile,
    setInspectorTitle(value) {
      inspectorTitle.textContent = value || '';
    },
    setInspectorMode(mode) {
      state.inspectorMode = mode || 'form';
      renderInspectorMode();
    },
    setStatus,
    refs: state.domain?.refs || {}
  };
  return addViewContextCompatibilityAliases(context, viewSpec);
}

function addViewContextCompatibilityAliases(context, viewSpec) {
  context.surface = viewSpec;
  return context;
}

function render() {
  hideAllViews();
  const resolved = resolveDomainView(state.domain);
  const ctx = createViewContext(resolved.spec);
  const noInspector = typeof resolved.view?.noInspector === 'function'
    ? !!resolved.view.noInspector(ctx)
    : false;
  workspace.classList.toggle('workspace--no-inspector', noInspector);
  inspectorForm.closest('.inspector').classList.toggle('hidden', noInspector);
  renderDiagnostics();
  if (!state.file || (!state.data && state.domain?.kind !== 'text')) {
    editorPanel.classList.remove('hidden');
    emptyView.classList.remove('hidden');
    inspectorTitle.textContent = getAppLabel('inspector');
    state.inspectorMode = 'form';
    renderInspectorMode();
    inspectorForm.innerHTML = `<div class="inspector-empty">${escapeHtml(getAppLabel('openOrCreateFile', '打开或新建一个文件。'))}</div>`;
    jsonEditor.value = '';
    updateActionButtons();
    return;
  }

  resolved.view.render(ctx, resolved.spec);
  updateActionButtons();
}

function hideAllViews() {
  editorPanel.classList.add('hidden');
  emptyView.classList.add('hidden');
  documentView.classList.add('hidden');
  tableView.classList.add('hidden');
  collectionWorkbench.classList.add('hidden');
  sidepanelWorkbench.classList.add('hidden');
  graphView.classList.add('hidden');
  textView.classList.add('hidden');
}

function renderDomainSummary() {
  const visible = state.domain?.inspector?.summary === true;
  domainSummaryCard.classList.toggle('hidden', !visible);
  if (!visible) {
    domainSummary.innerHTML = '';
    return;
  }

  const source = state.domain.source || {};
  const rows = [
    ['id', state.domain.id],
    ['kind', state.domain.kind],
    ['source', source.type || ''],
    ['path', source.path || ''],
    ['template', state.domain.kind]
  ];
  domainSummary.innerHTML = rows
    .map(([key, value]) => `<dt>${escapeHtml(key)}</dt><dd>${escapeHtml(value)}</dd>`)
    .join('');
}

function renderDocument() {
  documentTree.innerHTML = '';
  const root = state.data || {};
  for (const [key, value] of Object.entries(root)) {
    const row = document.createElement('div');
    row.className = 'json-row';
    if (state.selectedKey === key) {
      row.classList.add('is-selected');
    }
    row.innerHTML = `<div class="json-key">${escapeHtml(key)}</div><div class="json-value">${escapeHtml(formatValue(value))}</div>`;
    row.addEventListener('click', () => selectJsonPath(key, value));
    documentTree.append(row);
  }
}

function renderTable() {
  const model = state.domain.model || {};
  const rows = ensureArray(getByPath(state.data, model.rows || 'items'));
  const columns = normalizeColumns(state.domain.columns, rows, { formIds: ['table', 'default'] });
  tableHead.innerHTML = `<tr>${columns.map((column) => `<th>${escapeHtml(column.label || column.path)}</th>`).join('')}</tr>`;
  tableBody.innerHTML = '';

  rows.forEach((row, index) => {
    const tr = document.createElement('tr');
    const rowPath = `${model.rows || 'items'}[${index}]`;
    if (state.selectedKey === rowPath) {
      tr.classList.add('is-selected');
    }
    tr.innerHTML = columns
      .map((column) => `<td>${escapeHtml(formatValue(getByPath(row, column.path)))}</td>`)
      .join('');
    tr.addEventListener('click', () => {
      state.selectedKey = rowPath;
      state.selectedEdge = null;
      resetJsonDraftState();
      renderInspector();
      renderTable();
      updateActionButtons();
    });
    tableBody.append(tr);
  });
}

function normalizeColumns(configColumns, rows, options = {}) {
  if (Array.isArray(configColumns) && configColumns.length > 0) {
    return configColumns.map((column) => normalizeColumn(column, options));
  }

  const keys = new Set();
  for (const row of rows.slice(0, 20)) {
    if (row && typeof row === 'object' && !Array.isArray(row)) {
      Object.keys(row).slice(0, 8).forEach((key) => keys.add(key));
    }
  }
  return [...keys].map((key) => normalizeColumn(key, options));
}

function normalizeColumn(column, options = {}) {
  if (typeof column === 'string') {
    return { path: column, label: resolveColumnLabel(column, options) || column };
  }
  const result = { ...(column || {}) };
  if (!result.path) {
    result.path = result.id || result.key || '';
  }
  if (!result.label && result.path) {
    result.label = resolveColumnLabel(result.path, options) || result.path;
  }
  return result;
}

function resolveColumnLabel(pathText, options = {}) {
  const pathKey = String(pathText || '');
  if (!pathKey) {
    return '';
  }
  for (const form of getColumnLabelForms(options)) {
    const label = resolveFieldLabelFromForm(form, pathKey);
    if (label) {
      return label;
    }
  }
  return '';
}

function getColumnLabelForms(options = {}) {
  const forms = state.domain?.inspector?.forms || {};
  const ids = options.formIds || [];
  const result = [];
  ids.forEach((id) => {
    if (id && forms[id] && !result.includes(forms[id])) {
      result.push(forms[id]);
    }
  });
  return result;
}

function resolveFieldLabelFromForm(form, pathText) {
  let fallback = '';
  const visitField = (field, prefix = '') => {
    if (!field || typeof field !== 'object') {
      return '';
    }
    const fieldPath = field.path || '';
    const fullPath = joinFieldPath(prefix, fieldPath);
    if (fullPath === pathText || (!prefix && fieldPath === pathText)) {
      return field.label || fieldPath || fullPath;
    }
    if (!fallback && !prefix && fieldPath === pathText.split('.')[0] && field.label) {
      fallback = field.label;
    }
    for (const child of field.fields || []) {
      const label = visitField(child, fullPath);
      if (label) {
        return label;
      }
    }
    if (field.item) {
      const label = visitField(field.item, fullPath);
      if (label) {
        return label;
      }
    }
    for (const variant of Object.values(field.variants || {})) {
      for (const child of variant?.fields || []) {
        const label = visitField(child, prefix);
        if (label) {
          return label;
        }
      }
    }
    return '';
  };
  for (const group of form?.groups || form?.sections || []) {
    for (const field of group.fields || []) {
      const label = visitField(field);
      if (label) {
        return label;
      }
    }
  }
  return fallback;
}

function joinFieldPath(prefix, pathText) {
  if (!pathText) {
    return prefix;
  }
  return prefix ? `${prefix}.${pathText}` : pathText;
}

function getWorkbenchLayout(domain = state.domain, view = null) {
  return normalizeWorkbenchLayoutId(
    view?.layout
    || domain?.workbench?.layout
    || domain?.workbench?.type
    || domain?.workbench?.profile
    || ''
  );
}

function isWorkbenchDomain(domain = state.domain) {
  return Boolean(domain?.workbench);
}

function isCollectionWorkbench(domain = state.domain) {
  return isWorkbenchDomain(domain);
}

function getWorkbenchCollections(domain = state.domain) {
  const collections = domain?.workbench?.collections;
  if (Array.isArray(collections)) {
    return collections.filter((item) => item?.id && item?.path);
  }
  if (collections && typeof collections === 'object') {
    return Object.entries(collections)
      .map(([id, config]) => ({ id, ...(config || {}) }))
      .filter((item) => item.path);
  }
  const rowsPath = domain?.model?.rows || domain?.rows;
  return rowsPath ? [{ id: 'items', label: getAppLabel('items'), path: rowsPath }] : [];
}

function getActiveWorkbenchCollection() {
  const collections = getWorkbenchCollections();
  return collections.find((item) => item.id === state.workbench.collectionId) || collections[0] || null;
}

function getCollectionRows(collection) {
  return ensureArray(getByPath(state.data, collection?.path || ''));
}

function getCollectionIdKey(collection) {
  return collection?.idPath || collection?.idKey || collection?.identity || 'id';
}

function getCollectionItemPath(collection, index) {
  return `${collection.path}[${index}]`;
}

function getCollectionItemId(collection, item, index) {
  const value = getByPath(item, getCollectionIdKey(collection));
  return value === undefined || value === null || value === '' ? index + 1 : value;
}

function getCollectionItemTitle(collection, item, index) {
  if (collection.titleTemplate) {
    return formatTemplate(collection.titleTemplate, item);
  }
  const titlePath = collection.title || collection.labelPath || 'name';
  const value = getByPath(item, titlePath);
  return String(value || getCollectionItemId(collection, item, index) || `${collection.label || collection.id} ${index + 1}`);
}

function getCollectionItemSubtitle(collection, item) {
  if (collection.subtitleTemplate) {
    return formatTemplate(collection.subtitleTemplate, item);
  }
  const fields = collection.subtitle || collection.meta || [];
  return ensureArray(fields, { scalar: true })
    .map((field) => {
      if (typeof field === 'string') {
        return getByPath(item, field);
      }
      const value = getByPath(item, field.path || '');
      return field.label ? `${field.label}: ${formatValue(value)}` : value;
    })
    .filter((value) => value !== undefined && value !== null && String(value) !== '')
    .map((value) => String(value))
    .join(' · ');
}

function formatTemplate(template, item) {
  return String(template || '').replace(/\{([^}]+)\}/g, (_, key) => {
    const value = getByPath(item, key.trim());
    return value === undefined || value === null ? '' : String(value);
  });
}

function getCollectionSearchText(collection, item, index) {
  const fields = collection.search || ['id', 'name', 'title', 'description'];
  return [
    getCollectionItemTitle(collection, item, index),
    getCollectionItemSubtitle(collection, item),
    ...ensureArray(fields, { scalar: true }).map((field) => formatValue(getByPath(item, field)))
  ].join(' ').toLowerCase();
}

function getFilteredCollectionRows(collection) {
  const query = state.workbench.search;
  const rows = getCollectionRows(collection).map((item, index) => ({ item, index }));
  if (!query) {
    return rows;
  }
  return rows.filter(({ item, index }) => getCollectionSearchText(collection, item, index).includes(query));
}

function findSelectedCollectionItem(collection) {
  const rows = getCollectionRows(collection);
  const pathText = state.selectedKey || '';
  const prefix = `${collection.path}[`;
  if (pathText.startsWith(prefix)) {
    const match = pathText.slice(prefix.length).match(/^(\d+)/);
    if (match) {
      const index = Number(match[1]);
      if (rows[index]) {
        return { item: rows[index], index, path: getCollectionItemPath(collection, index) };
      }
    }
  }
  if (rows.length) {
    return { item: rows[0], index: 0, path: getCollectionItemPath(collection, 0) };
  }
  return null;
}

function selectCollectionItem(collection, index) {
  state.selectedKey = getCollectionItemPath(collection, index);
  state.selectedEdge = null;
  state.workbench.mode = getCollectionDefaultMode(collection);
  state.workbench.variant = '';
  resetJsonDraftState();
  render();
}

function getCollectionDefaultMode(collection) {
  const collectionDefault = readDefaultObject(collection?.default);
  return collectionDefault.mode || collection?.defaultMode || getWorkbenchDefault().mode;
}

function renderCollectionWorkbench() {
  const collection = getActiveWorkbenchCollection();
  if (!collection) {
    collectionEditorBody.innerHTML = `<div class="empty">${escapeHtml(getAppLabel('noCollections'))}</div>`;
    return;
  }

  if (state.workbench.collectionId !== collection.id) {
    state.workbench.collectionId = collection.id;
  }
  renderCollectionTabs(collection);
  renderCollectionBrowser(collection);
  renderCollectionEditor(collection);
}

function renderCollectionTabs(activeCollection) {
  const collections = getWorkbenchCollections();
  collectionTabs.innerHTML = '';
  collections.forEach((collection) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = collection.label || collection.title || collection.id;
    button.className = collection.id === activeCollection.id ? 'is-active' : '';
    button.addEventListener('click', () => {
      if (state.workbench.collectionId === collection.id) {
        return;
      }
      state.workbench.collectionId = collection.id;
      state.workbench.mode = getCollectionDefaultMode(collection);
      state.workbench.variant = '';
      const rows = getCollectionRows(collection);
      state.selectedKey = rows.length ? getCollectionItemPath(collection, 0) : '';
      resetJsonDraftState();
      render();
    });
    collectionTabs.append(button);
  });
}

function renderCollectionBrowser(collection) {
  collectionSearch.value = state.workbench.search;
  collectionDetailButton.classList.toggle('is-active', state.workbench.listLayout !== 'grid');
  collectionGridButton.classList.toggle('is-active', state.workbench.listLayout === 'grid');
  const listLayouts = getCollectionListLayouts(collection);
  collectionLayoutTabs.hidden = listLayouts && !ensureArray(listLayouts, { scalar: true }).includes('grid');
  collectionList.innerHTML = '';

  const rows = getFilteredCollectionRows(collection);
  if (!rows.length) {
    collectionList.innerHTML = `<div class="collection-empty">${escapeHtml(getAppLabel('noItems'))}</div>`;
    return;
  }

  rows.forEach(({ item, index }) => {
    const pathText = getCollectionItemPath(collection, index);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `collection-item${state.selectedKey === pathText ? ' is-active' : ''}`;
    button.innerHTML = `
      <span class="collection-item__title">${escapeHtml(getCollectionItemTitle(collection, item, index))}</span>
      <span class="collection-item__meta">${escapeHtml(getCollectionItemSubtitle(collection, item) || String(getCollectionItemId(collection, item, index)))}</span>
    `;
    button.addEventListener('click', () => selectCollectionItem(collection, index));
    collectionList.append(button);
  });
}

function renderCollectionEditor(collection) {
  const selected = findSelectedCollectionItem(collection);
  if (!selected) {
    collectionTitle.textContent = collection.label || collection.id;
    collectionSubtitle.textContent = '';
    collectionModeTabs.innerHTML = '';
    collectionVariantTabs.innerHTML = '';
    collectionEditorBody.innerHTML = `<div class="empty">${escapeHtml(getAppLabel('noItemSelected'))}</div>`;
    return;
  }

  if (!state.selectedKey || !state.selectedKey.startsWith(`${collection.path}[`)) {
    state.selectedKey = selected.path;
  }

  if (state.workbench.listLayout === 'grid') {
    renderCollectionGrid(collection);
    return;
  }

  const { item, index, path } = selected;
  collectionTitle.textContent = getCollectionItemTitle(collection, item, index);
  collectionSubtitle.textContent = getCollectionItemSubtitle(collection, item) || `${collection.label || collection.id} · ${getCollectionItemId(collection, item, index)}`;
  renderCollectionModeTabs(collection, item);
  renderCollectionVariantTabs(collection, item);
  renderCollectionModeBody(collection, item, path);
}

function getCollectionModes(collection) {
  const configured = collection.modes || state.domain?.workbench?.modes;
  if (Array.isArray(configured) && configured.length) {
    return configured.map((mode) => typeof mode === 'string' ? { id: mode, label: mode } : mode);
  }
  return [
    { id: 'overview', label: getAppLabel('overview') },
    { id: 'json', label: getAppLabel('json'), view: 'json' }
  ];
}

function renderCollectionModeTabs(collection, item) {
  const modes = getCollectionModes(collection);
  if (!modes.some((mode) => mode.id === state.workbench.mode)) {
    state.workbench.mode = modes[0]?.id || 'overview';
  }
  collectionModeTabs.innerHTML = '';
  modes.forEach((mode) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = mode.label || mode.id;
    button.className = mode.id === state.workbench.mode ? 'is-active' : '';
    button.addEventListener('click', () => {
      if (state.workbench.mode === mode.id) {
        return;
      }
      state.workbench.mode = mode.id;
      resetJsonDraftState();
      renderCollectionEditor(collection);
    });
    collectionModeTabs.append(button);
  });
}

function getCollectionVariantConfig(collection) {
  return collection.variants || null;
}

function getCollectionVariantEntries(collection, item) {
  const config = getCollectionVariantConfig(collection);
  if (!config) {
    return [];
  }
  const value = getByPath(item, config.path || 'variants');
  if (Array.isArray(value)) {
    return value.map((entry, index) => ({ id: String(entry?.id ?? index + 1), label: entry?.label || entry?.id || String(index + 1), path: `${config.path || 'variants'}[${index}]` }));
  }
  if (value && typeof value === 'object') {
    return Object.keys(value).map((key) => ({ id: key, label: config.labels?.[key] || key, path: `${config.path || 'variants'}.${key}` }));
  }
  return [];
}

function renderCollectionVariantTabs(collection, item) {
  const entries = getCollectionVariantEntries(collection, item);
  collectionVariantTabs.innerHTML = '';
  collectionVariantTabs.hidden = entries.length <= 0;
  if (!entries.length) {
    state.workbench.variant = '';
    return;
  }
  if (!entries.some((entry) => entry.id === state.workbench.variant)) {
    state.workbench.variant = entries[0].id;
  }
  entries.forEach((entry) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = entry.label;
    button.className = entry.id === state.workbench.variant ? 'is-active' : '';
    button.addEventListener('click', () => {
      state.workbench.variant = entry.id;
      resetJsonDraftState();
      renderCollectionEditor(collection);
    });
    collectionVariantTabs.append(button);
  });
}

function renderCollectionModeBody(collection, item, itemPath) {
  const mode = getCollectionModes(collection).find((entry) => entry.id === state.workbench.mode) || {};
  collectionEditorBody.innerHTML = '';
  if (mode.view === 'json' || mode.id === 'json') {
    renderCollectionJsonEditor(collection, item, itemPath, mode);
    return;
  }

  const targetInfo = resolveCollectionModeTarget(collection, item, itemPath, mode);
  const context = {
    kind: mode.kind || mode.form || collection.id,
    title: collectionTitle.textContent,
    collection: collection.id,
    target: targetInfo.target,
    targetPath: targetInfo.path,
    value: targetInfo.target
  };
  const form = resolveCollectionModeForm(collection, mode, context) || createAutoInspectorForm(context);
  if (form) {
    renderInspectorForm(form, context, collectionEditorBody);
  } else {
    renderInspectorReadonly(context, collectionEditorBody);
  }
}

function resolveCollectionModeForm(collection, mode, context) {
  const forms = state.domain.inspector?.forms || {};
  return forms[mode.form]
    || forms[`${collection.id}:${mode.id}`]
    || forms[collection.form]
    || forms[collection.id]
    || forms.default;
}

function resolveCollectionModeTarget(collection, item, itemPath, mode) {
  if (mode.target === 'variant') {
    const entry = getCollectionVariantEntries(collection, item).find((variant) => variant.id === state.workbench.variant);
    const path = entry ? `${itemPath}.${entry.path}` : itemPath;
    return { path, target: getByPath(state.data, path) ?? item };
  }
  if (mode.target && mode.target !== 'item') {
    const path = `${itemPath}.${mode.target}`;
    return { path, target: getByPath(state.data, path) };
  }
  return { path: itemPath, target: item };
}

function renderCollectionJsonEditor(collection, item, itemPath, mode) {
  const targetInfo = resolveCollectionModeTarget(collection, item, itemPath, mode);
  const context = {
    kind: mode.kind || mode.form || collection.id,
    title: `${collection.label || collection.id}: ${targetInfo.path}`,
    collection: collection.id,
    target: targetInfo.target,
    targetPath: targetInfo.path,
    value: targetInfo.target
  };
  renderEmbeddedJsonEditor(collectionEditorBody, context, {
    className: 'collection-json-editor',
    afterApply: () => render(),
    afterRevert: () => renderCollectionModeBody(collection, item, itemPath)
  });
}

function renderCollectionGrid(collection) {
  collectionModeTabs.innerHTML = '';
  collectionVariantTabs.innerHTML = '';
  collectionTitle.textContent = collection.label || collection.id;
  collectionSubtitle.textContent = `${getFilteredCollectionRows(collection).length} / ${getCollectionRows(collection).length}`;
  collectionEditorBody.innerHTML = '';
  const columns = normalizeColumns(collection.columns, getCollectionRows(collection), {
    formIds: [collection.form, collection.id, 'default']
  });
  const grid = document.createElement('div');
  grid.className = 'collection-grid';
  getFilteredCollectionRows(collection).forEach(({ item, index }) => {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = `collection-grid-card${state.selectedKey === getCollectionItemPath(collection, index) ? ' is-active' : ''}`;
    const title = document.createElement('span');
    title.className = 'collection-grid-card__title';
    title.textContent = getCollectionItemTitle(collection, item, index);
    card.append(title);
    columns.slice(0, 6).forEach((column) => {
      const row = document.createElement('span');
      row.className = 'collection-grid-card__row';
      row.innerHTML = `<span>${escapeHtml(column.label || column.path)}</span><b>${escapeHtml(formatValue(getByPath(item, column.path)))}</b>`;
      card.append(row);
    });
    card.addEventListener('click', () => selectCollectionItem(collection, index));
    grid.append(card);
  });
  collectionEditorBody.append(grid);
}

function getSidepanelPreviewConfigs() {
  const preview = state.domain?.workbench?.preview || state.domain?.workbench?.previews;
  if (!preview) {
    return [];
  }
  const list = Array.isArray(preview) ? preview : [preview];
  return list.map((item, index) => ({
    id: item.id || (index === 0 ? 'preview' : `preview_${index + 1}`),
    label: item.label || item.title || 'Preview',
    ...item
  }));
}

function getSidepanelPreviewConfig(id = state.workbench.collectionId) {
  const previews = getSidepanelPreviewConfigs();
  return previews.find((item) => item.id === id) || previews[0] || null;
}

function isSidepanelPreviewActive() {
  if (getWorkbenchLayout() !== 'panels') {
    return false;
  }
  return getSidepanelPreviewConfigs().some((item) => item.id === state.workbench.collectionId);
}

function getSidepanelTabs() {
  return [
    ...getWorkbenchCollections().map((collection) => ({
      type: 'collection',
      id: collection.id,
      label: collection.label || collection.title || collection.id,
      collection
    })),
    ...getSidepanelPreviewConfigs().map((preview) => ({
      type: 'preview',
      id: preview.id,
      label: preview.label || preview.id,
      preview
    }))
  ];
}

function getActiveSidepanelTab() {
  const tabs = getSidepanelTabs();
  return tabs.find((tab) => tab.id === state.workbench.collectionId) || tabs[0] || null;
}

function renderSidepanelWorkbench() {
  const activeTab = getActiveSidepanelTab();
  if (!activeTab) {
    sidepanelTabs.innerHTML = '';
    sidepanelList.innerHTML = '<div class="collection-empty">No sidepanel tabs configured.</div>';
    sidepanelEditorBody.innerHTML = '<div class="empty">No editor configured.</div>';
    renderSidepanelModeTabs(false);
    renderSidepanelReferences();
    renderSidepanelDiagnostics();
    return;
  }

  if (state.workbench.collectionId !== activeTab.id) {
    state.workbench.collectionId = activeTab.id;
  }

  renderSidepanelTabs(activeTab);
  if (activeTab.type === 'preview') {
    renderSidepanelPreview(activeTab.preview);
  } else {
    renderSidepanelCollection(activeTab.collection);
  }
  renderSidepanelReferences();
  renderSidepanelDiagnostics();
}

function switchSidepanelMode(mode) {
  if (mode === state.inspectorMode) {
    return;
  }
  const context = buildSidepanelSelectionContext();
  if (state.inspectorMode === 'json' && mode === 'form' && state.jsonDirty && context && !applyJsonDraftForContext(context)) {
    return;
  }
  state.inspectorMode = mode;
  if (mode === 'json') {
    resetJsonDraftState();
  }
  renderSidepanelWorkbench();
}

function renderSidepanelModeTabs(visible) {
  sidepanelModeTabs.classList.toggle('hidden', !visible);
  if (!visible) {
    return;
  }
  const isJson = state.inspectorMode === 'json';
  sidepanelFormModeButton.classList.toggle('is-active', !isJson);
  sidepanelJsonModeButton.classList.toggle('is-active', isJson);
}

function renderSidepanelTabs(activeTab) {
  sidepanelTabs.innerHTML = '';
  getSidepanelTabs().forEach((tab) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = tab.label;
    button.className = tab.id === activeTab.id ? 'is-active' : '';
    button.addEventListener('click', () => {
      if (state.workbench.collectionId === tab.id) {
        return;
      }
      state.workbench.collectionId = tab.id;
      state.workbench.listLayout = tab.type === 'preview' ? 'preview' : 'detail';
      state.workbench.mode = 'overview';
      state.workbench.variant = '';
      state.inspectorMode = 'form';
      selectFirstSidepanelRow(tab);
      resetJsonDraftState();
      render();
    });
    sidepanelTabs.append(button);
  });
}

function selectFirstSidepanelRow(tab) {
  const collection = tab.type === 'preview'
    ? getSidepanelPreviewSourceCollection(tab.preview)
    : tab.collection;
  const rows = getCollectionRows(collection);
  state.selectedKey = rows.length ? getCollectionItemPath(collection, 0) : '';
  state.selectedEdge = null;
}

function renderSidepanelCollection(collection) {
  ensureSidepanelSelection(collection);
  renderSidepanelList(collection);
  renderSidepanelCollectionEditor(collection);
}

function ensureSidepanelSelection(collection) {
  if (!collection) {
    return;
  }
  if (state.selectedKey && state.selectedKey.startsWith(`${collection.path}[`)) {
    return;
  }
  const rows = getCollectionRows(collection);
  state.selectedKey = rows.length ? getCollectionItemPath(collection, 0) : '';
}

function renderSidepanelList(collection) {
  sidepanelList.innerHTML = '';
  if (!collection) {
    sidepanelList.innerHTML = `<div class="collection-empty">${escapeHtml(getAppLabel('noListSource'))}</div>`;
    return;
  }

  const rows = getCollectionRows(collection);
  if (!rows.length) {
    sidepanelList.innerHTML = `<div class="collection-empty">${escapeHtml(getAppLabel('noItems'))}</div>`;
    return;
  }

  rows.forEach((item, index) => {
    const pathText = getCollectionItemPath(collection, index);
    const button = document.createElement('button');
    button.type = 'button';
    const active = state.selectedKey === pathText || String(state.selectedKey || '').startsWith(`${pathText}.`);
    button.className = `sidepanel-file-button${active ? ' is-active' : ''}`;
    button.innerHTML = `
      <span class="sidepanel-file-button__name">${escapeHtml(getCollectionItemTitle(collection, item, index))}</span>
      <span class="sidepanel-file-button__meta">${escapeHtml(getCollectionItemSubtitle(collection, item) || String(getCollectionItemId(collection, item, index)))}</span>
    `;
    button.addEventListener('click', () => {
      state.selectedKey = pathText;
      state.selectedEdge = null;
      state.inspectorMode = 'form';
      resetJsonDraftState();
      render();
    });
    sidepanelList.append(button);
  });
}

function renderSidepanelCollectionEditor(collection) {
  const selected = findSelectedCollectionItem(collection);
  sidepanelEditorBody.innerHTML = '';
  if (!selected) {
    sidepanelTitle.textContent = collection?.label || collection?.id || getAppLabel('editor');
    sidepanelSubtitle.textContent = '';
    renderSidepanelModeTabs(false);
    sidepanelEditorBody.innerHTML = `<div class="empty">${escapeHtml(getAppLabel('noItemSelected'))}</div>`;
    return;
  }

  const { item, index, path } = selected;
  sidepanelTitle.textContent = getCollectionItemTitle(collection, item, index);
  sidepanelSubtitle.textContent = getCollectionItemSubtitle(collection, item) || `${collection.label || collection.id} ${getCollectionItemId(collection, item, index)}`;
  renderSidepanelModeTabs(true);

  if (state.inspectorMode === 'json') {
    const context = buildSidepanelSelectionContext(collection, selected);
    renderEmbeddedJsonEditor(sidepanelEditorBody, context, {
      className: 'sidepanel-json-editor',
      afterApply: () => render(),
      afterRevert: () => renderSidepanelCollectionEditor(collection)
    });
    return;
  }

  const host = document.createElement('div');
  host.className = 'inspector-form';
  sidepanelEditorBody.append(host);
  if (Array.isArray(collection.sections) && collection.sections.length) {
    collection.sections.forEach((section) => renderSidepanelEditorSection(section, collection, item, path, host));
    return;
  }

  const context = {
    kind: collection.form || collection.id,
    title: sidepanelTitle.textContent,
    collection: collection.id,
    target: item,
    targetPath: path,
    value: item
  };
  const form = resolveSidepanelForm(collection, {}, context) || createAutoInspectorForm(context);
  if (form) {
    renderInspectorForm(form, context, host);
  } else {
    renderInspectorReadonly(context, host);
  }
}

function buildSidepanelSelectionContext(collection = null, selected = null) {
  const activeTab = getActiveSidepanelTab();
  const activeCollection = collection || (activeTab?.type === 'collection' ? activeTab.collection : getSidepanelPreviewSourceCollection(activeTab?.preview));
  if (!activeCollection) {
    return null;
  }
  const activeSelected = selected || findSelectedCollectionItem(activeCollection);
  if (!activeSelected) {
    return null;
  }
  return {
    kind: activeCollection.form || activeCollection.id,
    title: getCollectionItemTitle(activeCollection, activeSelected.item, activeSelected.index),
    collection: activeCollection.id,
    target: activeSelected.item,
    targetPath: activeSelected.path,
    value: activeSelected.item
  };
}

function renderSidepanelEditorSection(section, collection, item, itemPath, host) {
  const targetPath = section.target && section.target !== 'item'
    ? `${itemPath}.${section.target}`
    : itemPath;
  const target = section.target && section.target !== 'item'
    ? getByPath(state.data, targetPath)
    : item;
  const context = {
    kind: section.form || section.id || collection.form || collection.id,
    title: section.title || sidepanelTitle.textContent,
    collection: collection.id,
    target,
    targetPath,
    value: target
  };
  const form = resolveSidepanelForm(collection, section, context) || createAutoInspectorForm(context);
  if (form) {
    renderInspectorForm(form, context, host);
  } else {
    renderInspectorReadonly(context, host);
  }
}

function resolveSidepanelForm(collection, section, context) {
  const forms = state.domain.inspector?.forms || {};
  return forms[section.form]
    || forms[collection.form]
    || forms[context.kind]
    || forms[collection.id]
    || forms.default;
}

function getSidepanelPreviewSourceCollection(preview) {
  const collectionId = preview?.sourceCollection || preview?.collection || preview?.routeCollection;
  return getWorkbenchCollections().find((collection) => collection.id === collectionId)
    || getWorkbenchCollections()[0]
    || null;
}

function renderSidepanelPreview(preview) {
  const sourceCollection = getSidepanelPreviewSourceCollection(preview);
  ensureSidepanelSelection(sourceCollection);
  renderSidepanelList(sourceCollection);
  const selected = findSelectedCollectionItem(sourceCollection);
  sidepanelEditorBody.innerHTML = '';
  sidepanelTitle.textContent = preview?.label || getAppLabel('preview');
  sidepanelSubtitle.textContent = selected
    ? `${sourceCollection.label || sourceCollection.id}: ${getCollectionItemTitle(sourceCollection, selected.item, selected.index)}`
    : '';
  renderSidepanelModeTabs(false);

  if (!selected) {
    sidepanelEditorBody.innerHTML = `<div class="empty">${escapeHtml(getAppLabel('noPreviewSource'))}</div>`;
    return;
  }

  const routePath = preview?.routePath || 'route';
  const nodes = ensureArray(getByPath(selected.item, routePath));
  if (!nodes.length) {
    sidepanelEditorBody.innerHTML = `<div class="empty">${escapeHtml(getAppLabel('noRouteNodes'))}</div>`;
    return;
  }

  if (preview?.showPath === true) {
    const tools = document.createElement('div');
    tools.className = 'sidepanel-preview-tools';
    const scope = document.createElement('div');
    scope.className = 'readonly-field';
    scope.textContent = `${selected.path}.${routePath}`;
    tools.append(scope);
    sidepanelEditorBody.append(tools);
  }

  const list = document.createElement('div');
  list.className = 'sidepanel-preview-list';
  nodes.forEach((node, index) => {
    const row = document.createElement('button');
    row.type = 'button';
    const tone = getByPath(node, preview?.poolPath || 'pool') ? 'pool' : 'content';
    row.className = `sidepanel-preview-node sidepanel-preview-node--${tone}`;
    const title = getSidepanelPreviewNodeTitle(node, index, preview);
    const meta = getSidepanelPreviewNodeMeta(node, preview);
    row.innerHTML = `
      <span class="sidepanel-preview-node__order">${index + 1}</span>
      <span class="sidepanel-preview-node__body">
        <span class="sidepanel-preview-node__title">${escapeHtml(title)}</span>
        ${meta ? `<span class="sidepanel-preview-node__meta">${escapeHtml(meta)}</span>` : ''}
      </span>
    `;
    row.addEventListener('click', () => {
      state.selectedKey = `${selected.path}.${routePath}[${index}]`;
      resetJsonDraftState();
      renderInspector();
      updateActionButtons();
    });
    list.append(row);
  });
  sidepanelEditorBody.append(list);
}

function getSidepanelPreviewNodeTitle(node, index, preview) {
  if (preview?.nodeTitleTemplate) {
    return formatTemplate(preview.nodeTitleTemplate, node);
  }
  const titlePath = preview?.nodeTitle || preview?.title || 'name';
  return String(getByPath(node, titlePath) || getByPath(node, preview?.nodeId || 'id') || `${getAppLabel('node')} ${index + 1}`);
}

function getSidepanelPreviewNodeMeta(node, preview) {
  const pool = getByPath(node, preview?.poolPath || 'pool');
  const content = getByPath(node, preview?.contentPath || 'content');
  if (pool) {
    return `${preview?.poolLabel || getAppLabel('pool')} ${pool}`;
  }
  if (content && typeof content === 'object') {
    const type = getByPath(content, preview?.contentTypePath || 'type');
    const id = getByPath(content, preview?.contentIdPath || 'id');
    return formatSidepanelContentRef(type, id, preview);
  }
  if (typeof content === 'string') {
    const match = content.match(/^([^:]+):(.+)$/);
    if (match) {
      return formatSidepanelContentRef(match[1], match[2], preview);
    }
    return content;
  }
  const type = getByPath(node, preview?.contentTypePath || 'contentType');
  const id = getByPath(node, preview?.contentIdPath || 'contentId');
  return id ? formatSidepanelContentRef(type, id, preview) : '';
}

function formatSidepanelContentRef(type, id, preview) {
  const safeType = String(type || '').trim();
  const safeId = String(id || '').trim();
  if (!safeId) {
    return '';
  }
  const refName = preview?.contentRefs?.[safeType] || safeType;
  const refConfig = state.domain.refs?.[refName];
  if (!refConfig) {
    return safeType ? `${safeType}:${safeId}` : safeId;
  }
  const rows = ensureArray(getByPath(state.data, refConfig.path || refConfig.rows));
  const valuePath = refConfig.value || refConfig.valuePath || 'id';
  const match = rows.find((item) => String(getByPath(item, valuePath)) === safeId);
  return match ? formatReferenceLabel(match, refConfig, safeId, refConfig.label || refConfig.labelPath || 'name') : `${safeType}:${safeId}`;
}

function renderSidepanelReferences() {
  const configured = state.domain?.workbench?.references;
  const refs = Array.isArray(configured)
    ? configured
    : Object.entries(state.domain?.refs || {}).map(([id, ref]) => ({ id, label: ref.label || id, ...(ref || {}) }));
  sidepanelReferences.innerHTML = '';
  sidepanelReferencesCard.classList.toggle('hidden', refs.length === 0);
  refs.forEach((ref) => {
    const row = document.createElement('div');
    row.className = 'sidepanel-reference-row';
    const count = ensureArray(getByPath(state.data, ref.path || ref.rows)).length;
    row.innerHTML = `<span>${escapeHtml(ref.label || ref.id)}</span><span>${count}</span>`;
    sidepanelReferences.append(row);
  });
}

function renderSidepanelDiagnostics() {
  const diagnostics = validateCurrent();
  sidepanelDiagnostics.innerHTML = '';
  sidepanelDiagnosticsCard.classList.toggle('hidden', diagnostics.length === 0 && state.domain?.workbench?.diagnostics !== true);
  if (!diagnostics.length) {
    sidepanelDiagnostics.innerHTML = `<div class="diagnostic">${escapeHtml(getAppLabel('noDiagnostics'))}</div>`;
    return;
  }
  diagnostics.forEach((item) => {
    const row = document.createElement('div');
    row.className = `diagnostic ${item.level || 'error'}`;
    row.textContent = item.message;
    row.title = item.path || '';
    row.addEventListener('click', () => {
      if (item.path) {
        state.selectedKey = item.path;
        resetJsonDraftState();
        render();
      }
    });
    sidepanelDiagnostics.append(row);
  });
}

function renderDiagnostics(existingDiagnostics = null) {
  const diagnostics = existingDiagnostics || validateCurrent();
  diagnosticsRoot.innerHTML = '';
  const visible = diagnostics.length > 0 || state.domain?.inspector?.diagnostics === true;
  diagnosticsCard.classList.toggle('hidden', !visible);
  if (!visible) {
    return;
  }
  if (diagnostics.length === 0) {
    diagnosticsRoot.innerHTML = `<div class="diagnostic">${escapeHtml(getAppLabel('noDiagnostics'))}</div>`;
    return;
  }

  for (const item of diagnostics) {
    const div = document.createElement('div');
    div.className = `diagnostic ${item.level || 'error'}`;
    div.textContent = item.message;
    if (item.path) {
      div.title = item.path;
      div.addEventListener('click', () => {
        state.selectedKey = item.path;
        state.selectedEdge = null;
        resetJsonDraftState();
        render();
      });
    }
    diagnosticsRoot.append(div);
  }
}

function validateCurrent() {
  if (!state.data || state.domain?.kind === 'text') {
    return [];
  }

  const diagnostics = [];
  for (const rule of state.domain.validate || []) {
    if (rule && typeof rule === 'object') {
      validateObjectRule(rule, diagnostics);
      continue;
    }
    const uniqueMatch = String(rule).match(/^unique\((.+)\)$/);
    const existsMatch = String(rule).match(/^exists\((.+),\s*(.+)\)$/);
    if (uniqueMatch) {
      validateUnique(uniqueMatch[1], diagnostics);
    } else if (existsMatch) {
      validateExists(existsMatch[1], existsMatch[2], diagnostics);
    } else if (rule === 'noDanglingEdges()' && state.domain.kind === 'graph' && !isBlueprintGraph()) {
      validateDanglingEdges(diagnostics);
    }
  }
  if (state.domain.kind === 'graph' && isBlueprintGraph()) {
    validateBlueprintGraph(diagnostics);
  }
  return diagnostics;
}

function validateBlueprintGraph(diagnostics) {
  const model = buildBlueprintModel();
  const spec = model.spec;
  const seenNodeIds = new Set();
  model.nodes.forEach((node, index) => {
    const nodePath = `${spec.nodes}[${index}]`;
    if (seenNodeIds.has(String(node.id))) {
      diagnostics.push({ path: `${nodePath}.${spec.nodeId}`, message: `节点 id 重复: ${node.id}` });
    }
    seenNodeIds.add(String(node.id));
    if (!node.typeSpec) {
      diagnostics.push({ path: `${nodePath}.${spec.nodeType}`, message: `未知蓝图节点类型: ${node.typeId}` });
    }
    const pos = getByPath(node.value, spec.position);
    if (!pos || !isIntegerValue(pos.x) || !isIntegerValue(pos.y)) {
      diagnostics.push({ path: `${nodePath}.${spec.position}`, message: `蓝图节点坐标必须是整数: #${node.id}` });
    }
  });

  const inputCounts = new Map();
  const outputCounts = new Map();
  model.edges.forEach((edge, index) => {
    const edgePath = `${spec.edges}[${index}]`;
    if (!edge.sourceNode) {
      diagnostics.push({ path: `${edgePath}.from.node`, message: `连线来源节点不存在: ${getByPath(edge.value, 'from.node')}` });
      return;
    }
    if (!edge.targetNode) {
      diagnostics.push({ path: `${edgePath}.to.node`, message: `连线目标节点不存在: ${getByPath(edge.value, 'to.node')}` });
      return;
    }
    if (!edge.sourcePort) {
      diagnostics.push({ path: `${edgePath}.from.port`, message: `来源输出端口不存在: #${edge.sourceNode.id}.${edge.fromPort}` });
      return;
    }
    if (!edge.targetPort) {
      diagnostics.push({ path: `${edgePath}.to.port`, message: `目标输入端口不存在: #${edge.targetNode.id}.${edge.toPort}` });
      return;
    }
    if (!areBlueprintPortsCompatible(edge.sourcePort, edge.targetPort)) {
      diagnostics.push({
        path: edgePath,
        message: `端口类型不兼容: ${edge.sourceNode.id}.${edge.fromPort}(${edge.sourcePort.type}) -> ${edge.targetNode.id}.${edge.toPort}(${edge.targetPort.type})`
      });
    }
    const inputKey = `${edge.to}:${edge.toPort}`;
    const outputKey = `${edge.from}:${edge.fromPort}`;
    inputCounts.set(inputKey, (inputCounts.get(inputKey) || 0) + 1);
    outputCounts.set(outputKey, (outputCounts.get(outputKey) || 0) + 1);
  });

  model.edges.forEach((edge, index) => {
    if (!edge.sourcePort || !edge.targetPort) {
      return;
    }
    const edgePath = `${spec.edges}[${index}]`;
    if (edge.targetPort.kind === 'data'
      && !edge.targetPort.multiple
      && (inputCounts.get(`${edge.to}:${edge.toPort}`) || 0) > 1) {
      diagnostics.push({ path: edgePath, message: `输入端口只能连接一次: #${edge.targetNode.id}.${edge.toPort}` });
    }
    const sourceMultiple = edge.sourcePort.multiple || edge.sourcePort.kind === 'data';
    if (!sourceMultiple && (outputCounts.get(`${edge.from}:${edge.fromPort}`) || 0) > 1) {
      diagnostics.push({ path: edgePath, message: `输出端口只能连接一次: #${edge.sourceNode.id}.${edge.fromPort}` });
    }
  });
}

function areBlueprintPortsCompatible(sourcePort, targetPort) {
  if (sourcePort.direction !== 'output' || targetPort.direction !== 'input') {
    return false;
  }
  if (sourcePort.kind !== targetPort.kind) {
    return false;
  }
  if (sourcePort.kind === 'control') {
    return true;
  }
  const sourceType = normalizeBlueprintPortType(sourcePort.type);
  const targetType = normalizeBlueprintPortType(targetPort.type);
  return sourceType === 'any' || targetType === 'any' || sourceType === targetType;
}

function normalizeBlueprintPortType(type) {
  const text = String(type || 'any').trim().toLowerCase();
  if (text === 'bool') {
    return 'boolean';
  }
  if (text === 'float') {
    return 'number';
  }
  return text || 'any';
}

function validateObjectRule(rule, diagnostics) {
  const kind = String(rule.rule || rule.type || rule.kind || '').trim();
  if (!kind) {
    return;
  }
  const normalizedKind = kind.toLowerCase();
  const matches = collectPathValues(state.data, rule.path || '');
  const targets = matches.length ? matches : [{ path: rule.path || '', value: getByPath(state.data, rule.path || '') }];
  targets.forEach((target) => {
    const value = target.value;
    if (normalizedKind === 'required') {
      if (value === undefined || value === null || value === '' || (Array.isArray(value) && !value.length)) {
        pushDiagnostic(diagnostics, rule, target.path, rule.message || `必填：${target.path}`);
      }
      return;
    }
    if (value === undefined || value === null || value === '') {
      return;
    }
    if (normalizedKind === 'type') {
      const expected = rule.value || rule.expected || rule.dataType;
      if (expected && !matchesType(value, expected)) {
        pushDiagnostic(diagnostics, rule, target.path, rule.message || `${target.path} 应为 ${expected}`);
      }
    } else if (normalizedKind === 'eachtype' || normalizedKind === 'itemstype') {
      const expected = rule.value || rule.expected || rule.dataType;
      if (!Array.isArray(value)) {
        pushDiagnostic(diagnostics, rule, target.path, rule.message || `应为数组：${target.path}`);
      } else if (expected) {
        value.forEach((item, index) => {
          if (!matchesType(item, expected)) {
            pushDiagnostic(diagnostics, rule, `${target.path}[${index}]`, rule.message || `${target.path}[${index}] 应为 ${expected}`);
          }
        });
      }
    } else if (normalizedKind === 'enum' || normalizedKind === 'oneof') {
      const values = rule.values || rule.options || [];
      if (values.length && !values.map(String).includes(String(value))) {
        pushDiagnostic(diagnostics, rule, target.path, rule.message || `无效取值 ${target.path}: ${value}`);
      }
    } else if (normalizedKind === 'range') {
      const number = Number(value);
      if ((rule.min !== undefined && number < Number(rule.min)) || (rule.max !== undefined && number > Number(rule.max))) {
        pushDiagnostic(diagnostics, rule, target.path, rule.message || `超出范围 ${target.path}: ${value}`);
      }
    } else if (normalizedKind === 'pattern') {
      const pattern = new RegExp(rule.pattern);
      if (!pattern.test(String(value))) {
        pushDiagnostic(diagnostics, rule, target.path, rule.message || `格式不匹配 ${target.path}`);
      }
    } else if (normalizedKind === 'length') {
      const length = typeof value === 'string' || Array.isArray(value) ? value.length : 0;
      if ((rule.min !== undefined && length < Number(rule.min)) || (rule.max !== undefined && length > Number(rule.max))) {
        pushDiagnostic(diagnostics, rule, target.path, rule.message || `长度不合法 ${target.path}: ${length}`);
      }
    } else if (normalizedKind === 'items') {
      if (!Array.isArray(value)) {
        pushDiagnostic(diagnostics, rule, target.path, rule.message || `应为数组：${target.path}`);
      } else if ((rule.min !== undefined && value.length < Number(rule.min)) || (rule.max !== undefined && value.length > Number(rule.max))) {
        pushDiagnostic(diagnostics, rule, target.path, rule.message || `条目数量不合法 ${target.path}: ${value.length}`);
      }
    } else if (normalizedKind === 'refexists') {
      validateReferenceExists(value, rule, target.path, diagnostics);
    }
  });
}

function pushDiagnostic(diagnostics, rule, pathText, message) {
  diagnostics.push({
    level: rule.level || 'error',
    path: pathText,
    message
  });
}

function matchesType(value, expected) {
  if (expected === 'any' || expected === 'json') {
    return true;
  }
  if (expected === 'array') {
    return Array.isArray(value);
  }
  if (expected === 'object') {
    return !!value && typeof value === 'object' && !Array.isArray(value);
  }
  if (expected === 'int') {
    return Number.isInteger(value);
  }
  return typeof value === expected;
}

function validateReferenceExists(value, rule, pathText, diagnostics) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      validateReferenceExists(item, rule, `${pathText}[${index}]`, diagnostics);
    });
    return;
  }
  const refConfig = state.domain.refs?.[rule.ref];
  const targetPath = rule.target || refConfig?.path;
  const valuePath = rule.value || refConfig?.value || 'id';
  const rows = ensureArray(getByPath(state.data, targetPath));
  if (!rows.some((row) => String(getByPath(row, valuePath)) === String(value))) {
    pushDiagnostic(diagnostics, rule, pathText, rule.message || `引用不存在 ${pathText}: ${value}`);
  }
}

function validateUnique(rulePath, diagnostics) {
  const dot = rulePath.lastIndexOf('.');
  if (dot < 0) {
    return;
  }
  const arrayPath = rulePath.slice(0, dot);
  const key = rulePath.slice(dot + 1);
  const rows = ensureArray(getByPath(state.data, arrayPath));
  const seen = new Set();
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const value = row?.[key];
    if (value === undefined || value === null || value === '') {
      continue;
    }
    if (seen.has(value)) {
      diagnostics.push({ path: `${arrayPath}[${index}].${key}`, message: `重复值 ${rulePath}: ${value}` });
    }
    seen.add(value);
  }
}

function validateExists(valuePath, targetPath, diagnostics) {
  const dot = targetPath.lastIndexOf('.');
  if (dot < 0) {
    return;
  }
  const arrayPath = targetPath.slice(0, dot);
  const key = targetPath.slice(dot + 1);
  const value = getByPath(state.data, valuePath);
  const rows = ensureArray(getByPath(state.data, arrayPath));
  if (value !== undefined && value !== null && value !== '' && !rows.some((row) => row?.[key] === value)) {
    diagnostics.push({ path: valuePath, message: `引用不存在 ${valuePath} -> ${targetPath}: ${value}` });
  }
}

function validateDanglingEdges(diagnostics) {
  const graph = buildGraphModel();
  for (const edge of graph.edges) {
    if (!graph.nodeMap.has(edge.to)) {
      diagnostics.push({ path: edge.field || '', message: `连线目标不存在 ${edge.from} -> ${edge.to}` });
    }
  }
}

function selectJsonPath(label, value) {
  state.selectedKey = label;
  state.selectedEdge = null;
  resetJsonDraftState();
  renderInspector();
  renderDocument();
  updateActionButtons();
}

function getByPath(root, pathText) {
  const parts = parsePathParts(pathText);
  if (!parts.length) {
    return root;
  }

  return parts.reduce((value, key) => {
    if (value === undefined || value === null) {
      return undefined;
    }
    return value[key];
  }, root);
}

function collectPathValues(root, pathText) {
  const text = String(pathText || '').trim();
  if (!text) {
    return [{ path: '', value: root }];
  }
  const segments = text.split('.');
  const results = [];
  function visit(value, index, parts) {
    if (index >= segments.length) {
      results.push({ path: formatPathParts(parts), value });
      return;
    }
    const segment = segments[index];
    const arrayMatch = segment.match(/^(.+)\[\]$/);
    if (arrayMatch) {
      const key = arrayMatch[1];
      const arrayValue = value?.[key];
      ensureArray(arrayValue).forEach((item, rowIndex) => {
        visit(item, index + 1, [...parts, key, rowIndex]);
      });
      return;
    }
    if (segment === '*') {
      if (value && typeof value === 'object') {
        Object.entries(value).forEach(([key, item]) => visit(item, index + 1, [...parts, key]));
      }
      return;
    }
    visit(value?.[segment], index + 1, [...parts, segment]);
  }
  visit(root, 0, []);
  return results;
}

function setByPath(root, pathText, value) {
  const parts = parsePathParts(pathText);
  if (!parts.length) {
    return;
  }

  let cursor = root;
  for (let index = 0; index < parts.length - 1; index += 1) {
    const key = parts[index];
    const nextKey = parts[index + 1];
    if (!cursor[key] || typeof cursor[key] !== 'object') {
      cursor[key] = typeof nextKey === 'number' ? [] : {};
    }
    cursor = cursor[key];
  }
  cursor[parts[parts.length - 1]] = value;
}

function deleteByPath(root, pathText) {
  const parts = parsePathParts(pathText);
  if (!parts.length) {
    return;
  }
  let cursor = root;
  for (let index = 0; index < parts.length - 1; index += 1) {
    cursor = cursor?.[parts[index]];
    if (!cursor || typeof cursor !== 'object') {
      return;
    }
  }
  delete cursor[parts[parts.length - 1]];
}

function formatPathParts(parts) {
  return parts.reduce((text, part) => {
    if (typeof part === 'number') {
      return `${text}[${part}]`;
    }
    return text ? `${text}.${part}` : String(part);
  }, '');
}

function parsePathParts(pathText) {
  const text = String(pathText || '').trim();
  if (!text) {
    return [];
  }
  const parts = [];
  text.split('.').forEach((segment) => {
    const pattern = /([^\[\]]+)|\[(\d+)\]/g;
    let match;
    while ((match = pattern.exec(segment))) {
      parts.push(match[1] !== undefined ? match[1] : Number(match[2]));
    }
  });
  return parts;
}

function findReferencesToSelection(info) {
  const idKey = getCollectionIdentityKey(info.parentPath);
  const id = info.value && typeof info.value === 'object' ? info.value[idKey] : undefined;
  if (id === undefined || id === null || id === '') {
    return [];
  }
  const refs = [];
  walkJson(state.data, (pathText, value) => {
    if (pathText === `${info.path}.${idKey}` || pathText.startsWith(`${info.path}.`)) {
      return;
    }
    if (String(value) === String(id)) {
      refs.push(pathText);
    }
  });
  return refs;
}

function walkJson(value, visit, pathText = '') {
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      const nextPath = `${pathText}[${index}]`;
      visit(nextPath, item);
      walkJson(item, visit, nextPath);
    });
    return;
  }
  if (value && typeof value === 'object') {
    Object.entries(value).forEach(([key, item]) => {
      const nextPath = pathText ? `${pathText}.${key}` : key;
      visit(nextPath, item);
      walkJson(item, visit, nextPath);
    });
  }
}

function ensureArray(value, options = {}) {
  if (Array.isArray(value)) {
    return value;
  }
  if (options.scalar && value !== undefined && value !== null && value !== '') {
    return [value];
  }
  return [];
}

function singular(value) {
  return String(value || '').replace(/s$/, '');
}

function titleFromPath(value) {
  const text = String(value || '').trim();
  if (!text) {
    return '';
  }
  return text
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function formatValue(value) {
  if (value === undefined) {
    return '';
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return JSON.stringify(value, null, 2);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    },
    ...options
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || `HTTP ${response.status}`);
  }
  return data;
}

function setStatus(message, isError = false) {
  statusText.textContent = message;
  statusText.classList.toggle('is-error', isError);
}
