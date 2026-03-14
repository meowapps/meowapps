#!/usr/bin/env node
import { execSync } from 'child_process'
import fs from 'fs'
import path from 'path'

// Abort if working tree has unstaged or untracked changes
try { execSync('git diff --quiet', { stdio: 'pipe' }) } catch { console.error('Unstaged changes found. Commit or stash before upgrading.'); process.exit(1) }
const untracked = execSync('git ls-files --others --exclude-standard', { encoding: 'utf8' }).trim()
if (untracked) { console.error('Untracked files found. Commit or stash before upgrading.'); process.exit(1) }

const TEMPLATE = 'https://github.com/meowapps/meowapps-template.git'
// Read current meowapps SHA from package-lock.json
const lock = JSON.parse(fs.readFileSync('package-lock.json', 'utf8'))
const resolved = lock.packages?.['node_modules/meowapps']?.resolved || ''
const meowappsSha = resolved.match(/#(\w+)$/)?.[1] || ''

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
  } catch {
    // git merge-file exits > 0 for both auto-merged and conflicted — check for markers
    if (fs.readFileSync(ours, 'utf8').includes('<<<<<<<')) {
      console.log(`✖ ${f} — conflict, resolve manually`)
      conflicts++
    } else {
      console.log(`↑ ${f}`)
      applied++
    }
  } finally {
    if (fs.existsSync(baseFile)) fs.unlinkSync(baseFile)
  }
}

fs.rmSync(tmp, { recursive: true })

// Clean and reinstall (skip if package.json has conflicts)
for (const p of ['node_modules', 'package-lock.json', 'dist']) fs.rmSync(p, { recursive: true, force: true })
const pkgConflict = fs.readFileSync('package.json', 'utf8').includes('<<<<<<<')
if (!pkgConflict) execSync('npm i', { stdio: 'inherit' })

console.log(`\n${added} added, ${applied} updated, ${conflicts} conflicts`)
if (conflicts) console.log(`Resolve conflicts then ${pkgConflict ? 'run npm i and ' : ''}commit.`)
