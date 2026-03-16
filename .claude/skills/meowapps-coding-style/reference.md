# meowapps coding style rules

Full rules with examples for the meowapps coding style.

## Rules

### 1. Declarative config over imperative setup
Chainable builder APIs. Config reads as declaration.
```js
createBuild().dist(...).env(...).handlers([...]).run(args)
```

### 2. Functions derive paths internally
Receive config object, derive paths inside. Never pass derived paths as separate params.
```js
async function bundleServer(c, routes) {
  const functionsDir = `${c.dist}/functions`
}
```

### 3. Standalone functions
Each function produces complete, usable output. No external follow-up required.

### 4. Function name = what it actually does
If it does more, rename or split.

### 5. Merge functions that always go together
If two functions always pair and one's output only feeds the other, merge them.

### 6. API accepts batch input
Accept arrays instead of being called in loops.

### 7. Don't pass params just for logging
Log what you already have.

### 8. No unnecessary clean/destroy
Don't auto-delete output dirs. Write only if missing: `if (!fs.existsSync(p)) fs.writeFileSync(p, data)`.

### 9. State lives with output
Registry inside `dist/` — `rm dist/` = clean slate.

### 10. File organization follows call flow
Entry → orchestrator → workers → utilities. Read top-down without jumping.

### 11. Comments: "what" before, "why" inside
1-2 lines of "what" before function declaration. Inside, only "why" for non-obvious logic. No comments on self-explanatory code.
```js
// Transform source files to extract meta and HTTP methods,
// then match to handlers by filename convention.
async function scanRoutes(c, files) {
  // Stub require() since we only need meta/methods, not real dependencies
  new Function('exports', 'require', 'module', code)(m.exports, () => ({}), m)
}
```

### 12. Consistent style for same patterns
Same kind of operation → same pattern everywhere.

### 13. Return early, functions below
In components and handlers: state/setup → return → helper functions. Reader sees *what* renders first, *how* it works after.
```jsx
function Index() {
  const [data, setData] = useState(null)
  useEffect(() => { ... }, [])

  return (<s-page>...</s-page>)

  async function loadData() { ... }
  function handleClick() { ... }
}
```

## Conventions

- **Section markers**: `// --- name ---` with horizontal dashes
- **Exports at top**: public API declared first, implementation below
- **Single-letter config**: `c` for config, `r` for route, `h` for handler, `m` for module
- **Import order**: external packages → node built-ins → local
- **Error handling**: try-finally for cleanup, throw on GraphQL errors, silent catch only for optional file reads
- **Async**: Promise.all for parallel work, async/await throughout, no callbacks
- **Conditionals**: optional chaining + nullish coalescing (`?.`, `??`, `??=`), ternary for simple, guard clauses for early returns
- **Object.freeze** for enums
- **No class components** — functional React only, hooks
- **Inline styles** preferred over CSS files
- **Template literals** for interpolation, array join for multi-line code generation
