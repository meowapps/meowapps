#!/usr/bin/env node
import { execSync } from 'child_process'
import fs from 'fs'

assertCleanTree()

const TEMPLATE = 'https://github.com/meowapps/meowapps-template.git'

const lock = JSON.parse(fs.readFileSync('package-lock.json', 'utf8'))
const resolved = lock.packages?.['node_modules/meowapps']?.resolved || ''
const meowappsSha = resolved.match(/#(\w+)$/)?.[1] || ''

// Fetch template history — objects become available locally via FETCH_HEAD
execSync(`git fetch ${TEMPLATE}`, { stdio: 'pipe' })
const latestSha = execSync('git rev-parse FETCH_HEAD', { encoding: 'utf8' }).trim()

let baseSha = ''
if (meowappsSha) {
  try {
    baseSha = execSync(`git log FETCH_HEAD --grep="meowapps@${meowappsSha.slice(0, 7)}" --format="%H" -1`, { encoding: 'utf8' }).trim()
  } catch {}
}

if (baseSha === latestSha) {
  console.log('Already up to date.')
  process.exit(0)
}

// Apply template diff with native 3-way merge
const from = baseSha || execSync('git mktree < /dev/null', { encoding: 'utf8' }).trim()
try {
  execSync(`git diff ${from} ${latestSha} -- ':!package-lock.json' | git apply --3way --allow-empty`, { stdio: 'inherit' })
} catch {
  // git apply --3way exits non-zero on conflicts but still writes markers
}

// Reinstall dependencies
const pkgConflict = fs.readFileSync('package.json', 'utf8').includes('<<<<<<<')
if (pkgConflict) {
  console.log('Resolve package.json conflicts, then npm i.')
} else {
  for (const p of ['node_modules', 'package-lock.json', 'dist']) fs.rmSync(p, { recursive: true, force: true })
  execSync('npm i', { stdio: 'pipe' })
  console.log('Upgraded to latest.')
}

// --- functions ---

function assertCleanTree() {
  const status = execSync('git status --porcelain', { encoding: 'utf8' }).trim()
  if (status) {
    console.error('Working tree is not clean. Commit all changes before upgrading.')
    process.exit(1)
  }
}
