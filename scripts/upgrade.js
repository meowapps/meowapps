#!/usr/bin/env node
import { execSync } from 'child_process'
import fs from 'fs'
import path from 'path'

// Abort if working tree has unstaged or untracked changes
try { execSync('git diff --quiet', { stdio: 'pipe' }) } catch { console.error('Unstaged changes found. Commit or stash before upgrading.'); process.exit(1) }
const untracked = execSync('git ls-files --others --exclude-standard', { encoding: 'utf8' }).trim()
if (untracked) { console.error('Untracked files found. Commit or stash before upgrading.'); process.exit(1) }

const TEMPLATE = 'https://github.com/meowapps/meowapps-template.git'
const MEOWAPPS = 'github:meowapps/meowapps'

// Read pinned meowapps SHA from package.json
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'))
const currentRef = pkg.dependencies?.meowapps || ''
const meowappsSha = currentRef.includes('#') ? currentRef.split('#')[1] : ''

// Clone full template repo
const tmp = execSync('mktemp -d', { encoding: 'utf8' }).trim()
execSync(`git clone --quiet ${TEMPLATE} ${tmp}`)
const latestTemplateSha = execSync('git rev-parse HEAD', { cwd: tmp, encoding: 'utf8' }).trim()

// Find template commit that corresponds to pinned meowapps SHA (from commit message)
let baseSha = ''
if (meowappsSha) {
  try {
    baseSha = execSync(`git log --grep="meowapps@${meowappsSha.slice(0, 7)}" --format="%H" -1`, { cwd: tmp, encoding: 'utf8' }).trim()
  } catch {}
}

if (baseSha === latestTemplateSha) {
  console.log('Already up to date.')
  fs.rmSync(tmp, { recursive: true })
  process.exit(0)
}

// Get list of tracked template files (exclude lock files)
const templateFiles = execSync('git ls-files', { cwd: tmp, encoding: 'utf8' })
  .trim().split('\n')
  .filter(f => f && f !== 'package-lock.json')

let applied = 0, conflicts = 0, added = 0
for (const f of templateFiles) {
  const theirs = path.join(tmp, f)
  const ours = path.join(process.cwd(), f)

  if (!fs.existsSync(ours)) {
    // File existed in base = user deleted it, skip. New from template = add.
    let existedInBase = false
    if (baseSha) { try { execSync(`git show ${baseSha}:${f}`, { cwd: tmp, stdio: 'pipe' }); existedInBase = true } catch {} }
    if (existedInBase) continue
    fs.mkdirSync(path.dirname(ours), { recursive: true })
    fs.copyFileSync(theirs, ours)
    console.log(`+ ${f}`)
    added++
    continue
  }

  // Check if files differ
  try { execSync(`diff -q "${theirs}" "${ours}"`, { stdio: 'pipe' }); continue } catch {}

  // 3-way merge: base = template@baseSha, ours = user, theirs = template@latest
  const baseFile = path.join(tmp, `../${path.basename(f)}.base`)
  try {
    if (baseSha) {
      fs.writeFileSync(baseFile, execSync(`git show ${baseSha}:${f}`, { cwd: tmp, encoding: 'utf8' }))
    } else {
      // No base — first upgrade, use empty file as base
      fs.writeFileSync(baseFile, '')
    }
    execSync(`git merge-file "${ours}" "${baseFile}" "${theirs}"`, { stdio: 'pipe' })
    console.log(`↑ ${f}`)
    applied++
  } catch (e) {
    if (e.status > 0) {
      console.log(`✖ ${f} — conflict, resolve manually`)
      conflicts++
    }
  } finally {
    if (fs.existsSync(baseFile)) fs.unlinkSync(baseFile)
  }
}

// Get meowapps SHA from latest template commit message
const latestMsg = execSync('git log -1 --format="%s"', { cwd: tmp, encoding: 'utf8' }).trim()
const latestMeowappsSha = latestMsg.match(/meowapps@(\w+)/)?.[1] || ''

fs.rmSync(tmp, { recursive: true })

// Update meowapps dependency to pin latest SHA
if (latestMeowappsSha) {
  pkg.dependencies.meowapps = `${MEOWAPPS}#${latestMeowappsSha}`
  fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n')
}

console.log(`\n${added} added, ${applied} updated, ${conflicts} conflicts`)
if (conflicts) {
  console.log('Resolve conflicts then commit.')
  process.exit(1)
}

// Clean and reinstall
for (const p of ['node_modules', 'package-lock.json', 'dist']) fs.rmSync(p, { recursive: true, force: true })
execSync('npm i', { stdio: 'inherit' })
