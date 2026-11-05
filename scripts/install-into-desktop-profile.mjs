#!/usr/bin/env node
/**
 * Install / uninstall **dsh-drawio-inline** into the DSH desktop profile
 * without the CLI.
 *
 * The desktop app owns `~/.dsh/profiles/desktop`: the standalone `dsh` CLI
 * refuses to modify it ("managed exclusively by the Electron application"), so
 * a local build is registered the same way the profile already handles local
 * plugins — copy into `plugins/`, copy into `node_modules/`, and record the
 * package in `package.json` (dependency + `dsh.profile.bundles`).
 *
 * Quit the app first: DSH reads the profile at boot, and a half-written profile
 * is not a recoverable state. The script refuses to run while the app process
 * is alive unless --force is passed.
 *
 * Usage:
 *   node scripts/install-into-desktop-profile.mjs            # install
 *   node scripts/install-into-desktop-profile.mjs --dry-run  # print only
 *   node scripts/install-into-desktop-profile.mjs --uninstall # remove
 *   node scripts/install-into-desktop-profile.mjs --force     # skip app check
 */
import { cpSync, existsSync, readFileSync, renameSync, rmSync, writeFileSync, readdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import os from 'node:os'

const PACKAGE = 'dsh-drawio-inline'
const args = new Set(process.argv.slice(2))
const dryRun = args.has('--dry-run')
const wantUninstall = args.has('--uninstall')
const force = args.has('--force')

const repo = dirname(dirname(fileURLToPath(import.meta.url)))
const profile = join(os.homedir(), '.dsh', 'profiles', 'desktop')
const pluginsDir = join(profile, 'plugins', PACKAGE)
const nodeModulesDir = join(profile, 'node_modules', PACKAGE)
const manifestPath = join(profile, 'package.json')
const DEP_SPEC = 'file:./plugins/' + PACKAGE

/** Dev-only paths that never need to exist inside a runtime profile. */
const EXCLUDED = new Set(['node_modules', '.git', '.github', '.harness', 'docs', 'tests', 'market', 'shared', 'pnpm-lock.yaml', 'tsconfig.json', 'tsconfig.build.json', 'tsconfig.vitest.json', 'vitest.config.ts', 'vitest.setup.ts', 'tsdown.config.ts'])

function fail(message) {
  console.error('✗ ' + message)
  process.exit(1)
}

function step(message) {
  console.log((dryRun ? '[dry-run] ' : '• ') + message)
}

function assertLayout() {
  const manifest = JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8'))
  if (manifest.name !== PACKAGE) fail(`${repo} is not the ${PACKAGE} repository`)
  if (!existsSync(join(repo, 'lib', 'index.js')) || !existsSync(join(repo, 'lib', 'client.js'))) {
    fail(`built artifacts are missing in ${repo}. Run: pnpm install && pnpm build`)
  }
  if (!existsSync(manifestPath)) fail(`desktop profile not found at ${profile}`)
}

function assertAppQuit() {
  if (force) return
  const probe = spawnSync('pgrep', ['-f', 'DeepSeek Harness'], { encoding: 'utf8' })
  if (probe.status === 0 && probe.stdout.trim() !== '') {
    fail('DeepSeek Harness is running. Quit it (⌘Q) first, or pass --force if you are sure.')
  }
}

function readProfile() {
  const raw = readFileSync(manifestPath, 'utf8')
  const pkg = JSON.parse(raw)
  if (pkg === null || typeof pkg !== 'object') fail('profile package.json is not an object')
  return pkg
}

function writeProfile(pkg) {
  const backup = manifestPath + '.bak-' + PACKAGE
  if (!dryRun) {
    if (!existsSync(backup)) writeFileSync(backup, readFileSync(manifestPath, 'utf8'))
    writeFileSync(manifestPath, JSON.stringify(pkg, null, 2) + '\n')
  }
}

function copyRuntimeTree(dest) {
  if (!dryRun) rmSync(dest, { recursive: true, force: true })
  step(`copy ${repo} -> ${dest}`)
  if (dryRun) return
  cpSync(repo, dest, {
    recursive: true,
    filter: (source) => {
      const name = source.split('/').pop() ?? ''
      return !EXCLUDED.has(name)
    },
  })
}

function install() {
  assertLayout()
  assertAppQuit()
  console.log(`• profile: ${profile}`)
  const pkg = readProfile()
  copyRuntimeTree(pluginsDir)
  copyRuntimeTree(nodeModulesDir)
  pkg.dependencies = pkg.dependencies ?? {}
  pkg.dependencies[PACKAGE] = DEP_SPEC
  const bundles = pkg.dsh?.profile?.bundles
  if (!Array.isArray(bundles)) fail('profile package.json has no dsh.profile.bundles array')
  if (!bundles.includes(PACKAGE)) bundles.push(PACKAGE)
  writeProfile(pkg)
  step(`register dependency ${DEP_SPEC}`)
  step(`register bundle ${PACKAGE}`)
  console.log(dryRun ? '\n(dry run) nothing was written.' : '\n✓ installed. Reopen DeepSeek Harness; draw.io tools should now be available; ask the model to draw a diagram draw.io 图表.')
  console.log('  rollback: node ' + process.argv[1] + ' --uninstall')
}

function uninstall() {
  assertLayout()
  assertAppQuit()
  const pkg = readProfile()
  if (pkg.dependencies) delete pkg.dependencies[PACKAGE]
  if (Array.isArray(pkg.dsh?.profile?.bundles)) {
    pkg.dsh.profile.bundles = pkg.dsh.profile.bundles.filter((entry) => entry !== PACKAGE)
  }
  writeProfile(pkg)
  step('remove dependency + bundle registration')
  for (const dir of [pluginsDir, nodeModulesDir]) {
    step(`remove ${dir}`)
    if (!dryRun) rmSync(dir, { recursive: true, force: true })
  }
  console.log(dryRun ? '\n(dry run) nothing was changed.' : '\n✓ uninstalled. Reopen DeepSeek Harness.')
}

if (wantUninstall) uninstall()
else install()
