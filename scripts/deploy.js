#!/usr/bin/env node
import { execSync } from 'child_process'
import { builder } from './build.js'

const { dist } = builder.config()

// Build web, install deps, pull secret, deploy to Firebase
execSync(`node ${import.meta.dirname}/build.js`, { stdio: 'inherit' })
execSync('npm i', { cwd: dist, stdio: 'pipe' })
execSync(`shopify app env pull --env-file ${dist}/functions/.env`, { stdio: 'pipe' })
execSync('npm run deploy', { cwd: dist, stdio: 'inherit' })
