const DEFAULT_IGNORED_PATHS = new Set([
  '$.modelTemplate',
  '$.schema',
  '$.templateVersion'
]);

const DEFAULT_MAX_DIFFERENCES = 50;

function compareDomainValues(left, right, options = {}) {
  const ignoredPaths = new Set([
    ...DEFAULT_IGNORED_PATHS,
    ...normalizeIgnoredPaths(options.ignoredPaths)
  ]);
  const maxDifferences = Number.isInteger(options.maxDifferences) && options.maxDifferences > 0
    ? options.maxDifferences
    : DEFAULT_MAX_DIFFERENCES;
  const differences = [];
  const leftRuntime = options.raw === true
    ? left
    : normalizeComparisonRuntime(projectDomainRuntime(left));
  const rightRuntime = options.raw === true
    ? right
    : normalizeComparisonRuntime(projectDomainRuntime(right));
  compareValue(leftRuntime, rightRuntime, '$', ignoredPaths, differences, maxDifferences);
  return {
    equivalent: differences.length === 0,
    differences
  };
}

// This is the exact domain contract exposed by /api/app. Keep comparison and
// browser runtime semantics on the same projection as the domain model grows.
function projectDomainRuntime(domain) {
  const value = isObject(domain) ? domain : {};
  return {
    id: value.id || '',
    title: value.title || value.id || '',
    group: value.group || '',
    format: value.format || '',
    kind: value.kind || '',
    modelTemplate: value.modelTemplate || '',
    source: value.source || null,
    workbench: value.workbench || null,
    model: value.model || {},
    graph: value.graph || null,
    refs: value.refs || {},
    validate: value.validate || [],
    actions: value.actions || {},
    save: value.save || {},
    columns: value.columns || [],
    inspector: value.inspector || {},
    view: value.view || [],
    modes: value.modes || value.views || [],
    defaults: value.defaults || {}
  };
}

function normalizeComparisonRuntime(runtime) {
  return {
    ...runtime,
    source: projectSourceRuntime(runtime.source)
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

function normalizeIgnoredPaths(value) {
  if (Array.isArray(value) || value instanceof Set) {
    return [...value].map((entry) => String(entry));
  }
  return [];
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
    for (let index = 0; index < count && differences.length < maxDifferences; index += 1) {
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
      if (differences.length >= maxDifferences) {
        return;
      }
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
