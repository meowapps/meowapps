#!/usr/bin/env node
import { spawn, execSync } from 'child_process'
import fs from 'fs'
import { parse, stringify } from 'smol-toml'
import { builder } from './build.js'

const { dist, handlers, port, tomlPath } = builder.config()

const steps = [
  ['Starting tunnel...', () => tunnel(port)],
  ['Updating shopify.app.toml...', url => updateToml(tomlPath, url)],
  ['Deploying Shopify app config...', () => execSync('shopify app deploy --force', { stdio: 'inherit' })],
  ['Building...', () => execSync(`node ${import.meta.dirname}/build.js`, { stdio: 'inherit' })],
  ['Installing deps in dist...', () => { if (!fs.existsSync(`${dist}/node_modules`)) execSync('npm i', { cwd: dist, stdio: 'inherit' }) }],
  ['Getting SHOPIFY_API_SECRET...', () => getSecret()],
  ['Starting emulators + watching src...', secret => {
    start('npm', ['run', 'dev'], { cwd: dist, stdio: 'inherit', env: { ...process.env, SHOPIFY_API_SECRET: secret } })
    watch(handlers)
  }],
  fs.existsSync('extensions') && ['Starting extensions dev...', () => start('shopify', ['app', 'dev', '--no-update'], { stdio: 'inherit' })],
].filter(Boolean)

let result, children = []
for (let i = 0; i < steps.length; i++) {
  console.log(`\n\x1b[1m[${i + 1}/${steps.length}] ${steps[i][0]}\x1b[0m`)
  result = await steps[i][1](result)
}

// ---------------------------------------------------------------------------

// Spawn cloudflared and resolve once it prints the tunnel URL
function tunnel(port) {
  return new Promise((resolve, reject) => {
    const p = start('cloudflared', ['tunnel', '--url', `http://localhost:${port}`], { stdio: ['ignore', 'pipe', 'pipe'] })
    const onData = chunk => {
      const m = chunk.toString().match(/https:\/\/[^\s]+\.trycloudflare\.com/)
      if (m) { console.log(`Tunnel: ${m[0]}`); resolve(m[0]) }
    }
    p.stdout.on('data', onData)
    p.stderr.on('data', onData)
    p.on('error', reject)
  })
}

// Replace the old tunnel origin in all URL fields, keeping pathnames intact
function updateToml(tomlPath, url) {
  const config = parse(fs.readFileSync(tomlPath, 'utf8'))
  const reurl = u => url + new URL(u).pathname
  config.application_url = reurl(config.application_url)
  config.webhooks.subscriptions.forEach(s => { s.uri = reurl(s.uri) })
  config.auth.redirect_urls = config.auth.redirect_urls.map(reurl)
  fs.writeFileSync(tomlPath, stringify(config))
}

// May prompt for Shopify login if not authenticated
function getSecret() {
  const out = execSync('shopify app env show', { encoding: 'utf8', stdio: ['inherit', 'pipe', 'inherit'] })
  return out.match(/SHOPIFY_API_SECRET=(\S+)/)?.[1] || ''
}

// Rebuild individual files on change — only files matching handler patterns
function watch(handlers) {
  fs.watch('src', (_, f) => {
    if (!f || !handlers.some(h => f.startsWith(h.type + '.') && f.endsWith(h.ext))) return
    console.log(`Changed: src/${f}`)
    execSync(`node ${import.meta.dirname}/build.js src/${f}`, { stdio: 'inherit' })
  })
}

// Managed spawn: tracks child processes and kills them all on SIGINT
function start(...args) {
  const p = spawn(...args)
  children.push(p)
  return p
}
process.on('SIGINT', () => {
  console.log('\nShutting down...')
  children.forEach(p => p.kill())
  Promise.all(children.map(p => new Promise(r => p.on('close', r)))).then(() => process.exit())
})
