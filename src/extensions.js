const path = require('path');

const RESERVED_API_PREFIXES = ['/api/app', '/api/domains', '/api/extensions'];

function createFweExtensionRegistry() {
  const annotations = new Map();
  const views = new Map();
  const sources = new Map();
  const apis = [];

  function registerAnnotation(name, handler = {}) {
    const key = normalizeAnnotationName(name);
    if (!key) {
      throw new Error(`Invalid annotation name: ${name}`);
    }
    annotations.set(key, normalizeAnnotationHandler(handler));
    return api;
  }

  function registerView(name, handler = {}) {
    const key = normalizeExtensionName(name);
    if (!key) {
      throw new Error(`Invalid view name: ${name}`);
    }
    views.set(key, normalizeViewHandler(handler));
    return api;
  }

  function registerSource(name, handler = {}) {
    const key = normalizeExtensionName(name);
    if (!key) {
      throw new Error(`Invalid source name: ${name}`);
    }
    sources.set(key, normalizeSourceHandler(handler));
    return api;
  }

  function registerApi(prefix, handler) {
    const normalizedPrefix = normalizeApiPrefix(prefix);
    if (!normalizedPrefix) {
      throw new Error(`Invalid API prefix: ${prefix}`);
    }
    if (typeof handler !== 'function') {
      throw new Error(`API handler for "${normalizedPrefix}" must be a function.`);
    }
    if (apis.some((entry) => entry.prefix === normalizedPrefix)) {
      throw new Error(`API prefix is already registered: ${normalizedPrefix}`);
    }
    apis.push({ prefix: normalizedPrefix, handler });
    apis.sort((left, right) => right.prefix.length - left.prefix.length);
    return api;
  }

  const api = {
    annotation: registerAnnotation,
    registerAnnotation,
    view: registerView,
    registerView,
    source: registerSource,
    registerSource,
    api: registerApi,
    registerApi
  };
  installExtensionCompatibilityAliases(api, registerView);

  return {
    api,
    registerAnnotation,
    hasAnnotation(name) {
      return annotations.has(normalizeExtensionName(name));
    },
    hasView(name) {
      return views.has(normalizeExtensionName(name));
    },
    hasSurface(name) {
      return views.has(normalizeExtensionName(name));
    },
    hasSource(name) {
      return sources.has(normalizeExtensionName(name));
    },
    getSource(name) {
      return sources.get(normalizeExtensionName(name)) || null;
    },
    async handleApi(payload) {
      const pathname = String(payload?.url?.pathname || '');
      for (const entry of apis) {
        if (pathname !== entry.prefix && !pathname.startsWith(`${entry.prefix}/`)) {
          continue;
        }
        const handled = await entry.handler(payload);
        if (handled !== false) {
          return true;
        }
      }
      return false;
    },
    compileView(payload) {
      const view = readExtensionViewPayload(payload);
      const handler = views.get(normalizeExtensionName(view?.type));
      const fn = resolveViewCompileHook(handler);
      if (typeof fn !== 'function') {
        return null;
      }
      return fn(addExtensionCompileCompatibilityAliases({ ...payload, view }, view));
    },
    compileSurface(payload) {
      return this.compileView(payload);
    },
    applyFieldFormAnnotations(payload) {
      return applyAnnotationHook(annotations, 'form', payload);
    },
    compileFieldValidationRules(payload) {
      return applyAnnotationHook(annotations, 'validate', payload, []);
    }
  };
}

function installExtensionCompatibilityAliases(api, registerView) {
  api.surface = registerView;
  api.registerSurface = registerView;
}

function readExtensionViewPayload(payload) {
  return payload?.view || payload?.surface;
}

function resolveViewCompileHook(handler) {
  return handler?.compile || handler?.view || handler?.surface || handler?.runtime;
}

function addExtensionCompileCompatibilityAliases(payload, view) {
  return { ...payload, surface: payload.surface || view };
}

function loadFweExtensions(entries, appDir) {
  const registry = createFweExtensionRegistry();
  loadFweExtensionsInto(registry, entries, appDir);
  return registry;
}

function loadFweExtensionsInto(registry, entries, appDir) {
  const list = Array.isArray(entries) ? entries : [];
  list.forEach((entry) => {
    const config = typeof entry === 'string' ? { path: entry } : entry || {};
    if (config.runtime === true) {
      return;
    }
    if (!config.path) {
      return;
    }
    const extensionPath = path.resolve(appDir, config.path || '');

    delete require.cache[require.resolve(extensionPath)];
    const loaded = require(extensionPath);
    const setup = loaded?.default || loaded;
    if (typeof setup !== 'function') {
      throw new Error(`fwe extension must export a setup function: ${extensionPath}`);
    }
    setup(registry.api, config.options || {});
  });
  return registry;
}

function normalizeAnnotationName(name) {
  return normalizeExtensionName(name);
}

function normalizeExtensionName(name) {
  const value = String(name || '').trim();
  if (!/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(value)) {
    return '';
  }
  return value;
}

function normalizeApiPrefix(prefix) {
  const value = String(prefix || '').trim().replace(/\/+$/, '');
  if (!/^\/api\/[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/.test(value)) {
    return '';
  }
  if (RESERVED_API_PREFIXES.some((prefix) => value === prefix || value.startsWith(`${prefix}/`))) {
    return '';
  }
  return value;
}

function normalizeViewHandler(handler) {
  if (typeof handler === 'function') {
    return { compile: handler };
  }
  if (!handler || typeof handler !== 'object' || Array.isArray(handler)) {
    return {};
  }
  return handler;
}

function normalizeSourceHandler(handler) {
  if (typeof handler === 'function') {
    return { read: handler };
  }
  if (!handler || typeof handler !== 'object' || Array.isArray(handler)) {
    return {};
  }
  return handler;
}

function normalizeAnnotationHandler(handler) {
  if (typeof handler === 'function') {
    return { form: handler };
  }
  if (!handler || typeof handler !== 'object' || Array.isArray(handler)) {
    return {};
  }
  return handler;
}

function applyAnnotationHook(annotations, hook, payload, emptyValue = {}) {
  let result = Array.isArray(emptyValue) ? [] : {};
  for (const annotation of payload.field?.annotations || []) {
    const handler = annotations.get(normalizeAnnotationName(annotation.name));
    const fn = handler?.[hook];
    if (typeof fn !== 'function') {
      continue;
    }
    const value = fn({ ...payload, annotation });
    if (value === undefined || value === null) {
      continue;
    }
    if (Array.isArray(result)) {
      result = result.concat(Array.isArray(value) ? value : [value]);
    } else {
      result = { ...result, ...value };
    }
  }
  return result;
}

module.exports = {
  createFweExtensionRegistry,
  loadFweExtensions,
  loadFweExtensionsInto
};
