# Contributing

fwe has no required runtime dependencies. Keep changes small, dependency-free when practical, and compatible with Node.js 18 or newer.

Before submitting a change, run:

```powershell
npm test
npm run pack:dry
```

For browser-facing changes, also start the example app and check at least `settings`, `items`, `flow`, and `blueprint`:

```powershell
npm start
```

Public config names should stay canonical: `source`, `model`, `view`, `form`, `modes`, `layout`, and `list`.
