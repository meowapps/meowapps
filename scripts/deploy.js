#!/usr/bin/env node
import { execSync } from 'child_process'
import { builder } from './build.js'

const { dist } = builder.config()

// Deploy extensions, then build + deploy web to Firebase
execSync(`npx shopify app deploy ${process.argv.slice(2).join(' ')}`, { stdio: 'inherit' })
execSync(`node ${import.meta.dirname}/build.js`, { stdio: 'inherit' })
execSync('npm i', { cwd: dist, stdio: 'pipe' })
execSync(`npx shopify app env pull --env-file ${dist}/functions/.env`, { stdio: 'pipe' })
execSync('npm run deploy', { cwd: dist, stdio: 'inherit' })
