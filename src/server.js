const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const { spawn } = require('child_process');
const { compileFweDsl, collectFweDslUses } = require('./dsl');
const { loadFweExtensions, loadFweExtensionsInto } = require('./extensions');

const FWE_ROOT = path.resolve(__dirname, '..');
const PUBLIC_DIR = path.join(FWE_ROOT, 'public');
const TEMPLATES_DIR = path.join(FWE_ROOT, 'templates');
const MODEL_TEMPLATES_DIR = path.join(TEMPLATES_DIR, 'models');
const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 3219;
const BODY_LIMIT = 8 * 1024 * 1024;

function parseArgs(argv) {
  const args = {
    app: process.env.FWE_APP || 'fwe.app.json',
    host: process.env.FWE_HOST || DEFAULT_HOST,
    port: process.env.PORT || process.env.FWE_PORT || '',
    check: false,
    explain: '',
    open: process.env.FWE_OPEN_BROWSER === '1'
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--app') {
      args.app = argv[++i];
    } else if (arg === '--host') {
      args.host = argv[++i];
    } else if (arg === '--port') {
      args.port = argv[++i];
    } else if (arg === '--check') {
      args.check = true;
    } else if (arg === '--explain') {
      args.explain = argv[++i] || true;
    } else if (arg === '--open') {
      args.open = true;
    } else if (arg === '--no-open') {
      args.open = false;
    } else if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return args;
}

function printHelp() {
  console.log(`fwe

Usage:
  node bin/fwe.js --app path/to/fwe.app.json [--host 127.0.0.1] [--port 3219]

Options:
  --app <path>   App config path. Default: fwe.app.json
  --host <host>  Bind host. Default: 127.0.0.1
  --port <port>  Bind port. Default: app config port or 3219
  --open         Open the app in the default browser after the server starts
  --no-open      Do not open the browser, even if FWE_OPEN_BROWSER=1
  --check        Validate config and exit
  --explain <id|path>
                 Print one compiled runtime domain and exit
`);
}

function urlForBrowser(host, port) {
  const browserHost = host === '0.0.0.0' || host === '::' ? DEFAULT_HOST : host;
  return `http://${browserHost}:${port}`;
}

function openBrowser(url) {
  const platform = process.platform;
  const command = platform === 'win32'
    ? 'explorer.exe'
    : platform === 'darwin'
      ? 'open'
      : 'xdg-open';

  try {
    const child = spawn(command, [url], {
      detached: true,
      stdio: 'ignore'
    });
    child.unref();
  } catch (error) {
    console.warn(`[fwe] Could not open browser automatically: ${error.message}`);
  }
}

function stripBom(text) {
  return String(text || '').replace(/^\uFEFF/, '');
}

function readJsonFile(fullPath) {
  return JSON.parse(stripBom(fs.readFileSync(fullPath, 'utf8')));
}

function writeJsonFile(fullPath, data) {
  ensureParent(fullPath);
  fs.writeFileSync(fullPath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function writeTextFile(fullPath, text) {
  ensureParent(fullPath);
  const normalized = String(text || '').replace(/\r\n?/g, '\n').replace(/\s*$/, '');
  fs.writeFileSync(fullPath, `${normalized}\n`, 'utf8');
}

function ensureParent(fullPath) {
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
}

function deepMerge(base, override) {
  if (Array.isArray(base) || Array.isArray(override)) {
    return override === undefined ? clone(base) : clone(override);
  }

  if (!isPlainObject(base) || !isPlainObject(override)) {
    return override === undefined ? clone(base) : clone(override);
  }

  const result = { ...base };
  for (const [key, value] of Object.entries(override)) {
    result[key] = deepMerge(base[key], value);
  }
  return result;
}

function clone(value) {
  if (value === undefined) {
    return undefined;
  }
  return JSON.parse(JSON.stringify(value));
}

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function toPosix(value) {
  return String(value || '').replace(/\\/g, '/');
}

function labelFromId(value) {
  const text = String(value || '').split(/[./:[\]]+/).filter(Boolean).pop() || String(value || '');
  return text
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function isInside(parent, child) {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function resolveUnderWorkspace(workspaceDir, rawPath, label) {
  const raw = String(rawPath || '').trim();
  if (!raw) {
    throw new Error(`${label} is empty.`);
  }

  const fullPath = path.normalize(path.isAbsolute(raw) ? raw : path.resolve(workspaceDir, raw));
  if (!isInside(workspaceDir, fullPath)) {
    throw new Error(`${label} must stay inside workspace: ${raw}`);
  }
  return fullPath;
}

function safeRelativeName(raw) {
  const value = toPosix(decodeURIComponent(String(raw || '').trim())).replace(/^\/+/, '');
  if (!value || value.includes('\0') || value.split('/').some((part) => part === '..' || part === '')) {
    return null;
  }
  return value;
}

function getContentType(fullPath) {
  const ext = path.extname(fullPath).toLowerCase();
  return (
    ext === '.html' ? 'text/html; charset=utf-8' :
    ext === '.css' ? 'text/css; charset=utf-8' :
    ext === '.js' ? 'application/javascript; charset=utf-8' :
    ext === '.json' ? 'application/json; charset=utf-8' :
    ext === '.svg' ? 'image/svg+xml' :
    ext === '.png' ? 'image/png' :
    'application/octet-stream'
  );
}

function loadTemplate(kind) {
  const safeKind = String(kind || '').trim();
  if (!/^[a-z][a-z0-9_-]*$/i.test(safeKind)) {
    throw new Error(`Invalid domain kind: ${kind}`);
  }

  const templatePath = path.join(TEMPLATES_DIR, `${safeKind}.fwe.json`);
  if (!fs.existsSync(templatePath)) {
    throw new Error(`Unknown domain kind "${safeKind}". Missing template: ${templatePath}`);
  }

  return readJsonFile(templatePath);
}

function loadModelTemplate(format, modelType) {
  const safeFormat = String(format || '').trim().toLowerCase();
  const safeModel = String(modelType || '').trim().toLowerCase();
  if (!/^[a-z][a-z0-9_-]*$/i.test(safeFormat) || !/^[a-z][a-z0-9_-]*$/i.test(safeModel)) {
    throw new Error(`Invalid model template: ${format}.${modelType}`);
  }

  const name = safeFormat === 'text' ? 'text' : `${safeFormat}.${safeModel}`;
  const templatePath = path.join(MODEL_TEMPLATES_DIR, `${name}.fwe.json`);
  if (!fs.existsSync(templatePath)) {
    throw new Error(`Unknown model template "${name}". Missing template: ${templatePath}`);
  }

  return readJsonFile(templatePath);
}

function loadAppConfig(appPathInput) {
  const appPath = path.resolve(process.cwd(), appPathInput);
  if (!fs.existsSync(appPath)) {
    throw new Error(`App config not found: ${appPath}`);
  }

  const appDir = path.dirname(appPath);
  const raw = readJsonFile(appPath);
  const workspaceDir = path.normalize(path.resolve(appDir, raw.workspace || '.'));
  const domainRefs = Array.isArray(raw.domains) ? raw.domains : [];
  if (domainRefs.length === 0) {
    throw new Error('App config must include at least one domain.');
  }
  const extensionEntries = raw.extensions || raw.plugins || [];
  const extensionRegistry = loadFweExtensions(extensionEntries, appDir);
  const clientExtensions = normalizeClientExtensions(extensionEntries, appDir);

  const app = {
    id: String(raw.id || raw.app || 'fwe-app'),
    title: String(raw.title || raw.app || 'fwe'),
    labels: isPlainObject(raw.labels) ? raw.labels : {},
    port: raw.port ? Number(raw.port) : DEFAULT_PORT,
    host: raw.host ? String(raw.host) : DEFAULT_HOST,
    workspaceDir,
    appDir,
    appPath,
    extensionRegistry,
    clientExtensions,
    domains: domainRefs.map((ref) => loadDomainConfig(ref, appDir, {
      extensionEntries,
      extensionAppDir: appDir
    }))
  };

  assertUnique(app.domains.map((domain) => domain.id), 'domain id');
  return app;
}

function loadDomainConfig(ref, appDir, options = {}) {
  const rawDomain = typeof ref === 'string'
    ? readDomainConfigFile(path.resolve(appDir, ref), options)
    : clone(ref);

  if (!isPlainObject(rawDomain)) {
    throw new Error('Domain config must be an object or a config path.');
  }

  const raw = normalizeDomainShorthand(rawDomain);
  const isDslDomain = raw.schema?.language === 'fwe';
  const modelDefaults = isDslDomain
    ? { kind: raw.kind, format: raw.format, modelTemplate: 'fwe' }
    : expandModelTemplate(raw);
  const template = loadTemplate(modelDefaults.kind || raw.kind);
  const domain = deepMerge(isDslDomain ? template : deepMerge(template, modelDefaults), raw);
  domain.validate = isDslDomain
    ? mergeValidation(raw.validate)
    : mergeValidation(modelDefaults.validate, raw.validate);
  if (isDslDomain) {
    const templateActions = clone(template.actions || {});
    delete templateActions.defaults;
    domain.actions = deepMerge(templateActions, raw.actions || {});
    for (const key of ['source', 'model', 'graph', 'refs', 'inspector', 'columns', 'workbench', 'schema']) {
      if (Object.prototype.hasOwnProperty.call(raw, key)) {
        domain[key] = clone(raw[key]);
      }
    }
    domain.defaults = clone(raw.defaults || {});
  }
  if (!domain.id || !/^[a-z][a-z0-9_-]*$/i.test(domain.id)) {
    throw new Error(`Domain "${domain.title || domain.kind}" needs a stable id.`);
  }

  domain.title = raw.title || raw.id || domain.title || domain.id;
  domain.format = domain.format || modelDefaults.format || formatForKind(domain.kind);
  domain.kind = domain.kind || modelDefaults.kind || template.kind;
  domain.modelTemplate = isDslDomain ? 'fwe' : modelDefaults.modelTemplate;
  domain.templateVersion = template.templateVersion || 1;
  normalizeInheritedTemplateArtifacts(domain, raw, template);
  normalizeDomainRuntimeViews(domain);
  normalizeDomainWorkbench(domain);
  return domain;
}

function normalizeInheritedTemplateArtifacts(domain, raw, template) {
  normalizeExplicitDefaultOverrides(domain, raw);

  if (domain.kind !== 'table') {
    return;
  }

  const inheritedRows = template.model?.rows || 'items';
  const rows = domain.model?.rows || inheritedRows;
  if (rows === inheritedRows) {
    return;
  }

  const defaultsData = domain.defaults?.data;
  const rawDefaultsData = raw.defaults?.data || {};
  if (isPlainObject(defaultsData)
    && !Object.prototype.hasOwnProperty.call(rawDefaultsData, inheritedRows)
    && Array.isArray(defaultsData[inheritedRows])
    && defaultsData[inheritedRows].length === 0) {
    delete defaultsData[inheritedRows];
  }

  if (!raw.inspector?.forms?.meta) {
    const metaFields = domain.inspector?.forms?.meta?.groups?.flatMap((group) => group.fields || []) || [];
    metaFields.forEach((field) => {
      if (field.path === inheritedRows) {
        field.path = rows;
        field.label = labelFromId(rows);
      }
    });
  }
}

function normalizeExplicitDefaultOverrides(domain, raw) {
  if (Object.prototype.hasOwnProperty.call(raw.defaults || {}, 'data')) {
    domain.defaults = {
      ...(domain.defaults || {}),
      data: clone(raw.defaults.data)
    };
  }

  const rawActionDefaults = raw.actions?.defaults;
  if (isPlainObject(rawActionDefaults)) {
    domain.actions = {
      ...(domain.actions || {}),
      defaults: {
        ...(domain.actions?.defaults || {})
      }
    };
    Object.entries(rawActionDefaults).forEach(([key, value]) => {
      domain.actions.defaults[key] = clone(value);
    });
  }
}

function normalizeDomainRuntimeViews(domain) {
  const configured = readConfiguredRuntimeViews(domain);
  const views = configured.length ? configured : [legacyRuntimeViewForDomain(domain)];
  domain.view = views.map((view) => normalizeRuntimeViewForDomain(view, domain));
  dropLegacyViewConfigAliases(domain);
}

function readConfiguredRuntimeViews(domain) {
  if (Array.isArray(domain.view) && domain.view.length) {
    return domain.view;
  }
  return readLegacyRuntimeViews(domain);
}

function readLegacyRuntimeViews(domain) {
  if (Array.isArray(domain.views) && domain.views.length && isPlainObject(domain.views[0])) {
    return domain.views;
  }
  if (Array.isArray(domain.surfaces) && domain.surfaces.length) {
    return domain.surfaces;
  }
  return Array.isArray(domain.surface) && domain.surface.length ? domain.surface : [];
}

function dropLegacyViewConfigAliases(domain) {
  delete domain.surface;
  delete domain.surfaces;
}

function normalizeRuntimeViewForDomain(view, domain) {
  const result = clone(view || {});
  const originalType = result.type || 'form';
  result.type = normalizeRuntimeViewType(originalType);
  result.view = getRuntimeViewId(result, domain);
  dropLegacyViewSpecAliases(result);
  if (result.type === 'table') {
    result.target = result.target || domain.model?.rows || 'items';
    result.columns = result.columns || domain.columns || [];
  } else if (result.type === 'blueprint') {
    result.view = result.view || 'graph-blueprint';
    result.layout = result.layout || domain.graph?.layout || 'free';
    result.algorithm = result.algorithm || domain.graph?.algorithm || 'free';
    result.target = result.target || domain.graph?.blueprint?.nodes || domain.graph?.nodes || domain.model?.nodes || 'nodes';
    result.edges = result.edges || domain.graph?.blueprint?.edges || domain.model?.edges || 'edges';
  } else if (result.type === 'graph') {
    result.view = result.view || (domain.graph?.layout === 'free' ? 'graph-free' : 'graph-fixed');
    result.layout = result.layout || domain.graph?.layout || 'fixed';
    result.algorithm = result.algorithm || domain.graph?.algorithm || '';
    result.entry = result.entry || domain.graph?.entry || '';
    result.target = result.target || domain.graph?.nodes || domain.model?.nodes || 'nodes';
  } else if (result.type === 'workbench') {
    result.view = 'workbench';
    result.layout = readWorkbenchLayout(result, domain, originalType) || 'catalog';
    result.collections = normalizeWorkbenchCollectionList(domain.workbench?.collections || result.collections || []);
    result.default = readWorkbenchDefault(result, domain, result.collections);
    result.target = result.target || result.default.collection || '';
    dropLegacyDefaultSpecAliases(result);
  } else if (result.type === 'text') {
    result.language = result.language || domain.model?.language || 'text';
  }
  return result;
}

function legacyRuntimeViewForDomain(domain) {
  if (domain.kind === 'text' || domain.format === 'text') {
    return { type: 'text', view: 'text' };
  }
  if (domain.workbench) {
    const defaultState = readWorkbenchDefault(domain.workbench, domain);
    return {
      type: 'workbench',
      view: 'workbench',
      layout: readWorkbenchLayout(domain.workbench, domain),
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

function fallbackViewIdForSpec(view, domain) {
  if (view.type === 'text') {
    return 'text';
  }
  if (view.type === 'table') {
    return 'table';
  }
  if (view.type === 'blueprint') {
    return 'graph-blueprint';
  }
  if (view.type === 'graph') {
    return domain.graph?.layout === 'free' || view.layout === 'free' ? 'graph-free' : 'graph-fixed';
  }
  if (view.type === 'workbench' || view.type === 'browser' || view.type === 'sidepanel') {
    return 'workbench';
  }
  if (view.type === 'form') {
    return 'form-json';
  }
  return view.view || readLegacyRuntimeViewId(view) || view.type;
}

function getRuntimeViewId(view, domain) {
  return view.view || readLegacyRuntimeViewId(view) || fallbackViewIdForSpec(view, domain);
}

function readLegacyRuntimeViewId(view) {
  return view?.renderer || '';
}

function dropLegacyViewSpecAliases(view) {
  delete view.renderer;
}

function normalizeRuntimeViewType(type) {
  return isWorkbenchViewType(type) ? 'workbench' : type;
}

function isWorkbenchViewType(type) {
  const key = String(type || '').trim().toLowerCase();
  return [
    'workbench',
    'browser',
    'sidepanel',
    'browser-editor',
    'content-browser',
    'collection-browser',
    'sidepanel-editor',
    'adventure-editor',
    'sidebar-editor'
  ].includes(key);
}

function readWorkbenchLayout(view, domain, originalType = '') {
  return normalizeWorkbenchLayout(
    view?.layout
    || originalType
    || domain?.workbench?.layout
    || domain?.workbench?.type
    || domain?.workbench?.profile
    || 'catalog'
  );
}

function normalizeWorkbenchLayout(value) {
  const key = String(value || '').trim().toLowerCase();
  if (['panels', 'panel', 'sidepanel', 'sidepanel-editor', 'adventure-editor', 'sidebar-editor'].includes(key)) {
    return 'panels';
  }
  if (['catalog', 'browser', 'browser-editor', 'content-browser', 'collection-browser', 'workbench', ''].includes(key)) {
    return 'catalog';
  }
  return key;
}

function readWorkbenchDefault(view = {}, domain = {}, collections = []) {
  const viewDefault = readDefaultObject(view.default);
  const domainDefault = readDefaultObject(domain.workbench?.default);
  const fallbackCollection = collections[0]?.id || '';
  return {
    collection: viewDefault.collection
      || viewDefault.collectionId
      || view.defaultCollection
      || readDefaultScalar(view.default)
      || domainDefault.collection
      || domainDefault.collectionId
      || domain.workbench?.defaultCollection
      || fallbackCollection
      || '',
    list: viewDefault.list
      || viewDefault.listLayout
      || view.defaultList
      || view.defaultLayout
      || view.defaultView
      || domainDefault.list
      || domainDefault.listLayout
      || domain.workbench?.defaultList
      || domain.workbench?.defaultLayout
      || domain.workbench?.defaultView
      || 'detail',
    mode: viewDefault.mode
      || view.defaultMode
      || domainDefault.mode
      || domain.workbench?.defaultMode
      || 'overview'
  };
}

function readDefaultObject(value) {
  return isPlainObject(value) ? value : {};
}

function readDefaultScalar(value) {
  return value && !isPlainObject(value) && !Array.isArray(value) ? value : '';
}

function dropLegacyDefaultSpecAliases(view) {
  delete view.defaultCollection;
  delete view.defaultList;
  delete view.defaultMode;
  delete view.defaultLayout;
  delete view.defaultView;
  delete view.layouts;
  delete view.views;
}

function normalizeDomainWorkbench(domain) {
  if (!domain.workbench) {
    return;
  }

  const source = domain.workbench;
  const collections = normalizeWorkbenchCollectionList(source.collections || []);
  domain.workbench = {
    ...source,
    type: 'workbench',
    layout: readWorkbenchLayout(source, domain),
    default: readWorkbenchDefault(source, domain, collections),
    collections
  };
  delete domain.workbench.profile;
  delete domain.workbench.defaultCollection;
  delete domain.workbench.defaultList;
  delete domain.workbench.defaultMode;
  delete domain.workbench.defaultLayout;
  delete domain.workbench.defaultView;
}

function normalizeWorkbenchCollectionList(collections) {
  const items = Array.isArray(collections)
    ? collections
    : isPlainObject(collections)
      ? Object.entries(collections).map(([id, config]) => ({ id, ...(config || {}) }))
      : [];

  return items.map((collection) => {
    const result = clone(collection);
    const list = result.list || result.layouts || result.views;
    if (list) {
      result.list = list;
    }
    const defaultState = readDefaultObject(result.default);
    const defaultMode = defaultState.mode || result.defaultMode;
    if (defaultMode) {
      result.default = {
        ...defaultState,
        mode: defaultMode
      };
    }
    delete result.defaultMode;
    delete result.layouts;
    delete result.views;
    return result;
  });
}

function readDomainConfigFile(configPath, options = {}) {
  if (!fs.existsSync(configPath)) {
    throw new Error(`Domain config not found: ${configPath}`);
  }
  if (configPath.endsWith('.fwe')) {
    const id = path.basename(configPath, '.fwe');
    const text = stripBom(fs.readFileSync(configPath, 'utf8'));
    const extensionRegistry = loadFweExtensions(options.extensionEntries || [], options.extensionAppDir || path.dirname(configPath));
    loadFweExtensionsInto(extensionRegistry, collectFweDslUses(text), path.dirname(configPath));
    return compileFweDsl(text, {
      id,
      path: configPath,
      extensionRegistry
    });
  }
  return readJsonFile(configPath);
}

function normalizeDomainShorthand(rawDomain) {
  const domain = clone(rawDomain);
  domain.source = normalizeSource(domain.source, domain);
  domain.model = normalizeModel(domain.model);
  domain.format = String(domain.format || formatForKind(domain.kind) || formatForSource(domain.source) || 'json').toLowerCase();
  domain.model.type = String(domain.model.type || modelTypeForKind(domain.kind) || (domain.format === 'text' ? 'text' : 'object')).toLowerCase();
  domain.kind = domain.kind || kindForModel(domain.format, domain.model.type);

  if (domain.model.type === 'table' && domain.rows) {
    domain.model.rows = domain.rows;
    delete domain.rows;
  }

  if (domain.format === 'text' && domain.extensions) {
    domain.source = {
      ...(domain.source || {}),
      extensions: domain.extensions
    };
    delete domain.extensions;
  }

  if (domain.model.type === 'graph') {
    domain.graph = {
      ...(domain.graph || {})
    };

    for (const key of ['layout', 'entry', 'nodes', 'nodeId', 'nodeKind', 'edges', 'position']) {
      if (Object.prototype.hasOwnProperty.call(domain, key)) {
        domain.graph[key] = domain[key];
        delete domain[key];
      }
    }

    copyIfMissing(domain.model, 'layout', domain.graph.layout);
    copyIfMissing(domain.model, 'entry', domain.graph.entry);
    copyIfMissing(domain.model, 'nodes', domain.graph.nodes);
    copyIfMissing(domain.model, 'id', domain.graph.nodeId);
    copyIfMissing(domain.model, 'kind', domain.graph.nodeKind);
    copyIfMissing(domain.model, 'edges', domain.graph.edges);
    copyIfMissing(domain.model, 'position', domain.graph.position);
  }

  return domain;
}

function normalizeModel(model) {
  if (typeof model === 'string') {
    return { type: model };
  }
  if (isPlainObject(model)) {
    return clone(model);
  }
  return {};
}

function copyIfMissing(target, key, value) {
  if (target[key] === undefined && value !== undefined) {
    target[key] = value;
  }
}

function formatForKind(kind) {
  return kind === 'text' ? 'text' : kind ? 'json' : '';
}

function formatForSource(source) {
  const type = source?.type || '';
  if (type.includes('text')) {
    return 'text';
  }
  if (type.includes('json')) {
    return 'json';
  }
  return '';
}

function modelTypeForKind(kind) {
  if (kind === 'document') {
    return 'object';
  }
  if (kind === 'table' || kind === 'graph' || kind === 'text') {
    return kind;
  }
  return '';
}

function kindForModel(format, modelType) {
  if (format === 'text' || modelType === 'text') {
    return 'text';
  }
  if (modelType === 'table' || modelType === 'graph') {
    return modelType;
  }
  return 'document';
}

function expandModelTemplate(domain) {
  const format = String(domain.format || 'json').toLowerCase();
  const model = normalizeModel(domain.model);
  const modelType = String(model.type || (format === 'text' ? 'text' : 'object')).toLowerCase();
  const template = loadModelTemplate(format, modelType);
  const params = buildModelParams(template.params || {}, model, format, modelType);
  const expanded = substituteTemplate(template, params);
  const validate = mergeValidation(
    compileShapeRules(expanded.shape || {}, params),
    compileTemplateRules(expanded.rules || [])
  );

  delete expanded.params;
  delete expanded.shape;
  delete expanded.rules;
  expanded.format = format;
  expanded.kind = expanded.kind || kindForModel(format, modelType);
  expanded.model = deepMerge(expanded.model || {}, model);
  expanded.model.type = modelType;
  expanded.modelTemplate = format === 'text' ? 'text' : `${format}.${modelType}`;
  expanded.validate = validate;
  return expanded;
}

function buildModelParams(defaultParams, model, format, modelType) {
  const params = { ...clone(defaultParams || {}), ...clone(model || {}) };
  params.type = modelType;

  if (format === 'text' || modelType === 'text') {
    return params;
  }

  if (modelType === 'table') {
    params.rows = params.rows || params.items || 'items';
    params.id = params.id || params.rowId || 'id';
    return params;
  }

  if (modelType === 'graph') {
    params.nodes = params.nodes || 'nodes';
    params.id = params.id || params.nodeId || 'id';
    params.kind = params.kind || params.nodeKind || 'kind';
    params.layout = String(params.layout || 'fixed').toLowerCase();
    params.entry = params.entry || 'entry';
    params.position = params.position || params.pos || 'pos';
    params.edges = normalizeEdgeRules(params.edges || params.edge || ['next'], params.nodes, params.id);
    return params;
  }

  params.root = params.root || '$';
  return params;
}

function normalizeEdgeRules(value, nodesPath, idKey) {
  const source = Array.isArray(value) ? value : [value];
  return source
    .filter((item) => item !== undefined && item !== null && item !== '')
    .map((item) => {
      if (typeof item === 'string') {
        const text = item.trim();
        return text.includes('->') ? text : `${text} -> ${nodesPath}.${idKey}`;
      }
      if (isPlainObject(item)) {
        const from = item.from || item.field || item.path || 'next';
        const to = item.to || item.target || `${nodesPath}.${idKey}`;
        return {
          ...clone(item),
          from,
          to
        };
      }
      return String(item);
    });
}

function substituteTemplate(value, params) {
  if (Array.isArray(value)) {
    return value.map((item) => substituteTemplate(item, params));
  }
  if (isPlainObject(value)) {
    const result = {};
    for (const [key, item] of Object.entries(value)) {
      result[substituteString(key, params)] = substituteTemplate(item, params);
    }
    return result;
  }
  if (typeof value === 'string') {
    return substituteString(value, params);
  }
  return clone(value);
}

function substituteString(text, params) {
  const exact = text.match(/^\$([a-z][a-z0-9_]*)$/i);
  if (exact && Object.prototype.hasOwnProperty.call(params, exact[1])) {
    return clone(params[exact[1]]);
  }

  return text.replace(/\$([a-z][a-z0-9_]*)/gi, (match, key) => {
    if (!Object.prototype.hasOwnProperty.call(params, key)) {
      return match;
    }
    const value = params[key];
    if (value === undefined || value === null) {
      return '';
    }
    if (Array.isArray(value) || isPlainObject(value)) {
      return JSON.stringify(value);
    }
    return String(value);
  });
}

function compileShapeRules(shape, params) {
  if (!isPlainObject(shape)) {
    return [];
  }

  const rules = [];
  for (const [rawPath, rawSpec] of Object.entries(shape)) {
    const specs = Array.isArray(rawSpec) ? rawSpec : [rawSpec];
    for (const spec of specs) {
      const parsed = parseConditionalSpec(String(spec || ''), params);
      if (!parsed.enabled) {
        continue;
      }
      appendConstraintRules(rules, normalizeConstraintPath(rawPath), parsed.spec);
    }
  }
  return rules;
}

function parseConditionalSpec(spec, params) {
  const match = spec.match(/^(.*?)\s+when\s+([a-z][a-z0-9_]*)=(.+)$/i);
  if (!match) {
    return { enabled: true, spec: spec.trim() };
  }

  return {
    enabled: String(params?.[match[2]] ?? '') === match[3].trim(),
    spec: match[1].trim()
  };
}

function appendConstraintRules(rules, pathText, spec) {
  const tokens = String(spec || '').split(/\s+/).filter(Boolean);
  for (const token of tokens) {
    const kind = token.toLowerCase();
    const arrayMatch = kind.match(/^array(?:<([a-z][a-z0-9_]*)>)?$/i);
    if (arrayMatch) {
      rules.push({ rule: 'required', path: pathText });
      rules.push({ rule: 'type', path: pathText, value: 'array' });
      if (arrayMatch[1]) {
        rules.push({ rule: 'eachType', path: pathText, value: arrayMatch[1].toLowerCase() });
      }
      continue;
    }
    if (kind === 'required') {
      rules.push({ rule: 'required', path: pathText });
    } else if (kind === 'unique') {
      rules.push(`unique(${pathText.replace(/\[\]/g, '')})`);
    } else if (['object', 'string', 'number', 'boolean', 'int'].includes(kind)) {
      rules.push({ rule: 'type', path: pathText, value: kind });
    }
  }
}

function normalizeConstraintPath(pathText) {
  const text = String(pathText || '').trim();
  if (text === '$') {
    return '';
  }
  return text.startsWith('$.') ? text.slice(2) : text;
}

function compileTemplateRules(rules) {
  return (Array.isArray(rules) ? rules : []).map((rule) => clone(rule));
}

function mergeValidation(...sets) {
  const result = [];
  const seen = new Set();
  for (const set of sets) {
    const rules = Array.isArray(set) ? set : [];
    for (const rule of rules) {
      const key = JSON.stringify(rule);
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      result.push(clone(rule));
    }
  }
  return result;
}

function normalizeSource(source, domain) {
  if (typeof source === 'string') {
    const match = source.match(/^([a-z][a-z0-9-]*):(.*)$/i);
    if (!match) {
      throw new Error(`Domain "${domain.id || domain.kind}" source shorthand must be "type:path".`);
    }
    return {
      type: match[1],
      path: match[2]
    };
  }

  if (isPlainObject(source)) {
    const normalized = clone(source);
    if (normalized.provider && !normalized.type) {
      normalized.type = normalized.provider;
    }
    return normalized;
  }

  return source;
}

function assertUnique(values, label) {
  const seen = new Set();
  for (const value of values) {
    if (seen.has(value)) {
      throw new Error(`Duplicate ${label}: ${value}`);
    }
    seen.add(value);
  }
}

function publicApp(app) {
  return {
    id: app.id,
    title: app.title,
    labels: app.labels || {},
    workspace: toPosix(path.relative(app.appDir, app.workspaceDir)) || '.',
    domains: app.domains.map((domain) => ({
      id: domain.id,
      title: domain.title,
      format: domain.format,
      kind: domain.kind,
      modelTemplate: domain.modelTemplate || '',
      source: domain.source,
      workbench: domain.workbench || null,
      model: domain.model || {},
      graph: domain.graph || null,
      refs: domain.refs || {},
      validate: domain.validate || [],
      actions: domain.actions || {},
      save: domain.save || {},
      columns: domain.columns || [],
      inspector: domain.inspector || {},
      view: domain.view || [],
      modes: getDomainModes(domain),
      defaults: domain.defaults || {}
    })),
    extensions: app.clientExtensions.map((entry) => ({
      id: entry.id,
      name: entry.name,
      url: `/api/extensions/${entry.id}/${encodeURIComponent(entry.name)}`
    })),
    clientExtensions: app.clientExtensions.map((entry) => ({
      id: entry.id,
      name: entry.name,
      url: `/api/extensions/${entry.id}/${encodeURIComponent(entry.name)}`
    })),
    templates: listTemplates()
  };
}

function getDomainModes(domain) {
  return domain.modes || readLegacyDomainModes(domain) || [];
}

function readLegacyDomainModes(domain) {
  return domain.views;
}

function normalizeClientExtensions(entries, appDir) {
  const result = [];
  const list = Array.isArray(entries) ? entries : [];
  list.forEach((entry, entryIndex) => {
    const config = typeof entry === 'string' ? { path: entry } : entry || {};
    const client = config.client === true || config.runtime === true
      ? config.path
      : (config.client || config.browser || config.runtime || '');
    const values = Array.isArray(client) ? client : (client ? [client] : []);
    values.forEach((value, valueIndex) => {
      const clientPath = String(value || '').trim();
      if (!clientPath) {
        throw new Error(`Client extension path is empty at extensions[${entryIndex}].`);
      }
      const fullPath = path.resolve(appDir, clientPath);
      if (!fs.existsSync(fullPath)) {
        throw new Error(`Client extension not found: ${fullPath}`);
      }
      if (!isInside(appDir, fullPath)) {
        throw new Error(`Client extension must stay inside app directory: ${value}`);
      }
      if (!fs.statSync(fullPath).isFile()) {
        throw new Error(`Client extension must be a file: ${fullPath}`);
      }
      result.push({
        id: String(result.length),
        entryIndex,
        valueIndex,
        name: path.basename(fullPath),
        path: fullPath
      });
    });
  });
  return result;
}

function listTemplates() {
  return fs
    .readdirSync(TEMPLATES_DIR, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.fwe.json'))
    .map((entry) => entry.name.replace(/\.fwe\.json$/, ''))
    .sort();
}

function findDomain(app, id) {
  const domain = app.domains.find((item) => item.id === id);
  if (!domain) {
    throw Object.assign(new Error(`Domain not found: ${id}`), { status: 404 });
  }
  return domain;
}

function sourceRoot(app, domain) {
  return resolveUnderWorkspace(app.workspaceDir, domain.source?.path, `domain "${domain.id}" source.path`);
}

function isJsonSource(domain) {
  return domain.source?.type === 'folder-json' || domain.source?.type === 'single-json' || domain.source?.type === 'multi-json';
}

function isTextSource(domain) {
  return domain.source?.type === 'folder-text' || domain.source?.type === 'single-text';
}

function isFolderSource(domain) {
  return domain.source?.type === 'folder-json' || domain.source?.type === 'folder-text';
}

function sourceProviderName(app, domain) {
  const source = domain.source || {};
  const configured = source.provider || source.driver || '';
  if (configured) {
    return String(configured);
  }
  return app.extensionRegistry?.hasSource?.(source.type) ? source.type : '';
}

function sourceProvider(app, domain) {
  const name = sourceProviderName(app, domain);
  return name ? app.extensionRegistry?.getSource?.(name) : null;
}

function sourceAction(provider, names) {
  for (const name of names) {
    if (typeof provider?.[name] === 'function') {
      return provider[name];
    }
  }
  return null;
}

function sourceContext(app, domain, rawName = '') {
  const source = domain.source || {};
  const sourceBase = source.path
    ? resolveUnderWorkspace(app.workspaceDir, source.path, `domain "${domain.id}" source.path`)
    : app.workspaceDir;
  const ctx = {
    app: {
      id: app.id,
      title: app.title,
      appDir: app.appDir,
      workspaceDir: app.workspaceDir
    },
    domain,
    source,
    name: rawName,
    workspaceDir: app.workspaceDir,
    appDir: app.appDir,
    sourceDir: sourceBase,
    resolvePath(rawPath, label = 'source path') {
      return resolveUnderWorkspace(app.workspaceDir, rawPath, label);
    },
    resolveSourcePath(rawPath, label = 'source path') {
      const value = String(rawPath || '').trim();
      if (!value) {
        return sourceBase;
      }
      const fullPath = path.normalize(path.isAbsolute(value) ? value : path.resolve(sourceBase, value));
      if (!isInside(app.workspaceDir, fullPath)) {
        throw new Error(`${label} must stay inside workspace: ${value}`);
      }
      return fullPath;
    },
    safeName(raw = rawName) {
      return safeRelativeName(raw);
    },
    relative(fullPath) {
      return toPosix(path.relative(app.workspaceDir, fullPath));
    },
    readJson(rawPath) {
      return readJsonFile(ctx.resolveSourcePath(rawPath));
    },
    writeJson(rawPath, data) {
      writeJsonFile(ctx.resolveSourcePath(rawPath), data);
    },
    readText(rawPath) {
      return stripBom(fs.readFileSync(ctx.resolveSourcePath(rawPath), 'utf8'));
    },
    writeText(rawPath, text) {
      writeTextFile(ctx.resolveSourcePath(rawPath), text);
    },
    exists(rawPath) {
      return fs.existsSync(ctx.resolveSourcePath(rawPath));
    },
    fs,
    path
  };
  return ctx;
}

function normalizeSourceFileEntry(entry, index = 0) {
  if (typeof entry === 'string' || typeof entry === 'number') {
    const name = String(entry);
    return { name, path: '', exists: true };
  }
  const item = entry && typeof entry === 'object' && !Array.isArray(entry) ? entry : {};
  const name = String(item.name ?? item.id ?? item.key ?? item.path ?? index).trim();
  if (!name) {
    throw new Error('Source provider returned a file entry without name/id/path.');
  }
  return {
    ...item,
    name,
    path: item.path ? String(item.path) : '',
    exists: item.exists !== false
  };
}

function normalizeSourceReadResult(result, rawName) {
  const source = result && typeof result === 'object' && !Array.isArray(result) ? result : null;
  if (source && (Object.prototype.hasOwnProperty.call(source, 'data') || Object.prototype.hasOwnProperty.call(source, 'content'))) {
    const type = source.type || (Object.prototype.hasOwnProperty.call(source, 'data') ? 'json' : 'text');
    const data = Object.prototype.hasOwnProperty.call(source, 'data') ? source.data : undefined;
    const content = source.content ?? (type === 'json' ? JSON.stringify(data, null, 2) : '');
    return {
      name: source.name || rawName,
      path: source.path || '',
      type,
      ...(data !== undefined ? { data } : {}),
      content
    };
  }
  if (typeof result === 'string') {
    return { name: rawName, path: '', type: 'text', content: result };
  }
  return {
    name: rawName,
    path: '',
    type: 'json',
    data: result,
    content: JSON.stringify(result, null, 2)
  };
}

async function listSourceProviderFiles(app, domain, provider) {
  const list = sourceAction(provider, ['list', 'listFiles', 'files']);
  if (list) {
    const result = await list(sourceContext(app, domain));
    return (Array.isArray(result) ? result : []).map((entry, index) => normalizeSourceFileEntry(entry, index));
  }
  return [];
}

async function readSourceProviderFile(app, domain, provider, rawName) {
  const read = sourceAction(provider, ['read', 'readFile', 'open']);
  if (!read) {
    throw Object.assign(new Error(`Source provider "${sourceProviderName(app, domain)}" does not implement read().`), { status: 501 });
  }
  const result = await read(sourceContext(app, domain, rawName), rawName);
  return normalizeSourceReadResult(result, rawName);
}

async function writeSourceProviderFile(app, domain, provider, rawName, payload) {
  const write = sourceAction(provider, ['write', 'save', 'saveFile']);
  if (!write) {
    throw Object.assign(new Error(`Source provider "${sourceProviderName(app, domain)}" does not implement write().`), { status: 501 });
  }
  const result = await write(sourceContext(app, domain, rawName), rawName, payload);
  return {
    ok: true,
    name: result?.name || rawName,
    path: result?.path || ''
  };
}

async function createSourceProviderFile(app, domain, provider, payload) {
  const create = sourceAction(provider, ['create', 'newFile']);
  if (!create) {
    throw Object.assign(new Error(`Source provider "${sourceProviderName(app, domain)}" does not implement create().`), { status: 501 });
  }
  const result = await create(sourceContext(app, domain, payload?.name || ''), payload || {});
  return result || { ok: true };
}

async function deleteSourceProviderFile(app, domain, provider, rawName) {
  const remove = sourceAction(provider, ['delete', 'remove', 'deleteFile']);
  if (!remove) {
    throw Object.assign(new Error(`Source provider "${sourceProviderName(app, domain)}" does not implement delete().`), { status: 501 });
  }
  const result = await remove(sourceContext(app, domain, rawName), rawName);
  return result || { ok: true, name: rawName };
}

function listFiles(app, domain) {
  const provider = sourceProvider(app, domain);
  if (provider) {
    return listSourceProviderFiles(app, domain, provider);
  }

  const source = domain.source || {};
  if (source.type === 'multi-json') {
    const entries = normalizeMultiJsonFiles(domain);
    return [{
      name: source.fileName || domain.defaults?.fileName || `${domain.id}.json`,
      path: '',
      exists: entries.every((entry) => fs.existsSync(resolveUnderWorkspace(app.workspaceDir, entry.path, `domain "${domain.id}" source.files.${entry.key}`)))
    }];
  }

  const fullPath = sourceRoot(app, domain);
  if (!isFolderSource(domain)) {
    return [{
      name: path.basename(fullPath),
      path: toPosix(path.relative(app.workspaceDir, fullPath)),
      exists: fs.existsSync(fullPath)
    }];
  }

  if (!fs.existsSync(fullPath)) {
    return [];
  }

  const extensions = source.type === 'folder-json'
    ? ['.json']
    : normalizeExtensions(source.extensions);
  const recursive = source.recursive !== false;
  const files = [];
  walkFiles(fullPath, recursive, (filePath) => {
    const ext = path.extname(filePath).toLowerCase();
    if (extensions.includes(ext)) {
      files.push({
        name: toPosix(path.relative(fullPath, filePath)),
        path: toPosix(path.relative(app.workspaceDir, filePath)),
        exists: true
      });
    }
  });
  files.sort((a, b) => a.name.localeCompare(b.name));
  return files;
}

function normalizeExtensions(value) {
  const source = Array.isArray(value) && value.length > 0 ? value : ['.txt'];
  return source.map((item) => {
    const ext = String(item || '').trim().toLowerCase();
    return ext.startsWith('.') ? ext : `.${ext}`;
  });
}

function walkFiles(dir, recursive, visit) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory() && recursive) {
      walkFiles(fullPath, recursive, visit);
    } else if (entry.isFile()) {
      visit(fullPath);
    }
  }
}

function filePathForName(app, domain, rawName) {
  if (domain.source?.type === 'multi-json') {
    return null;
  }

  const sourcePath = sourceRoot(app, domain);
  if (!isFolderSource(domain)) {
    return sourcePath;
  }

  const safeName = safeRelativeName(rawName);
  if (!safeName) {
    throw Object.assign(new Error('Invalid file name.'), { status: 400 });
  }

  const fullPath = path.normalize(path.join(sourcePath, safeName));
  if (!isInside(sourcePath, fullPath)) {
    throw Object.assign(new Error('File path escapes source root.'), { status: 403 });
  }

  const ext = path.extname(fullPath).toLowerCase();
  if (isJsonSource(domain) && ext !== '.json') {
    throw Object.assign(new Error('JSON domain files must use .json extension.'), { status: 400 });
  }

  if (isTextSource(domain) && !normalizeExtensions(domain.source?.extensions).includes(ext)) {
    throw Object.assign(new Error(`Text domain extension is not allowed: ${ext}`), { status: 400 });
  }

  return fullPath;
}

function readDomainFile(app, domain, rawName) {
  const provider = sourceProvider(app, domain);
  if (provider) {
    return readSourceProviderFile(app, domain, provider, rawName);
  }

  if (domain.source?.type === 'multi-json') {
    const data = readMultiJsonDomain(app, domain);
    return {
      name: domain.source.fileName || domain.defaults?.fileName || `${domain.id}.json`,
      path: '',
      type: 'json',
      data,
      content: JSON.stringify(data, null, 2)
    };
  }

  const fullPath = filePathForName(app, domain, rawName);
  if (!fs.existsSync(fullPath)) {
    throw Object.assign(new Error('File not found.'), { status: 404 });
  }

  const name = isFolderSource(domain)
    ? safeRelativeName(rawName)
    : path.basename(fullPath);
  const text = stripBom(fs.readFileSync(fullPath, 'utf8'));
  if (isJsonSource(domain)) {
    const data = JSON.parse(text);
    return { name, path: toPosix(path.relative(app.workspaceDir, fullPath)), type: 'json', data, content: JSON.stringify(data, null, 2) };
  }

  return { name, path: toPosix(path.relative(app.workspaceDir, fullPath)), type: 'text', content: text };
}

function writeDomainFile(app, domain, rawName, payload) {
  const provider = sourceProvider(app, domain);
  if (provider) {
    return writeSourceProviderFile(app, domain, provider, rawName, payload);
  }

  if (domain.source?.type === 'multi-json') {
    const data = payload && Object.prototype.hasOwnProperty.call(payload, 'data')
      ? payload.data
      : JSON.parse(String(payload?.content || '{}'));
    writeMultiJsonDomain(app, domain, data);
    return {
      ok: true,
      name: domain.source.fileName || domain.defaults?.fileName || `${domain.id}.json`,
      path: ''
    };
  }

  const fullPath = filePathForName(app, domain, rawName);
  if (isJsonSource(domain)) {
    const data = payload && Object.prototype.hasOwnProperty.call(payload, 'data')
      ? payload.data
      : JSON.parse(String(payload?.content || '{}'));
    writeJsonFile(fullPath, data);
  } else {
    writeTextFile(fullPath, payload?.content || '');
  }

  return {
    ok: true,
    name: isFolderSource(domain) ? safeRelativeName(rawName) : path.basename(fullPath),
    path: toPosix(path.relative(app.workspaceDir, fullPath))
  };
}

async function createDomainFile(app, domain, payload) {
  const provider = sourceProvider(app, domain);
  if (provider) {
    return createSourceProviderFile(app, domain, provider, payload);
  }

  const name = safeRelativeName(payload?.name || domain.defaults?.fileName || (domain.kind === 'text' ? 'new.txt' : 'new.json'));
  if (!name) {
    throw Object.assign(new Error('Invalid file name.'), { status: 400 });
  }
  const dataPayload = domain.kind === 'text'
    ? { content: payload?.content ?? domain.defaults?.text ?? '' }
    : { data: payload?.data ?? clone(domain.defaults?.data || {}) };
  return writeDomainFile(app, domain, name, dataPayload);
}

function deleteDomainFile(app, domain, rawName) {
  const provider = sourceProvider(app, domain);
  if (provider) {
    return deleteSourceProviderFile(app, domain, provider, rawName);
  }

  if (domain.source?.type === 'multi-json') {
    throw Object.assign(new Error('multi-json domains cannot delete the virtual file.'), { status: 405 });
  }

  const fullPath = filePathForName(app, domain, rawName);
  if (!fs.existsSync(fullPath)) {
    throw Object.assign(new Error('File not found.'), { status: 404 });
  }
  fs.rmSync(fullPath, { force: true });
  return {
    ok: true,
    name: isFolderSource(domain) ? safeRelativeName(rawName) : path.basename(fullPath),
    deleted: [toPosix(path.relative(app.workspaceDir, fullPath))]
  };
}

function normalizeMultiJsonFiles(domain) {
  const files = domain.source?.files;
  if (!files || typeof files !== 'object' || Array.isArray(files)) {
    throw new Error(`Domain "${domain.id}" multi-json source needs source.files.`);
  }
  return Object.entries(files).map(([key, config]) => {
    const item = typeof config === 'string' ? { path: config } : config || {};
    const targetPath = item.target || item.key || key;
    if (!item.path) {
      throw new Error(`Domain "${domain.id}" multi-json entry "${key}" needs path.`);
    }
    return { key, targetPath, path: item.path };
  });
}

function readMultiJsonDomain(app, domain) {
  const result = clone(domain.defaults?.data || {});
  normalizeMultiJsonFiles(domain).forEach((entry) => {
    const fullPath = resolveUnderWorkspace(app.workspaceDir, entry.path, `domain "${domain.id}" source.files.${entry.key}`);
    const value = fs.existsSync(fullPath) ? readJsonFile(fullPath) : clone(getByPathServer(result, entry.targetPath) ?? []);
    setByPathServer(result, entry.targetPath, value);
  });
  return result;
}

function writeMultiJsonDomain(app, domain, data) {
  normalizeMultiJsonFiles(domain).forEach((entry) => {
    const fullPath = resolveUnderWorkspace(app.workspaceDir, entry.path, `domain "${domain.id}" source.files.${entry.key}`);
    writeJsonFile(fullPath, getByPathServer(data, entry.targetPath) ?? null);
  });
}

function getByPathServer(root, pathText) {
  const parts = String(pathText || '').split('.').filter(Boolean);
  return parts.reduce((value, key) => value?.[key], root);
}

function setByPathServer(root, pathText, value) {
  const parts = String(pathText || '').split('.').filter(Boolean);
  if (!parts.length) {
    return;
  }
  let cursor = root;
  for (let index = 0; index < parts.length - 1; index += 1) {
    const key = parts[index];
    if (!cursor[key] || typeof cursor[key] !== 'object' || Array.isArray(cursor[key])) {
      cursor[key] = {};
    }
    cursor = cursor[key];
  }
  cursor[parts[parts.length - 1]] = value;
}

function serveStatic(reqPath, res) {
  const relative = reqPath === '/' ? '/index.html' : reqPath;
  const fullPath = path.normalize(path.join(PUBLIC_DIR, relative));
  if (!isInside(PUBLIC_DIR, fullPath)) {
    sendText(res, 403, 'Forbidden');
    return;
  }

  if (!fs.existsSync(fullPath) || fs.statSync(fullPath).isDirectory()) {
    sendText(res, 404, 'Not Found');
    return;
  }

  res.writeHead(200, {
    'Content-Type': getContentType(fullPath),
    'Cache-Control': 'no-store'
  });
  res.end(fs.readFileSync(fullPath));
}

function sendJson(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(JSON.stringify(data, null, 2));
}

function sendText(res, status, text) {
  res.writeHead(status, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(text);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > BODY_LIMIT) {
        reject(new Error('Body too large.'));
        req.destroy();
      }
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function parseRequestJson(body) {
  return JSON.parse(stripBom(body || '{}'));
}

async function handleApi(app, req, res, url) {
  if (req.method === 'GET' && url.pathname === '/api/app') {
    sendJson(res, 200, publicApp(app));
    return;
  }

  const extensionMatch = url.pathname.match(/^\/api\/extensions\/([^/]+)\/(.+)$/);
  if (req.method === 'GET' && extensionMatch) {
    const extensionId = decodeURIComponent(extensionMatch[1]);
    const extensionName = decodeURIComponent(extensionMatch[2]);
    const extension = app.clientExtensions.find((entry) => entry.id === extensionId && entry.name === extensionName);
    if (!extension) {
      sendJson(res, 404, { error: 'Client extension not found.' });
      return;
    }
    res.writeHead(200, {
      'Content-Type': 'application/javascript; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-store'
    });
    res.end(fs.readFileSync(extension.path));
    return;
  }

  const filesMatch = url.pathname.match(/^\/api\/domains\/([^/]+)\/files$/);
  if (filesMatch) {
    const domain = findDomain(app, decodeURIComponent(filesMatch[1]));
    if (req.method === 'GET') {
      sendJson(res, 200, { files: await listFiles(app, domain) });
      return;
    }
    if (req.method === 'POST') {
      const body = await readBody(req);
      const payload = parseRequestJson(body);
      sendJson(res, 200, await createDomainFile(app, domain, payload));
      return;
    }
  }

  const fileMatch = url.pathname.match(/^\/api\/domains\/([^/]+)\/files\/(.+)$/);
  if (fileMatch) {
    const domain = findDomain(app, decodeURIComponent(fileMatch[1]));
    const name = decodeURIComponent(fileMatch[2]);
    if (req.method === 'GET') {
      sendJson(res, 200, await readDomainFile(app, domain, name));
      return;
    }

    if (req.method === 'PUT') {
      const body = await readBody(req);
      const payload = parseRequestJson(body);
      sendJson(res, 200, await writeDomainFile(app, domain, name, payload));
      return;
    }

    if (req.method === 'DELETE') {
      sendJson(res, 200, await deleteDomainFile(app, domain, name));
      return;
    }
  }

  sendJson(res, 404, { error: 'API route not found.' });
}

function startServer(app, host, port, options = {}) {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || `${host}:${port}`}`);
    try {
      if (url.pathname.startsWith('/api/')) {
        await handleApi(app, req, res, url);
        return;
      }
      serveStatic(url.pathname, res);
    } catch (error) {
      const status = error.status || 500;
      sendJson(res, status, { error: error.message || 'Internal server error.' });
    }
  });

  server.listen(port, host, () => {
    const browserUrl = urlForBrowser(host, port);
    console.log(`[fwe] ${app.title} running at ${browserUrl}`);
    console.log(`[fwe] app: ${app.appPath}`);
    console.log(`[fwe] workspace: ${app.workspaceDir}`);
    console.log(`[fwe] domains: ${app.domains.map((domain) => `${domain.id}:${domain.kind}`).join(', ')}`);
    if (options.open) {
      console.log(`[fwe] Opening browser: ${browserUrl}`);
      openBrowser(browserUrl);
    }
  });
}

function explainDomain(args) {
  const target = args.explain === true ? '' : String(args.explain || '').trim();
  if (target) {
    const targetPath = path.resolve(process.cwd(), target);
    if (fs.existsSync(targetPath)) {
      const appDir = path.dirname(targetPath);
      const appPath = path.resolve(process.cwd(), args.app || '');
      const appRaw = fs.existsSync(appPath) ? readJsonFile(appPath) : null;
      return loadDomainConfig(targetPath, appDir, {
        extensionEntries: appRaw ? (appRaw.extensions || appRaw.plugins || []) : [],
        extensionAppDir: appRaw ? path.dirname(appPath) : appDir
      });
    }
  }

  const app = loadAppConfig(args.app);
  const domain = target
    ? app.domains.find((item) => item.id === target || item.title === target)
    : app.domains[0];
  if (!domain) {
    throw new Error(`Domain not found for --explain: ${target}`);
  }
  return domain;
}

async function main(argv) {
  const args = parseArgs(argv);
  if (args.help) {
    printHelp();
    return;
  }

  if (args.explain) {
    console.log(JSON.stringify(explainDomain(args), null, 2));
    return;
  }

  const app = loadAppConfig(args.app);
  const port = Number(args.port || app.port || DEFAULT_PORT);
  const host = args.host || app.host || DEFAULT_HOST;
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`Invalid port: ${args.port}`);
  }

  if (args.check) {
    console.log(`[fwe] config ok: ${app.appPath}`);
    console.log(`[fwe] domains: ${app.domains.map((domain) => `${domain.id}:${domain.kind}`).join(', ')}`);
    return;
  }

  startServer(app, host, port, { open: args.open });
}

module.exports = {
  main,
  loadAppConfig,
  loadDomainConfig,
  explainDomain,
  listFiles,
  readDomainFile,
  writeDomainFile
};
