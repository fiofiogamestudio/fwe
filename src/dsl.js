const path = require('path');

const SCALARS = new Set(['string', 'int', 'number', 'float', 'bool', 'boolean', 'json', 'any']);
const CORE_ANNOTATIONS = new Set([
  'key',
  'rows',
  'nodes',
  'edge',
  'entry',
  'position',
  'position.x',
  'position.y',
  'label',
  'hint',
  'description',
  'placeholder',
  'textarea',
  'select',
  'readonly',
  'refresh',
  'default',
  'enum',
  'options',
  'range',
  'min',
  'max',
  'step',
  'pattern',
  'length',
  'items'
]);

function compileFweDsl(text, options = {}) {
  const sourceText = stripLineComments(String(text || ''));
  const { dataBlocks, typeBlocks, viewBlocks, rest } = extractDslBlocks(sourceText);
  const directives = parseDirectives(rest);
  if (dataBlocks.length > 1) {
    throw dslError(options, 'Only one data block is allowed.');
  }
  if (dataBlocks.length) {
    const dataRoot = dataBlocks[0].name;
    if (directives.root && directives.root !== dataRoot) {
      throw dslError(options, `root directive "${directives.root}" conflicts with data block "${dataRoot}".`);
    }
    directives.root = dataRoot;
  }
  directives.views = viewBlocks.map((block) => parseViewBlock(block, options));
  applyViewDirectives(directives, options);
  const blocks = [...dataBlocks, ...typeBlocks];
  assertUniqueNames(blocks.map((block) => block.name), 'type', options);
  const types = new Map(blocks.map((block) => [block.name, parseTypeBlock(block)]));
  const id = directives.id || options.id || 'domain';
  const domain = {
    id,
    title: directives.title || titleFromId(id),
    schema: {
      language: 'fwe',
      root: directives.root || '',
      types: blocks.map((block) => block.name),
      viewTypes: directives.views.map((view) => view.type)
    }
  };
  if (directives.uses.length) {
    domain.schema.uses = directives.uses;
  }

  if (!directives.source) {
    throw dslError(options, 'Missing source directive.');
  }
  domain.source = directives.source;

  let compiled;
  if (directives.text) {
    compiled = compileTextDomain(domain, directives);
    return applyViewsToDomain(compiled, directives, null, options);
  }

  if (!directives.root) {
    throw dslError(options, 'Missing root directive or data block.');
  }
  if (!types.has(directives.root)) {
    throw dslError(options, `Unknown root type: ${directives.root}`);
  }

  const context = buildCompileContext(types, directives.root, options.extensionRegistry || options.extensions || null);
  applyViewContextHints(context, directives);
  validateAnnotations(context, options);
  const viewTypes = new Set(directives.views.map((view) => view.type));
  if (directives.graph) {
    compiled = compileGraphDomain(domain, directives, context, options);
  } else if (viewTypes.has('table') || (!viewTypes.size && context.rows)) {
    compiled = compileTableDomain(domain, directives, context, options);
  } else {
    compiled = compileObjectDomain(domain, directives, context);
  }

  return applyViewsToDomain(compiled, directives, context, options);
}

function stripLineComments(text) {
  return text
    .split(/\r?\n/)
    .map((line) => {
      let quoted = false;
      for (let index = 0; index < line.length - 1; index += 1) {
        const char = line[index];
        if (char === '"' && line[index - 1] !== '\\') {
          quoted = !quoted;
        }
        if (!quoted && char === '/' && line[index + 1] === '/') {
          return line.slice(0, index);
        }
      }
      return line;
    })
    .join('\n');
}

function collectFweDslUses(text) {
  const sourceText = stripLineComments(String(text || ''));
  const { rest } = extractDslBlocks(sourceText);
  return parseDirectives(rest).uses;
}

function extractDslBlocks(text) {
  const dataBlocks = [];
  const typeBlocks = [];
  const viewBlocks = [];
  let rest = '';
  let cursor = 0;
  const blockPattern = /\b(data|type|view|surface)\s+([A-Za-z_][A-Za-z0-9_-]*)(?:\s+([A-Za-z_][A-Za-z0-9_.-]*))?\s*\{/g;
  let match;
  while ((match = blockPattern.exec(text))) {
    const open = blockPattern.lastIndex - 1;
    const close = findMatchingBrace(text, open);
    if (close < 0) {
      throw new Error(`Unclosed ${match[1]} block: ${match[2]}`);
    }
    rest += text.slice(cursor, match.index);
    const block = {
      kind: canonicalDslBlockKind(match[1]),
      sourceKind: match[1],
      name: match[2],
      target: match[3] || '',
      body: text.slice(open + 1, close),
      line: lineForIndex(text, match.index)
    };
    if (block.kind !== 'view' && block.name.includes('-')) {
      throw new Error(`${block.kind} name must be an identifier: ${block.name}`);
    }
    if (block.kind === 'data') {
      dataBlocks.push(block);
    } else if (block.kind === 'view') {
      viewBlocks.push(block);
    } else {
      typeBlocks.push(block);
    }
    cursor = close + 1;
    blockPattern.lastIndex = close + 1;
  }
  rest += text.slice(cursor);
  return { dataBlocks, typeBlocks, viewBlocks, rest };
}

function canonicalDslBlockKind(kind) {
  return kind === 'surface' ? 'view' : kind;
}

function findMatchingBrace(text, open) {
  let depth = 0;
  let quoted = false;
  for (let index = open; index < text.length; index += 1) {
    const char = text[index];
    if (char === '"' && text[index - 1] !== '\\') {
      quoted = !quoted;
      continue;
    }
    if (quoted) {
      continue;
    }
    if (char === '{') {
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }
  return -1;
}

function lineForIndex(text, index) {
  return String(text || '').slice(0, index).split(/\r?\n/).length;
}

function parseDirectives(text) {
  const directives = { uses: [] };
  const allowed = new Set(['id', 'title', 'source', 'root', 'graph', 'text', 'columns', 'file', 'use']);
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*(.*)$/);
    if (!match) {
      continue;
    }
    const key = match[1];
    const value = match[2].trim();
    if (!allowed.has(key)) {
      throw new Error(`Unknown directive: ${key}`);
    }
    if (key === 'id') {
      directives.id = parseTokenValue(value);
    } else if (key === 'title') {
      directives.title = parseTokenValue(value);
    } else if (key === 'source') {
      directives.source = parseSourceDirective(parseTokenValue(value));
    } else if (key === 'root') {
      directives.root = parseTokenValue(value);
    } else if (key === 'graph') {
      directives.graph = parseGraphDirective(value);
    } else if (key === 'text') {
      directives.text = { language: parseTokenValue(value) || 'text' };
    } else if (key === 'columns') {
      directives.columns = parseList(value);
    } else if (key === 'file') {
      directives.fileName = parseTokenValue(value);
    } else if (key === 'use') {
      directives.uses.push(parseTokenValue(value));
    }
  }
  return directives;
}

function parseTokenValue(value) {
  const text = String(value || '').trim();
  const quoted = text.match(/^"((?:\\"|[^"])*)"$/);
  if (quoted) {
    return quoted[1].replace(/\\"/g, '"');
  }
  return text;
}

function parseList(value) {
  const text = String(value || '').trim();
  const literal = parseLiteral(text);
  if (Array.isArray(literal)) {
    return literal;
  }
  const match = text.match(/^\[(.*)\]$/);
  if (!match) {
    return [];
  }
  return splitTopLevel(match[1], ',')
    .map((item) => parseLiteral(item.trim()))
    .filter((item) => item !== '');
}

function splitTopLevel(text, delimiter = ',') {
  const parts = [];
  let current = '';
  let quote = '';
  let depth = 0;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const escaped = text[index - 1] === '\\';
    if (quote) {
      current += char;
      if (char === quote && !escaped) {
        quote = '';
      }
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      current += char;
      continue;
    }
    if (char === '[' || char === '{' || char === '(') {
      depth += 1;
    } else if (char === ']' || char === '}' || char === ')') {
      depth -= 1;
    }
    if (char === delimiter && depth === 0) {
      parts.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  parts.push(current);
  return parts;
}

function parseSourceDirective(value) {
  const match = String(value || '').match(/^([a-z][a-z0-9-]*):(.*)$/i);
  if (!match) {
    throw new Error(`Invalid source directive: ${value}`);
  }
  return { type: match[1], path: match[2] };
}

function parseGraphDirective(value) {
  const tokens = String(value || '').trim().split(/\s+/).filter(Boolean);
  if (!tokens.length) {
    throw new Error('Graph directive needs a mode: route-lane or free.');
  }
  const mode = tokens[0];
  if (!['route-lane', 'fixed', 'free'].includes(mode)) {
    throw new Error(`Unknown graph mode: ${mode}`);
  }
  const result = {
    mode,
    layout: mode === 'free' ? 'free' : 'fixed',
    algorithm: mode === 'free' ? 'free' : 'route-lane'
  };
  const gridIndex = tokens.indexOf('grid');
  if (gridIndex >= 0 && tokens[gridIndex + 1]) {
    result.grid = Number(tokens[gridIndex + 1]);
    if (!Number.isInteger(result.grid) || result.grid <= 0) {
      throw new Error(`Invalid graph grid: ${tokens[gridIndex + 1]}`);
    }
  }
  return result;
}

function parseViewBlock(block, options) {
  const { childBlocks, rest } = extractViewChildBlocks(block.body);
  const props = parseViewProperties(rest, options);
  const view = {
    type: block.name,
    target: block.target || '',
    line: block.line,
    ...props
  };

  for (const child of childBlocks) {
    const parsed = {
      id: child.name,
      ...parseViewProperties(child.body, options),
      line: block.line + lineForIndex(block.body, child.index) - 1
    };
    if (child.kind === 'node') {
      if (child.name && child.name !== 'node') {
        if (!view.nodeTypes) {
          view.nodeTypes = [];
        }
        view.nodeTypes.push(parseBlueprintNodeBlock(child, parsed, options));
      } else {
        view.node = parsed;
      }
    } else if (child.kind === 'default') {
      view.default = parseViewProperties(child.body, options);
    } else if (child.kind === 'collection' || child.kind === 'tab') {
      if (!view.collections) {
        view.collections = [];
      }
      view.collections.push(parsed);
    } else if (child.kind === 'preview') {
      if (!view.previews) {
        view.previews = [];
      }
      view.previews.push(parsed);
    }
  }

  return view;
}

function parseBlueprintNodeBlock(child, parsed, options) {
  const node = {
    id: child.name,
    title: parsed.title || titleFromId(child.name),
    label: parsed.label || parsed.title || titleFromId(child.name),
    color: parsed.color || '',
    ports: [],
    line: parsed.line
  };

  for (const rawLine of child.body.split(/\r?\n/)) {
    const line = stripDslInlineComment(rawLine).trim();
    if (!line || /^(title|label|color)\b/.test(line)) {
      continue;
    }

    const match = line.match(/^(in|out)\s+([A-Za-z_][A-Za-z0-9_]*)\s*:\s*([^=@\s]+(?:\[\])?)\s*(?:=\s*([^@]+?))?\s*((?:@[A-Za-z_][A-Za-z0-9_.]*(?:\([^)]*\))?\s*)*)$/);
    if (!match) {
      throw dslError(options, `Invalid blueprint port line: ${line}`, parsed.line);
    }

    const annotations = parseAnnotations(match[5] || '');
    const labelAnnotation = annotations.find((annotation) => annotation.name === 'label');
    const label = labelAnnotation?.args?.values?.[0]
      ?? labelAnnotation?.args?.named?.value
      ?? titleFromId(match[2]);
    const control = annotations.some((annotation) => annotation.name === 'control')
      || String(match[3]).toLowerCase() === 'exec';
    node.ports.push({
      id: match[2],
      label,
      direction: match[1] === 'in' ? 'input' : 'output',
      type: match[3],
      kind: control ? 'control' : 'data',
      default: match[4] === undefined ? undefined : parseLiteral(match[4].trim()),
      multiple: annotations.some((annotation) => annotation.name === 'multiple')
    });
  }

  return node;
}

function stripDslInlineComment(line) {
  let quote = '';
  for (let index = 0; index < line.length - 1; index += 1) {
    const char = line[index];
    if (quote) {
      if (char === '\\') {
        index += 1;
        continue;
      }
      if (char === quote) {
        quote = '';
      }
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === '/' && line[index + 1] === '/') {
      return line.slice(0, index);
    }
  }
  return line;
}

function extractViewChildBlocks(text) {
  const childBlocks = [];
  let rest = '';
  let cursor = 0;
  const blockPattern = /\b(node|collection|tab|preview|default)\s*([A-Za-z_][A-Za-z0-9_.-]*)?\s*\{/g;
  let match;
  while ((match = blockPattern.exec(text))) {
    const open = blockPattern.lastIndex - 1;
    const close = findMatchingBrace(text, open);
    if (close < 0) {
      throw new Error(`Unclosed ${match[1]} block: ${match[2] || ''}`);
    }
    rest += text.slice(cursor, match.index);
    childBlocks.push({
      kind: match[1],
      name: match[2] || match[1],
      body: text.slice(open + 1, close),
      index: match.index
    });
    cursor = close + 1;
    blockPattern.lastIndex = close + 1;
  }
  rest += text.slice(cursor);
  return { childBlocks, rest };
}

function parseViewProperties(text, options) {
  const result = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*(.*)$/);
    if (!match) {
      continue;
    }
    const key = match[1];
    const value = match[2].trim();
    const normalizedKey = key === 'views' ? 'modes' : key;
    result[normalizedKey] = parseViewPropertyValue(value);
  }
  return result;
}

function parseViewPropertyValue(value) {
  const text = String(value || '').trim();
  if (/^\[.*\]$/.test(text)) {
    return parseList(text);
  }
  if (/^\{.*\}$/.test(text) || /^(true|false|null|-?\d+(?:\.\d+)?)$/.test(text)) {
    return parseLiteral(text);
  }
  return parseTokenValue(text);
}

function applyViewDirectives(directives, options) {
  for (const view of directives.views || []) {
    if (view.type === 'text') {
      directives.text = directives.text || { language: view.language || view.target || 'text' };
      continue;
    }
    if (view.type === 'table') {
      if (view.columns?.length) {
        directives.columns = view.columns;
      }
      continue;
    }
    if (view.type === 'graph' || view.type === 'blueprint') {
      if (!view.layout && !directives.graph) {
        throw dslError(options, `view ${view.type} needs layout: route-lane or free.`, view.line);
      }
      if (view.layout) {
        directives.graph = parseGraphDirective(view.layout);
      }
      continue;
    }
    if (!['form', 'workbench', 'browser', 'sidepanel', 'blueprint'].includes(view.type)
      && !view.view
      && !readLegacyDslViewId(view)
      && !options.extensionRegistry?.hasView?.(view.type)) {
      throw dslError(options, `Unknown view type: ${view.type}`, view.line);
    }
  }
}

function parseTypeBlock(block) {
  const fields = [];
  const names = new Set();
  const pattern = /([A-Za-z_][A-Za-z0-9_]*)(\?)?\s*:\s*([^=@\n;{}]+?)\s*(?:=\s*([^@\n;{}]+?))?\s*((?:@[A-Za-z_][A-Za-z0-9_.]*(?:\([^)]*\))?\s*)*)(?=\n|;|$)/g;
  let match;
  while ((match = pattern.exec(block.body))) {
    if (names.has(match[1])) {
      throw new Error(`Duplicate field "${match[1]}" in type ${block.name}`);
    }
    names.add(match[1]);
    fields.push({
      name: match[1],
      optional: !!match[2],
      type: parseTypeExpr(match[3]),
      defaultValue: match[4] === undefined ? undefined : parseLiteral(match[4].trim()),
      annotations: parseAnnotations(match[5]),
      line: block.line + lineForIndex(block.body, match.index) - 1
    });
  }
  return { name: block.name, fields };
}

function parseTypeExpr(raw) {
  let text = String(raw || '').trim();
  let array = false;
  if (text.endsWith('[]')) {
    array = true;
    text = text.slice(0, -2).trim();
  }
  const ref = text.match(/^ref<([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)>$/);
  if (ref) {
    return { kind: 'ref', targetType: ref[1], targetField: ref[2], array, raw };
  }
  return { kind: 'type', name: text, array, raw };
}

function parseAnnotations(raw) {
  const annotations = [];
  const pattern = /@([A-Za-z_][A-Za-z0-9_.]*)(?:\(([^)]*)\))?/g;
  let match;
  while ((match = pattern.exec(raw || ''))) {
    annotations.push({
      name: match[1],
      rawArgs: match[2] || '',
      args: parseAnnotationArgs(match[2] || '')
    });
  }
  return annotations;
}

function parseAnnotationArgs(raw) {
  const text = String(raw || '').trim();
  if (!text) {
    return { values: [], named: {} };
  }

  const values = [];
  const named = {};
  splitAnnotationArgs(text).forEach((part) => {
    const eq = findTopLevelEquals(part);
    if (eq > 0) {
      const key = part.slice(0, eq).trim();
      named[key] = parseLiteral(part.slice(eq + 1).trim());
    } else {
      values.push(parseLiteral(part));
    }
  });
  return { values, named };
}

function splitAnnotationArgs(text) {
  const parts = [];
  let quoted = false;
  let quote = '';
  let depth = 0;
  let start = 0;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if ((char === '"' || char === "'") && text[index - 1] !== '\\') {
      if (!quoted) {
        quoted = true;
        quote = char;
      } else if (quote === char) {
        quoted = false;
        quote = '';
      }
      continue;
    }
    if (quoted) {
      continue;
    }
    if (char === '[' || char === '{' || char === '(') {
      depth += 1;
    } else if (char === ']' || char === '}' || char === ')') {
      depth -= 1;
    } else if (char === ',' && depth === 0) {
      parts.push(text.slice(start, index).trim());
      start = index + 1;
    }
  }
  parts.push(text.slice(start).trim());
  return parts.filter(Boolean);
}

function findTopLevelEquals(text) {
  let quoted = false;
  let quote = '';
  let depth = 0;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if ((char === '"' || char === "'") && text[index - 1] !== '\\') {
      if (!quoted) {
        quoted = true;
        quote = char;
      } else if (quote === char) {
        quoted = false;
        quote = '';
      }
      continue;
    }
    if (quoted) {
      continue;
    }
    if (char === '[' || char === '{' || char === '(') {
      depth += 1;
    } else if (char === ']' || char === '}' || char === ')') {
      depth -= 1;
    } else if (char === '=' && depth === 0) {
      return index;
    }
  }
  return -1;
}

function parseLiteral(raw) {
  const text = String(raw || '').trim();
  if (!text) {
    return '';
  }
  if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) {
    return text.slice(1, -1).replace(/\\"/g, '"').replace(/\\'/g, "'");
  }
  if (text === 'true') {
    return true;
  }
  if (text === 'false') {
    return false;
  }
  if (text === 'null') {
    return null;
  }
  if (/^-?\d+(?:\.\d+)?$/.test(text)) {
    return Number(text);
  }
  if ((text.startsWith('[') && text.endsWith(']')) || (text.startsWith('{') && text.endsWith('}'))) {
    try {
      return JSON.parse(text);
    } catch (_) {
      return text;
    }
  }
  return text;
}

function buildCompileContext(types, rootType, extensionRegistry = null) {
  const root = requiredType(types, rootType);
  const collections = new Map();
  for (const field of root.fields) {
    if (!field.type.array || field.type.kind !== 'type') {
      continue;
    }
    const itemType = requiredType(types, field.type.name);
    const key = itemType.fields.find((item) => hasAnnotation(item, 'key'));
    if (key) {
      collections.set(field.type.name, {
        field,
        path: field.name,
        refId: field.name,
        key
      });
    }
  }
  const rows = root.fields.find((field) => hasAnnotation(field, 'rows'));
  const nodes = root.fields.find((field) => hasAnnotation(field, 'nodes'));
  return { types, rootType, root, collections, rows, nodes, extensions: extensionRegistry };
}

function applyViewContextHints(context, directives) {
  const tableView = directives.views.find((view) => view.type === 'table');
  if (tableView?.target) {
    const field = context.root.fields.find((item) => item.name === tableView.target);
    if (!field) {
      throw new Error(`view table target not found on root: ${tableView.target}`);
    }
    if (context.rows && context.rows.name !== field.name) {
      throw new Error(`view table target "${field.name}" conflicts with @rows "${context.rows.name}".`);
    }
    context.rows = field;
  }

  const graphView = directives.views.find((view) => view.type === 'graph' || view.type === 'blueprint');
  if (graphView?.target) {
    const field = context.root.fields.find((item) => item.name === graphView.target);
    if (!field) {
      throw new Error(`view graph target not found on root: ${graphView.target}`);
    }
    if (context.nodes && context.nodes.name !== field.name) {
      throw new Error(`view graph target "${field.name}" conflicts with @nodes "${context.nodes.name}".`);
    }
    context.nodes = field;
  }
}

function validateAnnotations(context, options) {
  for (const type of context.types.values()) {
    for (const field of type.fields) {
      for (const annotation of field.annotations) {
        if (isCoreAnnotation(annotation.name) || context.extensions?.hasAnnotation?.(annotation.name)) {
          continue;
        }
        throw dslError(options, `Unknown annotation @${annotation.name} on ${type.name}.${field.name}`, field.line);
      }
    }
  }
}

function isCoreAnnotation(name) {
  return CORE_ANNOTATIONS.has(name);
}

function assertUniqueNames(values, label, options) {
  const seen = new Set();
  for (const value of values) {
    if (seen.has(value)) {
      throw dslError(options, `Duplicate ${label}: ${value}`);
    }
    seen.add(value);
  }
}

function compileTextDomain(domain, directives) {
  domain.format = 'text';
  domain.model = {
    type: 'text',
    language: directives.text.language
  };
  domain.kind = 'text';
  domain.defaults = {
    fileName: directives.fileName || `${domain.id}.${extensionForLanguage(directives.text.language)}`,
    text: ''
  };
  domain.source.extensions = [`.${extensionForLanguage(directives.text.language)}`];
  domain.validate = [];
  return domain;
}

function compileObjectDomain(domain, directives, context) {
  domain.format = 'json';
  domain.model = { type: 'object', root: '$' };
  domain.kind = 'document';
  domain.defaults = {
    fileName: directives.fileName || defaultJsonFileName(domain),
    data: defaultObjectForType(context, context.rootType)
  };
  domain.refs = buildRefs(context);
  domain.inspector = {
    forms: {
      meta: formForType(context, context.rootType, 'Document')
    }
  };
  domain.validate = compileTypeRules(context, context.rootType, '', {});
  return domain;
}

function compileTableDomain(domain, directives, context, options) {
  const rows = context.rows;
  if (!rows.type.array || rows.type.kind !== 'type') {
    throw dslError(options, '@rows must be an object array field.', rows?.line);
  }
  const rowType = requiredType(context.types, rows.type.name);
  const key = rowType.fields.find((field) => hasAnnotation(field, 'key'));
  if (!key) {
    throw dslError(options, `@rows item type "${rowType.name}" needs a @key field.`);
  }

  domain.format = 'json';
  domain.kind = 'table';
  domain.model = { type: 'table', rows: rows.name, rowId: key.name, id: key.name };
  domain.columns = directives.columns && directives.columns.length
    ? directives.columns
    : rowType.fields.filter((field) => !field.type.array).slice(0, 8).map((field) => field.name);
  domain.defaults = {
    fileName: directives.fileName || defaultJsonFileName(domain),
    row: defaultObjectForType(context, rowType.name, { keyField: key.name }),
    data: defaultObjectForType(context, context.rootType)
  };
  domain.refs = buildRefs(context);
  domain.inspector = {
    forms: {
      table: formForType(context, rowType.name, rowType.name)
    }
  };
  domain.validate = compileTypeRules(context, context.rootType, '', {});
  return domain;
}

function compileGraphDomain(domain, directives, context, options) {
  const nodes = context.nodes;
  if (!nodes || !nodes.type.array || nodes.type.kind !== 'type') {
    throw dslError(options, 'Graph DSL needs a @nodes object array field.', nodes?.line);
  }
  const nodeType = requiredType(context.types, nodes.type.name);
  const key = nodeType.fields.find((field) => hasAnnotation(field, 'key'));
  if (!key) {
    throw dslError(options, `@nodes item type "${nodeType.name}" needs a @key field.`);
  }
  const graphView = directives.views.find((view) => view.type === 'graph' || view.type === 'blueprint');
  const entry = context.root.fields.find((field) => hasAnnotation(field, 'entry'))
    || (graphView?.entry ? context.root.fields.find((field) => field.name === graphView.entry) : null);
  const edgeRules = compileGraphEdgeRules(context, nodes, nodeType, key);
  const position = compileGraphPosition(nodeType);
  if (directives.graph.layout === 'free' && !position) {
    throw dslError(options, 'Free graph DSL needs a node field marked with @position.');
  }

  domain.format = 'json';
  domain.kind = 'graph';
  domain.model = {
    type: 'graph',
    layout: directives.graph.layout,
    nodes: nodes.name,
    id: key.name,
    entry: entry?.name || '',
    edges: edgeRules.map((rule) => rule.model)
  };
  domain.graph = {
    layout: directives.graph.layout,
    algorithm: directives.graph.algorithm,
    grid: directives.graph.grid || 10,
    entry: entry?.name || '',
    nodes: nodes.name,
    nodeId: key.name,
    nodeKind: nodeType.fields.find((field) => field.name === 'kind') ? 'kind' : '',
    edges: edgeRules.map((rule) => rule.runtime)
  };
  if (position) {
    domain.model.position = position.model;
    domain.graph.position = position.runtime;
  }
  if (graphView?.type === 'blueprint') {
    domain.model.edges = graphView.edges || 'edges';
    domain.graph.blueprint = compileBlueprintSpec(graphView, nodes.name, key.name, position);
  }
  domain.refs = buildRefs(context);
  const metaForm = graphView?.type === 'blueprint'
    ? formForRootGraph(context, 'Graph', { exclude: [graphView.edges || 'edges'] })
    : formForRootGraph(context, 'Graph');
  domain.inspector = {
    forms: {
      meta: metaForm,
      graphNode: formForType(context, nodeType.name, nodeType.name)
    }
  };
  domain.validate = mergeValidation(
    compileTypeRules(context, context.rootType, '', {}),
    entry ? [`exists(${entry.name}, ${nodes.name}.${key.name})`] : [],
    graphView?.type === 'blueprint' ? [] : ['noDanglingEdges()']
  );
  domain.actions = {
    defaults: {
      [nodes.name]: defaultObjectForType(context, nodeType.name, { keyField: key.name })
    }
  };
  domain.defaults = {
    fileName: directives.fileName || defaultJsonFileName(domain),
    data: {
      id: `new_${domain.id}`,
      ...(entry ? { [entry.name]: defaultValueForField(context, key, { keyField: key.name }) } : {}),
      [nodes.name]: [],
      ...(graphView?.type === 'blueprint' ? { [graphView.edges || 'edges']: [] } : {})
    }
  };
  return domain;
}

function compileBlueprintSpec(view, nodesPath, nodeId, position) {
  const nodeType = view.nodeType || view.typeField || 'type';
  const values = view.values || 'values';
  const edges = view.edges || 'edges';
  return {
    nodes: view.target || nodesPath || 'nodes',
    edges,
    nodeId: nodeId || 'id',
    nodeType,
    values,
    position: typeof position === 'string' ? position : (position?.runtime || view.position || 'pos'),
    types: (view.nodeTypes || []).map((node) => ({
      id: node.id,
      title: node.title || node.label || titleFromId(node.id),
      label: node.label || node.title || titleFromId(node.id),
      color: node.color || '',
      ports: (node.ports || []).map((port) => ({
        id: port.id,
        label: port.label || titleFromId(port.id),
        direction: port.direction,
        type: port.type || 'any',
        kind: port.kind || (String(port.type).toLowerCase() === 'exec' ? 'control' : 'data'),
        default: port.default,
        multiple: !!port.multiple
      }))
    }))
  };
}

function applyViewsToDomain(domain, directives, context, options) {
  if (!directives.views.length) {
    domain.view = [legacyViewForDomain(domain)];
    dropLegacyViewConfigAliases(domain);
    return domain;
  }

  directives.views.forEach((view) => {
    if (view.modes?.length) {
      domain.modes = view.modes;
    }

    if (view.type === 'form') {
      domain.kind = domain.kind === 'text' ? 'text' : 'document';
      return;
    }

    if (view.type === 'text') {
      return;
    }

    if (view.type === 'table') {
      domain.kind = 'table';
      domain.model = {
        ...(domain.model || {}),
        type: 'table',
        rows: view.target || domain.model?.rows,
        rowId: domain.model?.rowId || domain.model?.id || 'id',
        id: domain.model?.id || domain.model?.rowId || 'id'
      };
      if (view.columns?.length) {
        domain.columns = view.columns;
      }
      return;
    }

    if (view.type === 'graph' || view.type === 'blueprint') {
      domain.kind = 'graph';
      if (view.type === 'blueprint') {
        domain.graph = {
          ...(domain.graph || {}),
          blueprint: compileBlueprintSpec(view, domain.graph?.nodes || view.target || 'nodes', domain.graph?.nodeId || 'id', domain.graph?.position || 'pos')
        };
      } else if (view.node) {
        domain.graph = {
          ...(domain.graph || {}),
          nodeView: compileGraphNodeView(view.node)
        };
      }
      return;
    }

    if (isWorkbenchViewType(view.type)) {
      applyWorkbenchView(domain, view, context, options);
    }
  });

  domain.view = directives.views.map((view) => compileRuntimeView(view, domain, context, options));
  dropLegacyViewConfigAliases(domain);
  return domain;
}

function dropLegacyViewConfigAliases(domain) {
  delete domain.surface;
  delete domain.surfaces;
}

function legacyViewForDomain(domain) {
  if (domain.kind === 'text' || domain.format === 'text') {
    return { type: 'text', view: 'text' };
  }
  if (domain.kind === 'table' || domain.model?.type === 'table') {
    return {
      type: 'table',
      view: 'table',
      target: domain.model?.rows || 'items',
      columns: domain.columns || []
    };
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
  if (domain.workbench) {
    const defaultState = readWorkbenchDefault(domain.workbench, domain);
    return {
      type: 'workbench',
      view: 'workbench',
      layout: readWorkbenchLayout(domain.workbench, domain),
      target: defaultState.collection || ''
    };
  }
  return { type: 'form', view: 'form-json' };
}

function compileRuntimeView(view, domain, context, options) {
  const extensionSpec = options.extensionRegistry?.compileView?.({
    view: clone(view),
    domain: clone(domain),
    context
  });
  if (extensionSpec && typeof extensionSpec === 'object' && !Array.isArray(extensionSpec)) {
    return normalizeRuntimeView({
      ...view,
      ...extensionSpec,
      type: extensionSpec.type || view.type,
      target: extensionSpec.target || view.target
    }, domain);
  }

  return normalizeRuntimeView(view, domain);
}

function normalizeRuntimeView(view, domain) {
  const result = {};
  for (const [key, value] of Object.entries(view || {})) {
    if (value === undefined || key === 'line') {
      continue;
    }
    result[key] = clone(value);
  }
  const originalType = result.type || 'form';
  result.type = normalizeRuntimeViewType(originalType);
  result.view = getDslRuntimeViewId(result, domain);
  dropLegacyViewSpecAliases(result);
  if (result.type === 'blueprint') {
    result.view = result.view || 'graph-blueprint';
    result.layout = domain.graph?.layout || result.layout || 'free';
    result.algorithm = domain.graph?.algorithm || result.algorithm || 'free';
    result.target = result.target || domain.graph?.blueprint?.nodes || domain.graph?.nodes || domain.model?.nodes || 'nodes';
    result.edges = result.edges || domain.graph?.blueprint?.edges || domain.model?.edges || 'edges';
  } else if (result.type === 'graph') {
    result.view = result.view || (domain.graph?.layout === 'free' ? 'graph-free' : 'graph-fixed');
    result.layout = domain.graph?.layout || result.layout || 'fixed';
    result.algorithm = domain.graph?.algorithm || result.algorithm || '';
    result.entry = result.entry || domain.graph?.entry || '';
    result.target = result.target || domain.graph?.nodes || domain.model?.nodes || 'nodes';
    if (result.node && !result.nodeView) {
      result.nodeView = compileGraphNodeView(result.node);
    }
  } else if (result.type === 'table') {
    result.target = result.target || domain.model?.rows || 'items';
    result.columns = result.columns || domain.columns || [];
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
  delete result.node;
  return result;
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
  if (isWorkbenchViewType(view.type)) {
    return 'workbench';
  }
  if (view.type === 'form') {
    return 'form-json';
  }
  return view.view || readLegacyDslViewId(view) || view.type;
}

function getDslRuntimeViewId(view, domain) {
  return view.view || readLegacyDslViewId(view) || fallbackViewIdForSpec(view, domain);
}

function readLegacyDslViewId(view) {
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
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function readDefaultScalar(value) {
  return value && (typeof value !== 'object' || Array.isArray(value)) ? value : '';
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

function compileGraphNodeView(nodeConfig) {
  const result = {};
  ['badge', 'title', 'body'].forEach((key) => {
    if (nodeConfig[key]) {
      result[key] = nodeConfig[key];
    }
  });
  if (nodeConfig.details?.length) {
    result.details = nodeConfig.details;
  }
  return result;
}

function applyWorkbenchView(domain, view, context, options) {
  if (!context) {
    throw dslError(options, `view ${view.type} needs a data block.`);
  }

  const collections = compileViewCollections(view, context, options);
  const defaultState = readWorkbenchDefault(view, domain, collections);
  domain.kind = 'document';
  domain.workbench = {
    ...(domain.workbench || {}),
    type: 'workbench',
    layout: readWorkbenchLayout(view, domain),
    default: defaultState,
    collections
  };
  if (view.inspector !== undefined) {
    domain.workbench.inspector = view.inspector;
  }
  if (view.diagnostics !== undefined) {
    domain.workbench.diagnostics = view.diagnostics;
  }
  if (Array.isArray(view.references)) {
    domain.workbench.references = view.references;
  }

  if (view.previews?.length) {
    domain.workbench.preview = view.previews.map((preview) => ({
      id: preview.id,
      label: preview.label || titleFromId(preview.id),
      sourceCollection: preview.sourceCollection || preview.collection || preview.source || '',
      routePath: preview.routePath || preview.path || '',
      nodeTitle: preview.nodeTitle || preview.title || 'name',
      contentTypePath: preview.contentTypePath || '',
      contentIdPath: preview.contentIdPath || '',
      ...(preview.contentRefs && typeof preview.contentRefs === 'object' && !Array.isArray(preview.contentRefs)
        ? { contentRefs: preview.contentRefs }
        : {})
    }));
  }

  if (context.collectionForms) {
    domain.inspector = domain.inspector || {};
    domain.inspector.forms = {
      ...(domain.inspector.forms || {}),
      ...context.collectionForms
    };
  }
}

function compileViewCollections(view, context, options) {
  const configured = view.collections?.length
    ? view.collections
    : context.root.fields
      .filter((field) => field.type.array && field.type.kind === 'type')
      .map((field) => ({ id: field.name, path: field.name }));

  return configured.map((item) => {
    const pathText = item.path || item.collection || item.id;
    const field = context.root.fields.find((rootField) => rootField.name === pathText);
    if (!field || !field.type.array || field.type.kind !== 'type') {
      throw dslError(options, `view ${view.type} collection "${item.id}" must target a root object array.`);
    }
    const itemType = requiredType(context.types, field.type.name);
    const key = itemType.fields.find((child) => hasAnnotation(child, 'key'));
    const formName = item.form || item.id;
    const modeList = item.modes || view.modes || ['detail', 'json'];
    const list = item.list || item.layouts || item.views || view.list || view.layouts || ['detail', 'grid'];
    const defaultState = readWorkbenchDefault(view);
    const collectionDefault = readCollectionDefault(item, view, defaultState);
    return {
      id: item.id,
      label: item.label || titleFromId(item.id),
      path: pathText,
      idPath: item.idPath || key?.name || 'id',
      title: item.title || 'name',
      subtitle: item.subtitle || [],
      search: item.search || [],
      modes: normalizeViewModes(modeList, formName),
      list: list.map((layout) => typeof layout === 'string' ? layout : layout.id).filter(Boolean),
      columns: item.columns || [],
      ...(item.variants ? { variants: item.variants } : {}),
      ...(item.defaultItem ? { defaultItem: item.defaultItem } : {}),
      form: formName,
      default: collectionDefault,
      __type: itemType.name
    };
  }).map((collection) => {
    attachCollectionForm(context, collection.form, collection.__type);
    const { __type, ...publicCollection } = collection;
    return publicCollection;
  });
}

function attachCollectionForm(context, formName, typeName) {
  if (!context.collectionForms) {
    context.collectionForms = {};
  }
  context.collectionForms[formName] = formForType(context, typeName, titleFromId(formName));
}

function normalizeViewModes(modes, formName) {
  return modes.map((mode) => {
    if (mode && typeof mode === 'object' && !Array.isArray(mode)) {
      return mode;
    }
    return mode === 'json'
      ? { id: 'json', label: 'JSON', view: 'json' }
      : { id: mode, label: titleFromId(mode), form: mode === 'detail' || mode === 'overview' ? formName : mode };
  });
}

function readCollectionDefault(collection = {}, view = {}, workbenchDefault = {}) {
  const collectionDefault = readDefaultObject(collection.default);
  const viewDefault = readDefaultObject(view.default);
  return {
    mode: collectionDefault.mode
      || collection.defaultMode
      || viewDefault.mode
      || view.defaultMode
      || workbenchDefault.mode
      || 'overview'
  };
}

function normalizeWorkbenchCollectionList(collections) {
  const items = Array.isArray(collections)
    ? collections
    : collections && typeof collections === 'object'
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

function compileGraphEdgeRules(context, nodesField, nodeType, keyField) {
  const rules = [];
  nodeType.fields
    .filter((field) => hasAnnotation(field, 'edge'))
    .forEach((field) => {
      rules.push(buildGraphEdgeRule(context, nodesField, field, field.name, keyField));
    });

  nodeType.fields
    .filter((field) => field.type.array && field.type.kind === 'type' && context.types.has(field.type.name))
    .forEach((field) => {
      const itemType = requiredType(context.types, field.type.name);
      itemType.fields
        .filter((child) => hasAnnotation(child, 'edge'))
        .forEach((child) => {
          rules.push(buildGraphEdgeRule(context, nodesField, child, `${field.name}.${child.name}`, keyField));
        });
    });

  return rules;
}

function buildGraphEdgeRule(context, nodesField, field, fieldPath, keyField) {
  const ref = field.type.kind === 'ref'
    ? refForTarget(context, field.type.targetType, field.type.targetField)
    : null;
  const targetCollection = ref?.path || nodesField.name;
  const targetKey = ref?.key?.name || keyField.name;
  const from = `${nodesField.name}.${fieldPath}`;
  const to = `${targetCollection}.${targetKey}`;
  const edgeAnnotation = getAnnotation(field, 'edge');
  const metadata = annotationNamedObject(edgeAnnotation);
  const rule = {
    from,
    to
  };

  ['label', 'labelPath', 'labelFrom', 'tone', 'color', 'kind'].forEach((key) => {
    if (metadata[key] !== undefined) {
      rule[key] = metadata[key];
    }
  });

  if (edgeAnnotation?.args.values.length) {
    rule.label = edgeAnnotation.args.values[0];
  }

  return Object.keys(rule).length > 2
    ? { model: fieldPath, runtime: rule }
    : { model: fieldPath, runtime: `${from} -> ${to}` };
}

function annotationNamedObject(annotation) {
  return annotation?.args?.named && typeof annotation.args.named === 'object'
    ? annotation.args.named
    : {};
}

function formForRootGraph(context, title, options = {}) {
  const excluded = new Set(options.exclude || []);
  const fields = context.root.fields
    .filter((field) => !hasAnnotation(field, 'nodes') && !excluded.has(field.name))
    .map((field) => fieldToFormField(context, field));
  return {
    groups: [{
      title,
      fields
    }]
  };
}

function formForType(context, typeName, title) {
  const type = requiredType(context.types, typeName);
  return {
    groups: [{
      title,
      fields: type.fields.map((field) => fieldToFormField(context, field, new Set([typeName])))
    }]
  };
}

function fieldToFormField(context, field, seen = new Set()) {
  const formField = {
    path: field.name,
    label: annotationValue(field, 'label', titleFromId(field.name)),
    required: !field.optional
  };
  const scalar = scalarType(field.type);
  if (field.type.kind === 'ref' && !field.type.array) {
    const ref = refForTarget(context, field.type.targetType, field.type.targetField);
    formField.type = 'reference';
    formField.ref = ref?.refId || field.type.targetType;
    formField.value = scalarType(targetFieldType(context, field.type)) || 'int';
    if (field.optional) {
      formField.clear = true;
      formField.emptyLabel = 'None';
    }
    applyFieldPresentationAnnotations(context, field, formField);
    return formField;
  }
  if (field.type.array) {
    const itemType = field.type.kind === 'type' ? context.types.get(field.type.name) : null;
    if (itemType && !scalar) {
      formField.type = 'repeater';
      formField.defaultItem = defaultObjectForType(context, itemType.name);
      formField.fields = itemType.fields.map((child) => fieldToFormField(context, child, new Set([itemType.name])));
    } else if (field.type.kind === 'ref') {
      const ref = refForTarget(context, field.type.targetType, field.type.targetField);
      formField.type = 'array';
      formField.defaultItem = defaultValueForField(context, { ...field, type: { ...field.type, array: false } });
      formField.item = {
        type: 'reference',
        ref: ref?.refId || field.type.targetType,
        value: scalarType(targetFieldType(context, field.type)) || 'int',
        clear: true,
        emptyLabel: 'None'
      };
    } else {
      formField.type = 'array';
      formField.defaultItem = defaultValueForField(context, { ...field, type: { ...field.type, array: false } });
      formField.item = { type: scalar === 'int' || scalar === 'number' ? 'number' : 'text', value: scalar || 'string' };
    }
    applyFieldPresentationAnnotations(context, field, formField);
    return formField;
  }
  if (scalar === 'any') {
    formField.type = 'readonly';
    formField.hint = formField.hint || 'Edit this value in JSON mode.';
  } else if (scalar === 'int' || scalar === 'number') {
    formField.type = 'number';
    formField.value = scalar;
  } else if (scalar === 'boolean') {
    formField.type = 'checkbox';
  } else if (field.name.toLowerCase().includes('text') || field.name.toLowerCase().includes('desc')) {
    formField.type = 'textarea';
    formField.rows = 3;
  } else if (scalar === 'string') {
    formField.type = 'text';
  } else if (field.type.kind === 'type' && context.types.has(field.type.name) && !seen.has(field.type.name)) {
    const nestedSeen = new Set(seen);
    nestedSeen.add(field.type.name);
    const nestedType = requiredType(context.types, field.type.name);
    formField.type = 'object';
    formField.defaultItem = defaultObjectForType(context, field.type.name);
    formField.fields = nestedType.fields.map((child) => fieldToFormField(context, child, nestedSeen));
  } else {
    formField.type = 'readonly';
  }
  applyFieldPresentationAnnotations(context, field, formField);
  return formField;
}

function applyFieldPresentationAnnotations(context, field, formField) {
  const hint = annotationValue(field, 'hint', annotationValue(field, 'description', ''));
  const placeholder = annotationValue(field, 'placeholder', '');
  const enumValues = annotationList(field, 'enum').concat(annotationList(field, 'options'));
  const range = annotationRange(field);

  if (hint) {
    formField.hint = hint;
  }
  if (placeholder) {
    formField.placeholder = placeholder;
  }
  if (enumValues.length) {
    formField.type = 'select';
    formField.options = enumValues.map((value) => ({ value, label: String(value) }));
  }
  if (hasAnnotation(field, 'textarea')) {
    formField.type = 'textarea';
    formField.rows = Number(annotationNamedValue(field, 'textarea', 'rows', 4)) || 4;
  }
  if (hasAnnotation(field, 'select')) {
    formField.type = 'select';
  }
  if (hasAnnotation(field, 'readonly')) {
    formField.type = 'readonly';
  }
  if (hasAnnotation(field, 'refresh')) {
    formField.refresh = true;
  }
  if (range.min !== undefined) {
    formField.min = range.min;
  }
  if (range.max !== undefined) {
    formField.max = range.max;
  }
  const step = annotationValue(field, 'step', undefined);
  if (step !== undefined) {
    formField.step = step;
  }

  const extensionPatch = context.extensions?.applyFieldFormAnnotations?.({
    context,
    field,
    formField
  });
  if (extensionPatch && typeof extensionPatch === 'object' && !Array.isArray(extensionPatch)) {
    Object.assign(formField, extensionPatch);
  }
}

function compileGraphPosition(nodeType) {
  const objectPosition = nodeType.fields.find((field) => hasAnnotation(field, 'position'));
  if (objectPosition) {
    return { model: objectPosition.name, runtime: objectPosition.name };
  }
  const x = nodeType.fields.find((field) => hasAnnotation(field, 'position.x'));
  const y = nodeType.fields.find((field) => hasAnnotation(field, 'position.y'));
  if (x && y) {
    return {
      model: { x: x.name, y: y.name },
      runtime: { x: x.name, y: y.name }
    };
  }
  return null;
}

function annotationValue(field, name, fallback) {
  const annotation = getAnnotation(field, name);
  if (!annotation) {
    return fallback;
  }
  if (annotation.args.values.length) {
    return annotation.args.values[0];
  }
  if (Object.prototype.hasOwnProperty.call(annotation.args.named, 'value')) {
    return annotation.args.named.value;
  }
  return fallback === undefined ? true : fallback;
}

function annotationNamedValue(field, name, key, fallback) {
  const annotation = getAnnotation(field, name);
  if (!annotation) {
    return fallback;
  }
  return Object.prototype.hasOwnProperty.call(annotation.args.named, key)
    ? annotation.args.named[key]
    : fallback;
}

function annotationList(field, name) {
  const annotation = getAnnotation(field, name);
  if (!annotation) {
    return [];
  }
  if (Array.isArray(annotation.args.named.values)) {
    return annotation.args.named.values;
  }
  if (Array.isArray(annotation.args.named.value)) {
    return annotation.args.named.value;
  }
  if (annotation.args.values.length === 1 && Array.isArray(annotation.args.values[0])) {
    return annotation.args.values[0];
  }
  return annotation.args.values;
}

function annotationRange(field) {
  const range = {};
  const rangeAnnotation = getAnnotation(field, 'range');
  if (rangeAnnotation) {
    if (rangeAnnotation.args.values.length > 0) {
      range.min = rangeAnnotation.args.values[0];
    }
    if (rangeAnnotation.args.values.length > 1) {
      range.max = rangeAnnotation.args.values[1];
    }
    if (rangeAnnotation.args.named.min !== undefined) {
      range.min = rangeAnnotation.args.named.min;
    }
    if (rangeAnnotation.args.named.max !== undefined) {
      range.max = rangeAnnotation.args.named.max;
    }
  }
  const min = annotationValue(field, 'min', undefined);
  const max = annotationValue(field, 'max', undefined);
  if (min !== undefined) {
    range.min = min;
  }
  if (max !== undefined) {
    range.max = max;
  }
  return range;
}

function compileTypeRules(context, typeName, basePath, state) {
  const type = requiredType(context.types, typeName);
  const rules = [];
  if (!basePath) {
    rules.push({ rule: 'type', path: '', value: 'object' });
  }
  for (const field of type.fields) {
    const pathText = basePath ? `${basePath}.${field.name}` : field.name;
    const scalar = scalarType(field.type);
    const isEdge = hasAnnotation(field, 'edge');
    if (!field.optional) {
      rules.push({ rule: 'required', path: pathText });
    }
    if (field.type.array) {
      const itemType = field.type.kind === 'ref'
        ? (scalarType(targetFieldType(context, field.type)) || 'int')
        : (scalar || 'object');
      rules.push({ rule: 'type', path: pathText, value: 'array' });
      rules.push({ rule: 'eachType', path: pathText, value: itemType });
      if (!scalar && field.type.kind === 'type') {
        rules.push(...compileTypeRules(context, field.type.name, `${pathText}[]`, { parentArray: pathText }));
      }
    } else if (scalar) {
      if (scalar !== 'any') {
        rules.push({ rule: 'type', path: pathText, value: scalar });
      }
    } else if (field.type.kind === 'type') {
      rules.push({ rule: 'type', path: pathText, value: 'object' });
      rules.push(...compileTypeRules(context, field.type.name, pathText, state));
    }
    if (hasAnnotation(field, 'key') && state.parentArray) {
      rules.push(`unique(${state.parentArray}.${field.name})`);
    }
    if (field.type.kind === 'ref' && !isEdge && !hasAnnotation(field, 'entry')) {
      const ref = refForTarget(context, field.type.targetType, field.type.targetField);
      if (ref) {
        rules.push({ rule: 'refExists', path: field.type.array ? `${pathText}[]` : pathText, ref: ref.refId });
      }
    }
    rules.push(...compileFieldAnnotationRules(context, field, pathText));
  }
  return mergeValidation(rules);
}

function compileFieldAnnotationRules(context, field, pathText) {
  const rules = [];
  const enumValues = annotationList(field, 'enum').concat(annotationList(field, 'options'));
  if (enumValues.length) {
    rules.push({ rule: 'enum', path: pathText, values: enumValues });
  }

  const range = annotationRange(field);
  if (range.min !== undefined || range.max !== undefined) {
    rules.push({ rule: 'range', path: pathText, ...range });
  }

  const pattern = annotationValue(field, 'pattern', undefined);
  if (pattern !== undefined && pattern !== true) {
    rules.push({ rule: 'pattern', path: pathText, pattern: String(pattern) });
  }

  const lengthAnnotation = getAnnotation(field, 'length');
  if (lengthAnnotation) {
    const rule = { rule: 'length', path: pathText };
    if (lengthAnnotation.args.values.length > 0) {
      rule.min = lengthAnnotation.args.values[0];
    }
    if (lengthAnnotation.args.values.length > 1) {
      rule.max = lengthAnnotation.args.values[1];
    }
    Object.assign(rule, lengthAnnotation.args.named);
    rules.push(rule);
  }

  const itemsAnnotation = getAnnotation(field, 'items');
  if (itemsAnnotation) {
    const rule = { rule: 'items', path: pathText };
    if (itemsAnnotation.args.values.length > 0) {
      rule.min = itemsAnnotation.args.values[0];
    }
    if (itemsAnnotation.args.values.length > 1) {
      rule.max = itemsAnnotation.args.values[1];
    }
    Object.assign(rule, itemsAnnotation.args.named);
    rules.push(rule);
  }

  const extensionRules = context.extensions?.compileFieldValidationRules?.({
    context,
    field,
    path: pathText
  });
  if (Array.isArray(extensionRules)) {
    rules.push(...extensionRules);
  }
  return rules;
}

function buildRefs(context) {
  const refs = {};
  for (const collection of context.collections.values()) {
    refs[collection.refId] = {
      path: collection.path,
      value: collection.key.name,
      labelTemplate: `#{${collection.key.name}}`
    };
  }
  return refs;
}

function refForTarget(context, typeName, fieldName) {
  const collection = context.collections.get(typeName);
  if (!collection || collection.key.name !== fieldName) {
    return null;
  }
  return collection;
}

function defaultObjectForType(context, typeName, options = {}) {
  const type = requiredType(context.types, typeName);
  const result = {};
  for (const field of type.fields) {
    if (field.optional && !hasAnnotation(field, 'position') && fieldDefaultValue(field) === undefined) {
      continue;
    }
    result[field.name] = defaultValueForField(context, field, options);
  }
  return result;
}

function defaultValueForField(context, field, options = {}) {
  const explicitDefault = fieldDefaultValue(field);
  if (explicitDefault !== undefined) {
    return clone(explicitDefault);
  }
  if (field.name === options.keyField) {
    return scalarType(field.type) === 'string' ? `${field.name}_1` : 1;
  }
  if (field.type.array) {
    return [];
  }
  const scalar = scalarType(field.type);
  if (scalar === 'int' || scalar === 'number') {
    return 0;
  }
  if (scalar === 'boolean') {
    return false;
  }
  if (scalar === 'string') {
    return '';
  }
  if (field.type.kind === 'ref') {
    return scalarType(targetFieldType(context, field.type)) === 'string' ? '' : 0;
  }
  if (field.type.kind === 'type') {
    return defaultObjectForType(context, field.type.name, options);
  }
  return null;
}

function fieldDefaultValue(field) {
  if (field.defaultValue !== undefined) {
    return field.defaultValue;
  }
  const annotation = getAnnotation(field, 'default');
  if (!annotation) {
    return undefined;
  }
  if (annotation.args.values.length) {
    return annotation.args.values[0];
  }
  if (Object.prototype.hasOwnProperty.call(annotation.args.named, 'value')) {
    return annotation.args.named.value;
  }
  return undefined;
}

function targetFieldType(context, refType) {
  const type = context.types.get(refType.targetType);
  return type?.fields.find((field) => field.name === refType.targetField)?.type || { name: 'int' };
}

function scalarType(typeExpr) {
  if (typeExpr.kind === 'ref') {
    return null;
  }
  const raw = String(typeExpr.name || '').toLowerCase();
  if (!SCALARS.has(raw)) {
    return null;
  }
  if (raw === 'bool') {
    return 'boolean';
  }
  if (raw === 'float') {
    return 'number';
  }
  if (raw === 'json') {
    return 'any';
  }
  return raw;
}

function hasAnnotation(field, name) {
  return !!getAnnotation(field, name);
}

function getAnnotation(field, name) {
  return field.annotations.find((annotation) => annotation.name === name);
}

function requiredType(types, name) {
  const type = types.get(name);
  if (!type) {
    throw new Error(`Unknown type: ${name}`);
  }
  return type;
}

function defaultJsonFileName(domain) {
  if (domain.source.type === 'single-json') {
    return path.basename(domain.source.path);
  }
  return `${domain.id}.json`;
}

function extensionForLanguage(language) {
  const value = String(language || '').trim().toLowerCase();
  if (value === 'lua') {
    return 'lua';
  }
  if (value === 'json') {
    return 'json';
  }
  return 'txt';
}

function titleFromId(id) {
  return String(id || '')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function dslError(options, message, line = 0) {
  const location = options.path
    ? `${options.path}${line ? `:${line}` : ''}`
    : '';
  const label = location ? `${location}: ${message}` : message;
  return new Error(label);
}

function clone(value) {
  if (value === undefined) {
    return undefined;
  }
  return JSON.parse(JSON.stringify(value));
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
      result.push(rule);
    }
  }
  return result;
}

module.exports = {
  compileFweDsl,
  collectFweDslUses
};
