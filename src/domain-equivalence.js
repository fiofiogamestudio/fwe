const DEFAULT_IGNORED_PATHS = new Set([
  '$.modelTemplate',
  '$.schema',
  '$.templateVersion'
]);

const RUNTIME_DEFAULTS = Object.freeze({
  workbench: null,
  model: {},
  graph: null,
  refs: {},
  validate: [],
  actions: {},
  save: {},
  columns: [],
  inspector: {},
  view: [],
  modes: [],
  defaults: {}
});

function compareDomainValues(left, right, options = {}) {
  const ignoredPaths = new Set([
    ...DEFAULT_IGNORED_PATHS,
    ...(options.ignoredPaths || [])
  ]);
  const differences = [];
  const leftRuntime = options.raw === true ? left : projectDomainRuntime(left);
  const rightRuntime = options.raw === true ? right : projectDomainRuntime(right);
  compareValue(leftRuntime, rightRuntime, '$', ignoredPaths, differences, options.maxDifferences || 50);
  return {
    equivalent: differences.length === 0,
    differences
  };
}

function projectDomainRuntime(domain) {
  const value = isObject(domain) ? domain : {};
  return {
    id: value.id || '',
    title: value.title || value.id || '',
    format: value.format || '',
    kind: value.kind || '',
    source: projectSourceRuntime(value.source),
    workbench: value.workbench || RUNTIME_DEFAULTS.workbench,
    model: value.model || RUNTIME_DEFAULTS.model,
    graph: value.graph || RUNTIME_DEFAULTS.graph,
    refs: value.refs || RUNTIME_DEFAULTS.refs,
    validate: value.validate || RUNTIME_DEFAULTS.validate,
    actions: value.actions || RUNTIME_DEFAULTS.actions,
    save: value.save || RUNTIME_DEFAULTS.save,
    columns: value.columns || RUNTIME_DEFAULTS.columns,
    inspector: value.inspector || RUNTIME_DEFAULTS.inspector,
    view: value.view || RUNTIME_DEFAULTS.view,
    modes: value.modes || value.views || RUNTIME_DEFAULTS.modes,
    defaults: value.defaults || RUNTIME_DEFAULTS.defaults
  };
}

function projectSourceRuntime(source) {
  if (!isObject(source)) {
    return source || null;
  }
  return {
    ...source,
    identity: source.identity || 'id'
  };
}

function compareValue(left, right, path, ignoredPaths, differences, maxDifferences) {
  if (differences.length >= maxDifferences || isIgnored(path, ignoredPaths)) {
    return;
  }
  if (Object.is(left, right)) {
    return;
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right)) {
      differences.push(`${path}: type differs (${valueType(left)} != ${valueType(right)})`);
      return;
    }
    if (left.length !== right.length) {
      differences.push(`${path}: array length differs (${left.length} != ${right.length})`);
    }
    const count = Math.min(left.length, right.length);
    for (let index = 0; index < count; index += 1) {
      compareValue(left[index], right[index], `${path}[${index}]`, ignoredPaths, differences, maxDifferences);
    }
    return;
  }
  if (isObject(left) || isObject(right)) {
    if (!isObject(left) || !isObject(right)) {
      differences.push(`${path}: type differs (${valueType(left)} != ${valueType(right)})`);
      return;
    }
    const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])].sort();
    for (const key of keys) {
      const childPath = `${path}.${key}`;
      if (isIgnored(childPath, ignoredPaths)) {
        continue;
      }
      if (!Object.prototype.hasOwnProperty.call(left, key)) {
        differences.push(`${childPath}: missing from left domain`);
        continue;
      }
      if (!Object.prototype.hasOwnProperty.call(right, key)) {
        differences.push(`${childPath}: missing from right domain`);
        continue;
      }
      compareValue(left[key], right[key], childPath, ignoredPaths, differences, maxDifferences);
      if (differences.length >= maxDifferences) {
        return;
      }
    }
    return;
  }
  differences.push(`${path}: ${JSON.stringify(left)} != ${JSON.stringify(right)}`);
}

function isIgnored(path, ignoredPaths) {
  for (const ignored of ignoredPaths) {
    if (path === ignored || path.startsWith(`${ignored}.`) || path.startsWith(`${ignored}[`)) {
      return true;
    }
  }
  return false;
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function valueType(value) {
  if (Array.isArray(value)) return 'array';
  if (value === null) return 'null';
  return typeof value;
}

module.exports = {
  DEFAULT_IGNORED_PATHS,
  compareDomainValues,
  projectDomainRuntime
};
