// Inspector form and JSON-mode helpers.
// Loaded before app.js; these functions intentionally live in the browser global scope.

function renderInspector(extra = {}) {
  if (!state.data || state.domain?.kind === 'text') {
    inspectorTitle.textContent = state.file?.name || getAppLabel('inspector');
    renderInspectorMode();
    inspectorForm.innerHTML = `<div class="inspector-empty">${escapeHtml(getAppLabel('noStructuredSelection'))}</div>`;
    return;
  }

  const context = extra.edge
    ? buildEdgeInspectorContext(extra.edge)
    : buildInspectorContext();
  inspectorTitle.textContent = context.title;
  renderInspectorMode();

  if (state.inspectorMode === 'json') {
    renderJsonInspector(context);
    return;
  }

  renderFormInspector(context);
}

function renderFormInspector(context) {
  inspectorForm.innerHTML = '';

  if (context.readonly) {
    renderInspectorReadonly(context);
    return;
  }

  const form = resolveInspectorForm(context) || createAutoInspectorForm(context);
  if (!form) {
    renderInspectorReadonly(context);
    return;
  }

  renderInspectorForm(form, context);
}

function renderInspectorMode() {
  const isJson = state.inspectorMode === 'json';
  inspectorFormView.classList.toggle('hidden', isJson);
  inspectorJsonView.classList.toggle('hidden', !isJson);
  inspectorFormModeButton.classList.toggle('is-active', !isJson);
  inspectorJsonModeButton.classList.toggle('is-active', isJson);
}

function switchInspectorMode(mode) {
  if (mode === state.inspectorMode) {
    return;
  }
  if (state.inspectorMode === 'json' && mode === 'form' && state.jsonDirty && !applyJsonDraft({ rerender: false })) {
    return;
  }
  state.inspectorMode = mode;
  if (mode === 'json') {
    resetJsonDraftState();
  }
  renderInspector();
}

function resetJsonDraftState() {
  state.jsonDraft = '';
  state.jsonDirty = false;
  state.jsonError = '';
  state.jsonTargetSignature = '';
}

function renderJsonInspector(context) {
  syncJsonDraftForContext(context);
  if (jsonEditor.value !== state.jsonDraft) {
    jsonEditor.value = state.jsonDraft;
  }
  jsonEditor.disabled = !!context.readonly;
  jsonApplyButton.disabled = !!context.readonly || !state.jsonDirty;
  jsonRevertButton.disabled = !state.jsonDirty;
  jsonScopeText.textContent = getJsonScopeText(context);
  renderJsonError();
}

function renderJsonError() {
  jsonErrorText.textContent = state.jsonError || '';
  jsonErrorText.classList.toggle('hidden', !state.jsonError);
}

function applyJsonDraft(options = {}) {
  const { rerender = true } = options;
  const context = buildInspectorContext();
  const ok = applyJsonDraftForContext(context);
  if (!ok) {
    return false;
  }
  if (rerender) {
    renderInspector();
  }
  return true;
}

function applyJsonDraftForContext(context) {
  if (!state.jsonDirty) {
    return true;
  }
  if (context.readonly) {
    state.jsonError = getAppLabel('selectionReadOnly');
    renderJsonError();
    return false;
  }

  let parsed;
  try {
    parsed = JSON.parse(state.jsonDraft || 'null');
  } catch (error) {
    state.jsonError = formatAppLabel('invalidJson', 'JSON 无效：{message}', { message: error.message });
    renderJsonError();
    setStatus(state.jsonError, true);
    return false;
  }

  pushHistory(`JSON ${context.title}`);
  if (context.targetPath) {
    setByPath(state.data, context.targetPath, parsed);
  } else {
    state.data = parsed;
  }

  state.jsonDirty = false;
  state.jsonError = '';
  state.jsonTargetSignature = getInspectorContextSignature(context);
  state.dirty = true;
  renderDiagnostics();
  if (state.domain.kind === 'graph') {
    renderGraph();
  }
  setStatus(formatAppLabel('dirty', '已修改 - {title}', { title: context.title }));
  return true;
}

function syncJsonDraftForContext(context) {
  const signature = getInspectorContextSignature(context);
  if (!state.jsonDirty || state.jsonTargetSignature !== signature) {
    state.jsonTargetSignature = signature;
    state.jsonDraft = JSON.stringify(context.value ?? context.target ?? null, null, 2);
    state.jsonDirty = false;
    state.jsonError = '';
  }
  return state.jsonDraft;
}

function renderEmbeddedJsonEditor(host, context, options = {}) {
  syncJsonDraftForContext(context);
  host.innerHTML = '';

  const wrapper = document.createElement('div');
  wrapper.className = options.className || 'collection-json-editor';
  const toolbar = document.createElement('div');
  toolbar.className = 'collection-json-editor__toolbar';
  const scope = document.createElement('span');
  scope.textContent = getJsonScopeText(context);
  toolbar.append(scope);

  const apply = document.createElement('button');
  apply.type = 'button';
  apply.textContent = options.applyLabel || getAppLabel('apply');
  toolbar.append(apply);

  const revert = document.createElement('button');
  revert.type = 'button';
  revert.textContent = options.revertLabel || getAppLabel('revert');
  toolbar.append(revert);
  wrapper.append(toolbar);

  const error = document.createElement('div');
  error.className = 'inspector-json__error hidden';
  wrapper.append(error);

  const textarea = document.createElement('textarea');
  textarea.className = 'code';
  textarea.spellcheck = false;
  textarea.value = state.jsonDraft;
  textarea.disabled = !!context.readonly;
  wrapper.append(textarea);

  const refreshControls = () => {
    apply.disabled = !!context.readonly || !state.jsonDirty;
    revert.disabled = !state.jsonDirty;
    error.textContent = state.jsonError || '';
    error.classList.toggle('hidden', !state.jsonError);
  };

  textarea.addEventListener('input', () => {
    state.jsonDraft = textarea.value;
    state.jsonDirty = true;
    state.jsonError = '';
    setStatus(getAppLabel('jsonDraftChanged'));
    refreshControls();
  });

  apply.addEventListener('click', () => {
    if (!applyJsonDraftForContext(context)) {
      refreshControls();
      return;
    }
    options.afterApply?.();
  });

  revert.addEventListener('click', () => {
    state.jsonDirty = false;
    state.jsonError = '';
    state.jsonTargetSignature = '';
    options.afterRevert?.();
  });

  refreshControls();
  host.append(wrapper);
}

function getInspectorContextSignature(context) {
  return [
    context.kind,
    context.key || '',
    context.targetPath || '',
    context.title || ''
  ].join('|');
}

function getJsonScopeText(context) {
  if (context.readonly) {
    return `${context.title} (read-only)`;
  }
  return context.targetPath ? context.targetPath : 'file';
}

function buildInspectorContext() {
  if (state.selectedEdge) {
    return buildEdgeInspectorContext(state.selectedEdge);
  }

  if (state.domain.kind === 'table') {
    ensureTableSelection();
  }

  if (state.domain.kind === 'graph') {
    const graph = isBlueprintGraph() ? buildBlueprintModel() : buildGraphModel();
    const node = graph.nodeMap.get(state.selectedKey);
    if (node && !isVirtualGraphNode(node)) {
      return {
        kind: 'graph-node',
        title: `${node.collection} #${node.id}`,
        key: node.key,
        collection: node.collection,
        graph,
        target: node.value,
        targetPath: getGraphNodeDataPath(node),
        value: node.value
      };
    }

    return {
      kind: 'meta',
      title: state.file?.name || state.domain.title || state.domain.id,
      graph,
      target: state.data,
      targetPath: '',
      value: state.data
    };
  }

  if (isRootFormDocumentDomain()) {
    return buildRootInspectorContext();
  }

  if (state.selectedKey) {
    const target = getByPath(state.data, state.selectedKey);
    if (target !== undefined) {
      const collection = inferWorkbenchCollectionFromPath(state.selectedKey);
      return {
        kind: collection?.id || state.domain.kind,
        title: collection ? `${collection.label || collection.id}: ${state.selectedKey}` : state.selectedKey,
        collection: collection?.id || '',
        target,
        targetPath: state.selectedKey,
        value: target
      };
    }
  }

  return buildRootInspectorContext();
}

function ensureTableSelection() {
  const rowsPath = state.domain?.model?.rows || 'items';
  const rows = ensureArray(getByPath(state.data, rowsPath));
  if (!rows.length) {
    return;
  }

  const currentPath = String(state.selectedKey || '');
  const currentTarget = currentPath.startsWith(`${rowsPath}[`) ? getByPath(state.data, currentPath) : undefined;
  if (currentTarget && typeof currentTarget === 'object' && !Array.isArray(currentTarget)) {
    return;
  }

  state.selectedKey = `${rowsPath}[0]`;
  state.selectedEdge = null;
}

function isRootFormDocumentDomain() {
  return state.domain?.kind === 'document'
    && state.domain?.model?.type === 'object'
    && !!state.domain?.inspector?.forms?.meta
    && !state.domain?.workbench;
}

function buildRootInspectorContext() {
  return {
    kind: 'meta',
    title: state.file?.name || state.domain.title || state.domain.id,
    target: state.data,
    targetPath: '',
    value: state.data
  };
}

function inferWorkbenchCollectionFromPath(pathText) {
  if (!isCollectionWorkbench()) {
    return null;
  }
  return getWorkbenchCollections().find((collection) => String(pathText || '').startsWith(`${collection.path}[`)) || null;
}

function buildEdgeInspectorContext(edge) {
  return {
    kind: 'edge',
    title: `${edge.from} -> ${edge.to}`,
    target: edge,
    targetPath: '',
    value: edge,
    readonly: true
  };
}

function getGraphNodeDataPath(node) {
  const model = state.domain.model || {};
  const collectionPath = model[node.collection] || node.collection;
  const rows = ensureArray(getByPath(state.data, collectionPath));
  const idKey = getGraphCollectionIdKey(node.collection);
  const index = rows.findIndex((item) => String(item?.[idKey]) === String(node.id));
  return index >= 0 ? `${collectionPath}[${index}]` : collectionPath;
}

function resolveInspectorForm(context) {
  const forms = state.domain.inspector?.forms || {};
  if (context.kind === 'graph-node' && isBlueprintGraph()) {
    return buildBlueprintNodeInspectorForm(context);
  }
  if (context.kind === 'graph-node') {
    const kind = context.target?.[state.domain.graph?.nodeKind || 'kind'];
    return forms[`${context.collection}:${kind}`]
      || forms[context.collection]
      || forms.graphNode
      || forms.default;
  }
  return forms[context.kind] || forms.default;
}

function buildBlueprintNodeInspectorForm(context) {
  const spec = getBlueprintSpec();
  const model = context.graph || buildBlueprintModel();
  const node = model.nodeMap.get(context.key);
  const typeOptions = [...model.typeMap.values()].map((type) => ({
    value: type.id,
    label: type.title || type.id
  }));
  const fields = [
    {
      path: spec.nodeId,
      label: 'Id',
      type: 'number',
      value: 'int',
      required: true
    },
    {
      path: spec.nodeType,
      label: '节点类型',
      type: 'select',
      options: typeOptions,
      required: true,
      refresh: true
    }
  ];

  const valueFields = (node?.typeSpec?.inputs || [])
    .filter((port) => port.kind === 'data' && !isBlueprintInputConnected(node, port.id))
    .map((port) => ({
      path: `${spec.values}.${port.id}`,
      label: `${port.label || port.id}: ${port.type}`,
      type: blueprintPortValueFieldType(port),
      value: blueprintPortScalarType(port),
      placeholder: port.default === undefined ? '' : String(port.default)
    }));

  const posFields = [
    {
      path: `${spec.position}.x`,
      label: 'X',
      type: 'number',
      value: 'int',
      required: true,
      refresh: true
    },
    {
      path: `${spec.position}.y`,
      label: 'Y',
      type: 'number',
      value: 'int',
      required: true,
      refresh: true
    }
  ];

  return {
    groups: [
      { title: '节点', fields },
      { title: '输入值', fields: valueFields.length ? valueFields : [{ path: '__none', label: '没有可编辑输入值', type: 'readonly' }] },
      { title: '位置', fields: posFields }
    ]
  };
}

function isBlueprintInputConnected(node, portId) {
  return !!node?.incoming?.some((edge) => edge.toPort === portId);
}

function blueprintPortValueFieldType(port) {
  const type = String(port.type || '').toLowerCase();
  if (type === 'int' || type === 'number' || type === 'float') {
    return 'number';
  }
  if (type === 'bool' || type === 'boolean') {
    return 'checkbox';
  }
  return 'text';
}

function blueprintPortScalarType(port) {
  const type = String(port.type || '').toLowerCase();
  if (type === 'int') {
    return 'int';
  }
  if (type === 'number' || type === 'float') {
    return 'number';
  }
  if (type === 'bool') {
    return 'boolean';
  }
  return type || 'string';
}

function createAutoInspectorForm(context) {
  const target = context.target;
  if (!target || typeof target !== 'object' || Array.isArray(target)) {
    return null;
  }
  const fields = Object.entries(target).slice(0, 40).map(([key, value]) => {
    if (typeof value === 'boolean') {
      return { path: key, label: key, type: 'checkbox' };
    }
    if (typeof value === 'number') {
      return { path: key, label: key, type: 'number' };
    }
    if (typeof value === 'string') {
      return { path: key, label: key, type: value.length > 80 || value.includes('\n') ? 'textarea' : 'text' };
    }
    if (Array.isArray(value)) {
      return {
        path: key,
        label: key,
        type: 'array',
        defaultItem: '',
        item: { type: 'text' }
      };
    }
    return { path: key, label: key, type: 'readonly', description: getAppLabel('editNestedJson') };
  });
  return fields.length
    ? { groups: [{ title: getAppLabel('fields'), fields }] }
    : null;
}

function renderInspectorReadonly(context, host = inspectorForm) {
  const card = document.createElement('div');
  card.className = 'inspector-empty';
  card.textContent = context.readonly
    ? getAppLabel('selectionReadOnly')
    : getAppLabel('noFormSchema');
  host.append(card);
}

function renderInspectorForm(form, context, host = inspectorForm) {
  const groups = form.groups || form.sections || [];
  if (!groups.length) {
    renderInspectorReadonly(context, host);
    return;
  }

  groups.forEach((group) => {
    if (!isInspectorVisible(group.visibleWhen, context.target, context)) {
      return;
    }

    const section = document.createElement(group.collapsible ? 'details' : 'section');
    section.className = 'inspector-group';
    if (group.collapsible) {
      section.open = group.open !== false;
    }
    if (group.title) {
      const title = document.createElement(group.collapsible ? 'summary' : 'div');
      title.className = 'inspector-group__title';
      if (group.collapsible) {
        title.classList.add('inspector-group__summary');
      }
      title.textContent = group.title;
      section.append(title);
    }

    (group.fields || []).forEach((field) => {
      const element = renderInspectorField(field, context.target, context);
      if (element) {
        section.append(element);
      }
    });
    host.append(section);
  });
}

function renderInspectorField(field, target, context) {
  if (!isInspectorVisible(field.visibleWhen, target, context)) {
    return null;
  }

  if (field.type === 'array') {
    return renderInspectorArrayField(field, target, context);
  }
  if (field.type === 'repeater') {
    return renderInspectorRepeaterField(field, target, context);
  }
  if (field.type === 'object' || field.type === 'group') {
    return renderInspectorObjectField(field, target, context);
  }
  if (field.type === 'variant' || field.variants) {
    return renderInspectorVariantField(field, target, context);
  }

  if (resolveFormExtensionId(field)) {
    return renderInspectorFormExtensionField(field, target, context);
  }

  const wrapper = document.createElement('label');
  wrapper.className = 'field';
  const label = document.createElement('span');
  label.className = 'field__label';
  label.textContent = `${field.label || field.path || ''}${field.required ? ' *' : ''}`;
  wrapper.append(label);

  const value = getByPath(target, field.path);
  const control = createInspectorControl(field, value, context, target);
  control.addEventListener(getInspectorCommitEvent(field), () => {
    commitInspectorField(field, target, control, context);
  });
  if (isInspectorPendingInputControl(field, control)) {
    control.addEventListener('input', () => {
      markInspectorFieldPending(control, context);
    });
  }
  wrapper.append(control);
  appendFieldMeta(wrapper, field, context);
  return wrapper;
}

function isInspectorPendingInputControl(field, control) {
  if (!control || control.disabled || control.readOnly || field.type === 'readonly') {
    return false;
  }
  if (control.tagName === 'TEXTAREA') {
    return true;
  }
  if (control.tagName !== 'INPUT') {
    return false;
  }
  return !['checkbox', 'radio', 'button', 'submit', 'reset', 'file'].includes(control.type);
}

function markInspectorFieldPending(control, context) {
  state.pendingInspectorControl = control;
  if (!state.file || state.domain?.kind === 'text') {
    return;
  }
  state.dirty = true;
  resetJsonDraftState();
  setStatus(formatAppLabel('dirty', '已修改 - {title}', { title: context.title }));
  updateActionButtons();
}

function createInspectorControl(field, value, context, target) {
  if (field.type === 'readonly') {
    const output = document.createElement('div');
    output.className = 'readonly-field';
    output.textContent = formatValue(value);
    return output;
  }

  if (field.type === 'textarea') {
    const textarea = document.createElement('textarea');
    textarea.value = value ?? '';
    textarea.rows = field.rows || 4;
    textarea.placeholder = field.placeholder || '';
    textarea.required = !!field.required;
    return textarea;
  }

  if (field.type === 'select' || field.type === 'reference') {
    const select = document.createElement('select');
    const options = buildInspectorOptions(field, context, target);
    if (field.emptyLabel !== undefined) {
      const option = document.createElement('option');
      option.value = '';
      option.textContent = field.emptyLabel;
      select.append(option);
    }
    options.forEach((item) => {
      const option = document.createElement('option');
      option.value = String(item.value);
      option.textContent = item.label ?? String(item.value);
      select.append(option);
    });
    select.value = value === undefined || value === null ? '' : String(value);
    select.required = !!field.required;
    return select;
  }

  if (field.type === 'checkbox') {
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = !!value;
    return input;
  }

  const input = document.createElement('input');
  input.type = field.type === 'number' ? 'number' : 'text';
  input.value = value ?? '';
  input.placeholder = field.placeholder || '';
  input.required = !!field.required;
  if (field.min !== undefined) {
    input.min = String(field.min);
  }
  if (field.max !== undefined) {
    input.max = String(field.max);
  }
  if (field.step !== undefined) {
    input.step = String(field.step);
  }
  return input;
}

function renderInspectorFormExtensionField(field, target, context, hooks = {}) {
  const formExtensionId = resolveFormExtensionId(field);
  const formExtension = formRegistry.get(formExtensionId);
  const wrapper = document.createElement('div');
  wrapper.className = 'field field--form-extension';

  const labelText = `${field.label || field.path || formExtensionId}${field.required ? ' *' : ''}`;
  if (labelText) {
    const label = document.createElement('span');
    label.className = 'field__label';
    label.textContent = labelText;
    wrapper.append(label);
  }

  if (!formExtension || typeof formExtension.render !== 'function') {
    const error = document.createElement('div');
    error.className = 'form-extension-error';
    error.textContent = `Form extension "${formExtensionId}" is not registered.`;
    wrapper.append(error);
    appendFieldMeta(wrapper, field, context);
    return wrapper;
  }

  const formContext = createInspectorFormExtensionContext(field, target, context, formExtensionId, hooks);
  try {
    const rendered = formExtension.render(formContext, field, formContext.value, formContext.setValue);
    appendFormExtensionResult(wrapper, rendered);
  } catch (error) {
    const errorBox = document.createElement('div');
    errorBox.className = 'form-extension-error';
    errorBox.textContent = error?.message || `Form extension "${formExtensionId}" failed to render.`;
    wrapper.append(errorBox);
  }
  appendFieldMeta(wrapper, field, context);
  return wrapper;
}

function createInspectorFormExtensionContext(field, target, context, formExtensionId, hooks = {}) {
  const commit = (nextValue, options = {}) => {
    const previous = getByPath(target, field.path);
    const value = typeof nextValue === 'function' ? nextValue(previous) : nextValue;
    if (JSON.stringify(previous ?? null) === JSON.stringify(value ?? null)) {
      return false;
    }
    pushHistory(hooks.historyLabel || `Edit ${field.path || formExtensionId}`);
    if ((value === '' || value === null || value === undefined) && shouldClearInspectorField(field)) {
      deleteByPath(target, field.path);
    } else {
      setByPath(target, field.path, value);
    }
    if (typeof hooks.afterValueChange === 'function') {
      hooks.afterValueChange(value, previous);
    }
    const forceRefresh = options.refresh !== false;
    afterInspectorEdit(context, { ...field, refresh: forceRefresh || field.refresh }, forceRefresh);
    return true;
  };

  const formContext = {
    app: state.app,
    domain: state.domain,
    field,
    target,
    context,
    formExtensionId,
    get value() {
      return getByPath(target, field.path);
    },
    getByPath,
    setByPath,
    deleteByPath,
    getOptions(sourceField = field) {
      return buildInspectorOptions(sourceField, context, target);
    },
    selectPath(pathText) {
      state.selectedKey = pathText || '';
      state.selectedEdge = null;
      resetJsonDraftState();
      render();
    },
    pushHistory,
    markDirty(label) {
      afterInspectorEdit(context, { ...field, refresh: true }, true);
      setStatus(label || formatAppLabel('dirty', '已修改 - {title}', { title: context.title }));
    },
    render,
    renderInspector,
    setValue: commit,
    onChange: commit,
    commit
  };
  return addFormContextCompatibilityAliases(formContext, formExtensionId);
}

function getCollectionListLayouts(collection) {
  return collection.list || collection.layouts || readLegacyCollectionListLayouts(collection);
}

function readLegacyCollectionListLayouts(collection) {
  return collection.views;
}

function addFormContextCompatibilityAliases(context, formExtensionId) {
  context.widgetId = formExtensionId;
  return context;
}

function appendFormExtensionResult(wrapper, rendered) {
  if (rendered === undefined || rendered === null) {
    return;
  }
  const element = rendered?.element || rendered;
  if (element instanceof Node) {
    wrapper.append(element);
    return;
  }
  if (Array.isArray(element)) {
    element.forEach((item) => appendFormExtensionResult(wrapper, item));
    return;
  }
  const text = document.createElement('div');
  text.className = 'readonly-field';
  text.textContent = String(element);
  wrapper.append(text);
}

function renderInspectorArrayField(field, target, context) {
  const host = document.createElement('div');
  host.className = 'field field--array';
  host.append(createInspectorBlockLabel(field.label || field.path || getAppLabel('items')));
  const rows = ensureArray(getByPath(target, field.path));
  const list = document.createElement('div');
  list.className = 'array-list';

  rows.forEach((item, index) => {
    const row = document.createElement('div');
    row.className = 'array-row';
    const itemField = {
      ...(field.item || { type: 'text' }),
      label: `${field.itemLabel || getAppLabel('item')} ${index + 1}`,
      path: ''
    };
    const itemTarget = { value: item };
    itemField.path = 'value';
    if (resolveFormExtensionId(itemField)) {
      const itemPath = field.path ? `${field.path}[${index}]` : `[${index}]`;
      const formExtension = renderInspectorFormExtensionField(itemField, itemTarget, {
        ...context,
        parent: target,
        targetPath: joinPath(context.targetPath, itemPath)
      }, {
        historyLabel: `Edit ${itemPath}`,
        afterValueChange() {
          rows[index] = itemTarget.value;
          setByPath(target, field.path, rows);
        }
      });
      row.append(formExtension);
    } else {
      const control = createInspectorControl(itemField, item, context, target);
      control.addEventListener(getInspectorCommitEvent(itemField), () => {
        pushHistory(`Edit ${field.path}[${index}]`);
        rows[index] = readInspectorControlValue(itemField, control);
        setByPath(target, field.path, rows);
        afterInspectorEdit(context, field);
      });
      row.append(control);
    }
    const actions = document.createElement('div');
    actions.className = 'array-row__actions';
    actions.append(createInspectorSmallButton(getAppLabel('up'), () => {
      if (index <= 0) {
        return;
      }
      pushHistory(`Move ${field.path}`);
      [rows[index - 1], rows[index]] = [rows[index], rows[index - 1]];
      setByPath(target, field.path, rows);
      afterInspectorEdit(context, field, true);
    }, 'ghost'));
    actions.append(createInspectorSmallButton(getAppLabel('down'), () => {
      if (index >= rows.length - 1) {
        return;
      }
      pushHistory(`Move ${field.path}`);
      [rows[index + 1], rows[index]] = [rows[index], rows[index + 1]];
      setByPath(target, field.path, rows);
      afterInspectorEdit(context, field, true);
    }, 'ghost'));
    actions.append(createInspectorSmallButton(field.removeLabel || getAppLabel('remove'), () => {
      pushHistory(`Remove ${field.path}[${index}]`);
      rows.splice(index, 1);
      setByPath(target, field.path, rows);
      afterInspectorEdit(context, field, true);
    }, 'danger'));
    row.append(actions);
    list.append(row);
  });

  host.append(list);
  host.append(createInspectorSmallButton(field.addLabel || getAppLabel('add'), () => {
    pushHistory(`Add ${field.path}`);
    rows.push(clone(field.defaultItem ?? ''));
    setByPath(target, field.path, rows);
    afterInspectorEdit(context, field, true);
  }));
  return host;
}

function renderInspectorRepeaterField(field, target, context) {
  const host = document.createElement('div');
  host.className = 'field field--repeater';
  host.append(createInspectorBlockLabel(field.label || field.path || getAppLabel('items')));
  const rows = ensureArray(getByPath(target, field.path));
  const list = document.createElement('div');
  list.className = 'repeater-list';

  rows.forEach((item, index) => {
    const card = document.createElement('div');
    card.className = 'repeater-card';
    const head = document.createElement('div');
    head.className = 'repeater-card__head';
    const title = document.createElement('strong');
    title.textContent = `${field.itemLabel || getAppLabel('item')} ${index + 1}`;
    head.append(title);
    const actions = document.createElement('div');
    actions.className = 'repeater-card__actions';
    actions.append(createInspectorSmallButton(getAppLabel('up'), () => {
      if (index <= 0) {
        return;
      }
      pushHistory(`Move ${field.path}`);
      [rows[index - 1], rows[index]] = [rows[index], rows[index - 1]];
      setByPath(target, field.path, rows);
      afterInspectorEdit(context, field, true);
    }, 'ghost'));
    actions.append(createInspectorSmallButton(getAppLabel('down'), () => {
      if (index >= rows.length - 1) {
        return;
      }
      pushHistory(`Move ${field.path}`);
      [rows[index + 1], rows[index]] = [rows[index], rows[index + 1]];
      setByPath(target, field.path, rows);
      afterInspectorEdit(context, field, true);
    }, 'ghost'));
    actions.append(createInspectorSmallButton(field.removeLabel || getAppLabel('remove'), () => {
      pushHistory(`Remove ${field.path}[${index}]`);
      rows.splice(index, 1);
      setByPath(target, field.path, rows);
      afterInspectorEdit(context, field, true);
    }, 'danger'));
    head.append(actions);
    card.append(head);

    (field.fields || []).forEach((childField) => {
      const childContext = { ...context, parent: target, repeater: field, index };
      const element = renderInspectorField(childField, item, childContext);
      if (element) {
        card.append(element);
      }
    });
    list.append(card);
  });

  host.append(list);
  host.append(createInspectorSmallButton(field.addLabel || getAppLabel('add'), () => {
    pushHistory(`Add ${field.path}`);
    rows.push(clone(field.defaultItem || {}));
    setByPath(target, field.path, rows);
    afterInspectorEdit(context, field, true);
  }));
  return host;
}

function renderInspectorObjectField(field, target, context) {
  const host = document.createElement('div');
  host.className = 'field field--object';
  host.append(createInspectorBlockLabel(field.label || field.path || getAppLabel('object')));
  let value = field.path ? getByPath(target, field.path) : target;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    value = clone(field.defaultItem || field.defaultValue || {});
    if (field.path) {
      setByPath(target, field.path, value);
    }
  }
  const card = document.createElement('div');
  card.className = 'object-card';
  const childContext = {
    ...context,
    parent: target,
    targetPath: joinPath(context.targetPath, field.path)
  };
  (field.fields || []).forEach((childField) => {
    const element = renderInspectorField(childField, value, childContext);
    if (element) {
      card.append(element);
    }
  });
  host.append(card);
  appendFieldMeta(host, field, context);
  return host;
}

function renderInspectorVariantField(field, target, context) {
  const host = document.createElement('div');
  host.className = 'field field--variant';
  host.append(createInspectorBlockLabel(field.label || field.path || getAppLabel('variant')));
  const card = document.createElement('div');
  card.className = 'variant-card';
  const discriminator = field.discriminator || field.kindPath || 'kind';
  const variants = field.variants || {};
  const options = Object.entries(variants).map(([value, config]) => ({
    value,
    label: config.label || value
  }));
  const selectorField = {
    path: discriminator,
    label: field.discriminatorLabel || 'Type',
    type: 'select',
    clear: false,
    refresh: true,
    options
  };
  const selector = renderInspectorField(selectorField, target, context);
  if (selector) {
    card.append(selector);
  }
  const selected = String(getByPath(target, discriminator) ?? options[0]?.value ?? '');
  const variant = variants[selected] || variants[options[0]?.value] || {};
  (variant.fields || []).forEach((childField) => {
    const element = renderInspectorField(childField, target, context);
    if (element) {
      card.append(element);
    }
  });
  host.append(card);
  appendFieldMeta(host, field, context);
  return host;
}

function createInspectorBlockLabel(text) {
  const label = document.createElement('div');
  label.className = 'field__label';
  label.textContent = text;
  return label;
}

function appendFieldMeta(wrapper, field, context) {
  if (field.description || field.hint) {
    const hint = document.createElement('div');
    hint.className = 'field__hint';
    hint.textContent = field.description || field.hint;
    wrapper.append(hint);
  }
  const errors = getFieldDiagnostics(joinPath(context.targetPath, field.path));
  if (errors.length) {
    wrapper.classList.add('is-invalid');
    errors.forEach((item) => {
      const error = document.createElement('div');
      error.className = 'field__error';
      error.textContent = item.message;
      wrapper.append(error);
    });
  }
}

function getFieldDiagnostics(pathText) {
  if (!pathText) {
    return [];
  }
  return validateCurrent().filter((item) => item.path === pathText);
}

function joinPath(base, child) {
  if (!child) {
    return base || '';
  }
  if (!base) {
    return child;
  }
  return child.startsWith('[') ? `${base}${child}` : `${base}.${child}`;
}

function createInspectorSmallButton(text, onClick, tone = '') {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `small-button${tone ? ` small-button--${tone}` : ''}`;
  button.textContent = text;
  button.addEventListener('click', onClick);
  return button;
}

function commitInspectorField(field, target, control, context) {
  if (field.type === 'readonly') {
    return;
  }

  const value = readInspectorControlValue(field, control);
  const previous = getByPath(target, field.path);
  if (state.pendingInspectorControl === control) {
    state.pendingInspectorControl = null;
  }
  if (JSON.stringify(previous ?? null) === JSON.stringify(value ?? null)) {
    return;
  }
  pushHistory(`Edit ${field.path}`);
  if ((value === '' || value === null || value === undefined) && shouldClearInspectorField(field)) {
    deleteByPath(target, field.path);
  } else {
    setByPath(target, field.path, value);
  }
  afterInspectorEdit(context, field);
}

function readInspectorControlValue(field, control) {
  if (field.type === 'checkbox') {
    return !!control.checked;
  }
  const value = control.value;
  if (value === '' && shouldClearInspectorField(field)) {
    return undefined;
  }
  if (field.value === 'int' || field.valueType === 'int') {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  if (field.value === 'number' || field.valueType === 'number' || field.type === 'number') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return value;
}

function shouldClearInspectorField(field) {
  if (field.clear === false) {
    return false;
  }
  return field.clear === true || field.type === 'select' || field.type === 'number';
}

function afterInspectorEdit(context, field, forceRefresh = false) {
  state.dirty = true;
  resetJsonDraftState();
  setStatus(formatAppLabel('dirty', '已修改 - {title}', { title: context.title }));
  renderDiagnostics();
  if (state.domain.kind === 'graph') {
    renderGraph();
  } else {
    render();
  }
  if (forceRefresh || field.refresh) {
    renderInspector();
  }
  updateActionButtons();
}

function getInspectorCommitEvent(field) {
  if (field.type === 'select' || field.type === 'checkbox') {
    return 'change';
  }
  return 'change';
}

function buildInspectorOptions(field, context, target) {
  if (Array.isArray(field.options)) {
    return field.options;
  }

  const refName = resolveInspectorReferenceName(field, context, target) || field.ref || field.optionsFrom;
  const refConfig = refName ? state.domain.refs?.[refName] : null;
  if (refConfig) {
    return buildReferenceOptions(refConfig, field);
  }

  if (field.optionsFrom === 'nodes') {
    const graph = context.graph || buildGraphModel();
    return graph.nodes
      .filter((node) => node.collection === graph.baseCollection)
      .map((node) => ({
        value: node.id,
        label: `#${node.id} ${node.title || ''} ${truncateInspectorText(node.text || '', 28)}`
      }));
  }

  if (field.optionsFrom === 'options') {
    const graph = context.graph || buildGraphModel();
    return graph.nodes
      .filter((node) => node.collection !== graph.baseCollection)
      .map((node) => ({
        value: node.id,
        label: `#${node.id} ${truncateInspectorText(node.text || '', 32)}`
      }));
  }

  if (field.optionsFrom === 'actors') {
    return getInspectorActors().map((actor) => ({
      value: actor.actorId ?? actor.id ?? actor.key ?? actor.name,
      label: actor.name || actor.actorId || actor.id || actor.key
    }));
  }

  if (field.optionsFrom === 'faces') {
    const actorId = getByPath(target, field.actorPath || 'actorId');
    const actor = getInspectorActors().find((item) => (
      item.actorId === actorId || item.id === actorId || item.key === actorId || item.name === actorId
    ));
    return ensureArray(actor?.faces).map((face) => ({ value: face, label: face }));
  }

  if (field.optionsFrom) {
    const rows = ensureArray(getByPath(state.data, field.optionsFrom));
    return rows.map((item) => ({
      value: item?.[field.optionValue || 'id'] ?? item,
      label: item?.[field.optionLabel || 'name'] ?? item?.[field.optionValue || 'id'] ?? item
    }));
  }

  return [];
}

function resolveInspectorReferenceName(field, context, target) {
  const sourcePath = field.refFromPath || field.refPath;
  const parentPath = field.refFromParentPath || field.parentRefPath;
  let value = '';
  if (parentPath) {
    value = getByPath(context.parent || {}, parentPath);
  } else if (sourcePath) {
    value = getByPath(target, sourcePath);
  }
  if (value === undefined || value === null || value === '') {
    return '';
  }
  const key = String(value);
  return field.refMap?.[key] || key;
}

function buildReferenceOptions(refConfig, field = {}) {
  const rows = ensureArray(getByPath(state.data, refConfig.path || refConfig.rows || field.optionsFrom));
  const valuePath = refConfig.value || refConfig.valuePath || field.optionValue || 'id';
  const labelPath = refConfig.label || refConfig.labelPath || field.optionLabel || 'name';
  return rows.map((item) => {
    const value = item && typeof item === 'object' ? getByPath(item, valuePath) : item;
    const label = formatReferenceLabel(item, refConfig, value, labelPath);
    return { value, label };
  });
}

function formatReferenceLabel(item, refConfig, value, labelPath) {
  if (!item || typeof item !== 'object') {
    return String(value ?? '');
  }
  if (refConfig.labelTemplate) {
    return String(refConfig.labelTemplate).replace(/\{([^}]+)\}/g, (_, key) => {
      return getByPath(item, key.trim()) ?? '';
    });
  }
  const label = getByPath(item, labelPath);
  if (label !== undefined && label !== null && label !== '') {
    return String(label);
  }
  return String(value ?? '');
}

function getInspectorActors() {
  return ensureArray(getByPath(state.data, state.domain?.graph?.actors || 'meta.actors'));
}

function isInspectorVisible(rule, target, context) {
  if (!rule) {
    return true;
  }
  const actual = getByPath(target, rule.path || '');
  if (Object.prototype.hasOwnProperty.call(rule, 'equals')) {
    return String(actual) === String(rule.equals);
  }
  if (Array.isArray(rule.oneOf)) {
    return rule.oneOf.map(String).includes(String(actual));
  }
  if (Object.prototype.hasOwnProperty.call(rule, 'notEquals')) {
    return String(actual) !== String(rule.notEquals);
  }
  if (rule.exists) {
    return actual !== undefined && actual !== null && actual !== '';
  }
  if (rule.collection) {
    return context.collection === rule.collection;
  }
  return true;
}

function truncateInspectorText(value, maxLength) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength)}...`;
}
