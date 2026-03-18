#!/usr/bin/env node
import Conf from 'conf'
import esbuild from 'esbuild'
import { parse } from 'smol-toml'
import fs from 'fs'
import path from 'path'
import { METHODS } from 'node:http'
import { pathToFileURL } from 'url'

// Exported so other scripts (dev.js) can query config like handlers and port
export const builder = createBuild()
  .dist('dist')
  .env(getConfigFile())
  .handlers([
    { prefix: '/', type: 'page', ext: '.jsx' },
    { prefix: '/app', type: 'app', ext: '.jsx', headScripts: ['https://cdn.shopify.com/shopifycloud/app-bridge.js', 'https://cdn.shopify.com/shopifycloud/polaris.js'] },
    { prefix: '/api', type: 'api', ext: '.js' },
  ])
  .firebase({
    node: '22',
    deps: { 'express': '^5.2.1', 'firebase-admin': '^13.7.0', 'firebase-functions': '^7.1.0' },
    root: { 'firebase-tools': '^15.9.0' },
  })
  .port(getWebPort())

// Skip when imported by other scripts (e.g. dev.js), realpathSync resolves bin symlinks
if (import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) builder.run(process.argv.slice(2))

// ---------------------------------------------------------------------------

// Builder with chainable config.
// Resolves each target: directory/wildcard spawn child processes per file,
// plain file builds directly with all registered files.
function createBuild() {
  const c = { dist: null, env: {}, handlers: [], fb: null, port: null }

  return {
    dist(v) { c.dist = v; return this },
    env(configFile) {
      // Parse shopify TOML at config time, extract env vars needed by client and server
      const config = parse(fs.readFileSync(configFile, 'utf8'))
      c.env = {
        SHOPIFY_API_KEY: config.client_id || '',
        SHOPIFY_SCOPES: config.access_scopes?.scopes || '',
        SHOPIFY_HOST_NAME: process.env.HOST ? new URL(process.env.HOST).hostname : (config.application_url ? new URL(config.application_url).hostname : ''),
      }
      return this
    },
    handlers(v) { c.handlers = v; return this },
    firebase(v) { c.fb = v; return this },
    port(v) { c.port = v; return this },
    config() { return c },
    async run(targets) {
      // Package defaults first, user src second — last seen basename wins
      if (!targets.length) targets = [path.resolve(import.meta.dirname, '../src'), 'src']

      // Resolve targets to absolute file paths, dedup by basename — last seen wins
      const all = []
      for (const t of targets) {
        const abs = path.resolve(t)

        if (t.includes('*')) {
          // Wildcard: convert glob to regex, collect matched files
          const dir = path.resolve(path.dirname(t))
          const re = new RegExp('^' + path.basename(t).replaceAll('.', '\\.').replaceAll('*', '.*') + '$')
          all.push(...fs.readdirSync(dir).filter(f => re.test(f)).map(f => path.join(dir, f)))
        } else if (fs.existsSync(abs) && fs.statSync(abs).isDirectory()) {
          // Directory: collect files matching handler patterns
          const dirFiles = fs.readdirSync(abs)
          for (const h of c.handlers)
            all.push(...dirFiles.filter(f => f.startsWith(h.type + '.') && !f.startsWith(h.type + '._') && f.endsWith(h.ext)).map(f => path.join(abs, f)))
        } else if (fs.existsSync(abs)) {
          all.push(abs)
        } else {
          console.warn(`Not found: ${t}`)
        }
      }
      const files = [...new Map(all.map(f => [path.basename(f), f])).values()]

      if (!files.length) return
      // Register all resolved files, then build once with full registry
      await buildAll(c, registry(c, files))
      for (const f of files) console.log(`Built ${path.basename(f)}`)
    },
  }
}

// --- build -----------------------------------------------------------------

// Scan all registered files, then bundle client and server in parallel.
async function buildAll(c, files) {
  const { routes, layouts } = await scanFiles(c, files)

  await Promise.all([
    bundleClient(c, { routes, layouts }),
    bundleServer(c, { routes }),
  ])
}

// --- scan ------------------------------------------------------------------

// Scan source files to extract routes with server paths and layout map per handler type.
async function scanFiles(c, files) {
  const scanned = Object.fromEntries(await Promise.all(files.map(async f => {
    const ext = path.extname(f)
    // Transform to CJS so we can evaluate exports without importing the module
    const { code } = await esbuild.transform(fs.readFileSync(f, 'utf8'), { loader: ext === '.jsx' ? 'jsx' : 'js', format: 'cjs' })
    const m = { exports: {} }
    // Stub require() since we only need meta/methods, not real dependencies
    new Function('exports', 'require', 'module', code)(m.exports, () => ({}), m)
    return [f, { meta: m.exports.meta || {}, methods: METHODS.filter(v => typeof m.exports[v] === 'function') }]
  })))

  const routes = c.handlers.flatMap(h =>
    files.filter(f => {
      const b = path.basename(f)
      // Skip _layout and other underscore-prefixed files (non-route convention)
      return b.startsWith(h.type + '.') && b.endsWith(h.ext) && !b.startsWith(h.type + '._')
    }).map(f => {
      // Derive route name from filename: app.settings.jsx → "settings", app.auth.callback.jsx → "auth/callback"
      const b = path.basename(f)
      const name = b.slice(h.type.length + 1, -h.ext.length).replaceAll('.', '/')
      const isIdx = name === 'index'
      const url = isIdx ? h.prefix : h.prefix === '/' ? `/${name}` : `${h.prefix}/${name}`
      const base = url === '/' ? '/index' : url
      const serverPaths = scanned[f].methods.map(m => ({
        method: m,
        path: h.type === 'api' ? url : m === 'GET' ? `${base}.json` : `${base}.rpc`,
      }))
      return { file: f, name, url, handler: h, ...scanned[f], serverPaths }
    })
  )

  const layouts = Object.fromEntries(
    c.handlers.filter(h => h.type !== 'api').map(h => {
      const dirs = [...new Set(files.filter(f => path.basename(f).startsWith(h.type + '.')).map(f => path.dirname(f)))]
      const layout = dirs.reverse().map(d => path.join(d, `${h.type}._layout${h.ext}`)).find(p => fs.existsSync(p)) || null
      return [h.type, layout]
    })
  )

  return { routes, layouts }
}

// --- client ----------------------------------------------------------------

// Bundle non-api routes into SPA entries with lazy-loaded pages, then write HTML shells.
async function bundleClient(c, { routes, layouts }) {
  const groups = Object.groupBy(routes.filter(r => r.handler.type !== 'api'), r => r.handler.type)
  if (!Object.keys(groups).length) return

  const hostingDir = `${c.dist}/hosting`
  const assetsDir = `${hostingDir}/assets`
  fs.mkdirSync(assetsDir, { recursive: true })

  const plugin = {
    name: 'entry',
    setup(b) {
      // Strip server-only exports from 'use server' files to avoid bundling server code in client
      b.onLoad({ filter: /\.(js|jsx)$/, namespace: 'file' }, async args => {
        const txt = fs.readFileSync(args.path, 'utf8')
        if (!txt.startsWith("'use server'")) return null
        const r = await esbuild.build({ entryPoints: [args.path], metafile: true, write: false, format: 'esm', bundle: false, loader: { '.jsx': 'jsx', '.js': 'js' } })
        return { contents: Object.values(r.metafile.outputs)[0].exports.map(n => `export const ${n} = undefined`).join('\n'), loader: 'js' }
      })
      // Lazy imports: re-export default from the actual file for code-splitting
      b.onResolve({ filter: /^lazy:/ }, a => ({ path: a.path.slice(5), namespace: 'lazy' }))
      b.onLoad({ filter: /.*/, namespace: 'lazy' }, a => ({
        contents: `export { default } from '${a.path}'`, loader: 'js', resolveDir: path.dirname(a.path),
      }))
      // Virtual entries: generate SPA router code with lazy route map
      b.onResolve({ filter: /^virtual:/ }, a => ({ path: a.path, namespace: 'virtual' }))
      b.onLoad({ filter: /.*/, namespace: 'virtual' }, a => {
        const type = a.path.slice(8)
        const rs = groups[type]
        const entries = rs.map(r => `  '${r.url}': () => import('lazy:${r.file}')`).join(',\n')
        const layoutFile = layouts[type]
        const layoutImport = layoutFile ? `import Layout from '${layoutFile}'` : ''
        const wrap = layoutFile ? 'root.render(<Layout><Page/></Layout>)' : 'root.render(<Page/>)'
        return {
          loader: 'jsx', resolveDir: process.cwd(),
          contents: `
            import { createRoot } from 'react-dom/client'
            ${layoutImport}
            const routes = {\n${entries}\n}
            const root = createRoot(document.getElementById('root'))
            function nav(url) {
              if (url.length > 1 && url.endsWith('/')) url = url.slice(0, -1)
              routes[url]?.().then(m => { const Page = m.default; if (Page) ${wrap} })
            }
            nav(location.pathname)
            document.addEventListener('click', e => { const a = e.target.closest('a, s-link'); const href = a?.pathname || a?.getAttribute('href'); if (a && href && routes[href]) { e.preventDefault(); history.pushState(null, '', href + location.search); nav(href) } })
            window.addEventListener('popstate', () => nav(location.pathname))`,
        }
      })
    },
  }

  const ep = Object.fromEntries(Object.keys(groups).map(t => [`${t}.entry`, `virtual:${t}`]))
  const r = await esbuild.build({
    entryPoints: ep, bundle: true, format: 'esm', jsx: 'automatic',
    splitting: true, minify: true, outdir: assetsDir, entryNames: '[hash]', chunkNames: '[hash]', metafile: true, plugins: [plugin],
  })

  // Map virtual entry names back to handler types for HTML generation
  const entryMap = Object.fromEntries(Object.entries(r.metafile.outputs)
    .map(([out, { entryPoint }]) => [entryPoint?.match(/^virtual:virtual:(.+)/)?.[1], path.basename(out)])
    .filter(([k]) => k))

  // Write HTML shells linking to hashed entry files
  for (const r of routes.filter(r => r.handler.type !== 'api')) {
    const { meta = {}, handler: h } = r
    const scripts = (h.headScripts || []).map(s => `\n    <script src="${s}"></script>`).join('')
    const subdir = h.prefix === '/' ? '' : h.prefix.slice(1) + '/'
    const htmlPath = `${hostingDir}/${subdir}${r.name === 'index' ? 'index' : r.name}.html`
    fs.mkdirSync(path.dirname(htmlPath), { recursive: true })
    fs.writeFileSync(htmlPath, `<!DOCTYPE html>
<html lang="en"><head>
  <meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${meta.title || 'App'}</title>${meta.description ? `\n  <meta name="description" content="${meta.description}">` : ''}${h.type === 'app' ? `\n  <meta name="robots" content="noindex">` : ''}${c.env.SHOPIFY_API_KEY && h.type === 'app' ? `\n  <meta name="shopify-api-key" content="${c.env.SHOPIFY_API_KEY}" />` : ''}${h.type === 'page' ? `\n  <script>if(self!==top)location.replace('/app'+location.search)</script>` : ''}${scripts}
</head><body>
  <div id="root"></div>
  <script type="module" src="/assets/${entryMap[h.type]}"></script>
</body></html>`)
  }
}

// --- server ----------------------------------------------------------------

// Generate Express entry point from routes, then write Firebase project files.
async function bundleServer(c, { routes }) {
  const functionsDir = `${c.dist}/functions`
  fs.mkdirSync(functionsDir, { recursive: true })

  const groups = {}
  routes.forEach((r, i) => {
    if (!r.serverPaths.length) return
    const g = groups[r.handler.type] ??= { imports: [], handlers: [] }
    // Alias each method import with index suffix to avoid name collisions across routes
    g.imports.push(`import { ${r.serverPaths.map(s => `${s.method} as ${s.method}${i}`).join(', ')} } from '${r.file}'`)
    r.serverPaths.forEach(s => {
      g.handlers.push(`${r.handler.type}App.${s.method.toLowerCase()}('${s.path}', ${s.method}${i})`)
    })
  })

  if (Object.keys(groups).length) {
    const src = [
      `import express from 'express'`, `import { onRequest } from 'firebase-functions/v2/https'`,
      ...Object.values(groups).flatMap(g => g.imports),
      ...Object.entries(groups).map(([t, g]) =>
        `const ${t}App = express(); ${t}App.use(express.json()); ${g.handlers.join('; ')}; export const ${t} = onRequest(${t}App)`),
    ].join('\n')

    // Inline env vars from TOML at build time so server doesn't need .env file
    const define = Object.fromEntries(
      Object.entries(c.env).map(([k, v]) => [`process.env.${k}`, JSON.stringify(v)])
    )

    await esbuild.build({
      stdin: { contents: src, loader: 'js', resolveDir: '/' },
      bundle: true, format: 'cjs', platform: 'node', outfile: `${functionsDir}/index.js`, external: Object.keys(c.fb.deps), define,
    })
  }

  // Write project files only if missing, so incremental builds don't overwrite user edits
  if (!c.fb) return
  const w = (p, data) => { if (!fs.existsSync(p)) { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, typeof data === 'string' ? data : JSON.stringify(data, null, 2)) } }

  w(`${functionsDir}/package.json`, {
    name: 'functions', private: true, main: 'index.js',
    engines: { node: c.fb.node }, dependencies: c.fb.deps,
  })

  const rc = `${c.dist}/.firebaserc`
  if (!fs.existsSync(rc) && fs.existsSync('.firebaserc')) fs.copyFileSync('.firebaserc', rc)

  // Longer prefixes first so Firebase matches specific routes before catch-all.
  // Non-api prefixes need .json (data) and .rpc (mutations) rewrites in addition to /prefix/**.
  const rewrites = c.handlers.toSorted((a, b) => b.prefix.length - a.prefix.length)
    .flatMap(h => [
      h.prefix !== '/' && h.type !== 'api' && { source: `${h.prefix}.json`, function: h.type },
      h.prefix !== '/' && h.type !== 'api' && { source: `${h.prefix}.rpc`, function: h.type },
      { source: h.prefix === '/' ? '**' : `${h.prefix}/**`, function: h.type },
    ].filter(Boolean))
  w(`${c.dist}/firebase.json`, {
    hosting: { public: 'hosting', ignore: ['firebase.json', '**/node_modules/**'], cleanUrls: true, trailingSlash: false, rewrites },
    functions: { source: 'functions', runtime: `nodejs${c.fb.node}` },
    firestore: { rules: 'firestore.rules' },
    emulators: { hosting: { port: c.port }, functions: { port: c.port + 1 }, firestore: { port: c.port + 2 } },
  })

  w(`${c.dist}/firestore.rules`, 'rules_version = \'2\';\nservice cloud.firestore {\n  match /databases/{database}/documents {\n    match /{document=**} {\n      allow read, write: if true;\n    }\n  }\n}\n')

  w(`${c.dist}/package.json`, {
    private: true,
    scripts: { postinstall: 'cd functions && npm install', dev: 'firebase emulators:start --project demo-meowapps', deploy: 'firebase deploy' },
    dependencies: c.fb.root,
  })
}

// --- registry --------------------------------------------------------------

// Tracks which files have been built. Stored in dist/ so deleting dist resets state.
// Filters out deleted files on load. Pass `add` to append a new file and persist.
function registry(c, adds) {
  const p = `${c.dist}/.build-registry.json`
  let reg = []
  try { reg = JSON.parse(fs.readFileSync(p, 'utf8')).filter(f => fs.existsSync(f)) } catch { }
  if (adds) {
    for (const f of adds) if (!reg.includes(f)) reg.push(f)
    fs.mkdirSync(c.dist, { recursive: true })
    fs.writeFileSync(p, JSON.stringify(reg))
  }
  return reg
}

// Resolve Shopify app config file from CLI cache
function getConfigFile() {
  const cached = new Conf({ projectName: 'shopify-cli-app' }).get(process.cwd())
  return cached?.configFile ?? 'shopify.app.toml'
}

// Read port from shopify.web.toml
function getWebPort() {
  return parse(fs.readFileSync('shopify.web.toml', 'utf8')).port
}
