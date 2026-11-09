#!/usr/bin/env node
/**
 * Assemble the deployable static template gallery into `site-dist/`.
 *
 * Zero dependencies, plain Node. The result is a self-contained directory for
 * GitHub Pages:
 *
 *   site-dist/
 *     index.html, app.js, styles.css   (copied from site/)
 *     catalog.json                     (templates/catalog.json, with every
 *                                       entry.file rewritten to
 *                                       "templates/<name>.drawio")
 *     templates/<file>.drawio          (copied from templates/*.drawio)
 *
 * The `templates/` prefix matters beyond this page: the deployed catalog.json
 * is also consumable as a DSH remote template catalog
 * (`drawio_template({ catalog: "<site>/catalog.json", id: "..." })`), and the
 * plugin resolves each entry's `file` relative to the catalog URL.
 *
 * The page only uses relative URLs (`./catalog.json`, `./templates/...`), so the
 * artifact works under any Pages path (user site or project sub-path). Run with
 * `node scripts/build-site.mjs`; exits non-zero on any missing input.
 */

import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const siteDir = join(rootDir, 'site')
const templatesDir = join(rootDir, 'templates')
const catalogPath = join(templatesDir, 'catalog.json')
const distDir = join(rootDir, 'site-dist')

/** Recursively list files under a directory (absolute paths, sorted). */
async function listFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) files.push(...(await listFiles(path)))
    else if (entry.isFile()) files.push(path)
  }
  return files.sort()
}

/** Format a byte count as MB with one decimal. */
function megabytes(bytes) {
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

/** Copy every entry of `fromDir` into the (fresh) `toDir`. */
async function copyDirContents(fromDir, toDir) {
  await mkdir(toDir, { recursive: true })
  const entries = await readdir(fromDir, { withFileTypes: true })
  for (const entry of entries) {
    await cp(join(fromDir, entry.name), join(toDir, entry.name), { recursive: true })
  }
}

/** Parse the catalog and check its shape before touching the output dir. */
async function loadCatalog() {
  let raw
  try {
    raw = await readFile(catalogPath, 'utf8')
  } catch (error) {
    throw new Error(`cannot read ${catalogPath}: ${error instanceof Error ? error.message : String(error)}`)
  }
  let catalog
  try {
    catalog = JSON.parse(raw)
  } catch (error) {
    throw new Error(`templates/catalog.json is not valid JSON: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (catalog === null || typeof catalog !== 'object' || !Array.isArray(catalog.templates)) {
    throw new Error('templates/catalog.json must contain a "templates" array')
  }
  if (!Array.isArray(catalog.categories)) throw new Error('templates/catalog.json must contain a "categories" array')
  for (const entry of catalog.templates) {
    if (entry === null || typeof entry !== 'object') throw new Error('templates/catalog.json contains a non-object template entry')
    if (typeof entry.id !== 'string' || entry.id === '') throw new Error('catalog entry is missing "id"')
    if (typeof entry.file !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]*\.drawio$/u.test(entry.file)) {
      throw new Error(`catalog entry "${entry.id}" has an invalid "file"`)
    }
  }
  return catalog
}

/** Build `site-dist/` from scratch. */
async function main() {
  const startedAt = Date.now()

  // Fail before deleting anything if the inputs are not usable.
  const siteFiles = await listFiles(siteDir)
  for (const required of ['index.html', 'app.js', 'styles.css']) {
    if (!(await stat(join(siteDir, required)).catch(() => null))) {
      throw new Error(`missing required site file: site/${required}`)
    }
  }
  const catalog = await loadCatalog()

  const templateFiles = (await readdir(templatesDir, { withFileTypes: true }))
    .filter(entry => entry.isFile() && entry.name.endsWith('.drawio'))
    .map(entry => entry.name)
    .sort()
  if (templateFiles.length === 0) throw new Error('templates/ contains no *.drawio files')

  // Source catalog entries name bare files inside templates/; the deployed
  // catalog uses the "templates/<name>.drawio" form so the same file works as a
  // DSH remote catalog (plugin resolves `file` against the catalog URL).
  const known = new Set(templateFiles)
  const sourceName = file => (file.startsWith('templates/') ? file.slice('templates/'.length) : file)
  const deployedCatalog = {
    ...catalog,
    templates: catalog.templates.map(entry => ({
      ...entry,
      file: entry.file.startsWith('templates/') ? entry.file : `templates/${entry.file}`,
    })),
  }
  for (const entry of deployedCatalog.templates) {
    if (!known.has(sourceName(entry.file))) {
      throw new Error(`catalog entry "${entry.id}" references a missing template file: ${entry.file}`)
    }
    if (!/^templates\/[A-Za-z0-9][A-Za-z0-9._-]*\.drawio$/u.test(entry.file)) {
      throw new Error(`catalog entry "${entry.id}" would produce an invalid file path: ${entry.file}`)
    }
  }

  // Rebuild the output directory.
  await rm(distDir, { recursive: true, force: true })
  await mkdir(distDir, { recursive: true })

  await copyDirContents(siteDir, distDir)
  console.log(`[build-site] site/ -> site-dist/ (${siteFiles.length} files)`)

  await writeFile(join(distDir, 'catalog.json'), `${JSON.stringify(deployedCatalog, null, 2)}\n`, 'utf8')
  console.log(
    `[build-site] templates/catalog.json -> site-dist/catalog.json (1 file, ${deployedCatalog.templates.length} templates, file paths prefixed with templates/)`,
  )

  const templatesOutDir = join(distDir, 'templates')
  await mkdir(templatesOutDir, { recursive: true })
  for (const name of templateFiles) {
    await cp(join(templatesDir, name), join(templatesOutDir, name))
  }
  console.log(`[build-site] templates/*.drawio -> site-dist/templates/ (${templateFiles.length} files)`)

  // Verify the artifact references every catalog file and report totals.
  for (const entry of deployedCatalog.templates) {
    if (!(await stat(join(distDir, entry.file)).catch(() => null))) {
      throw new Error(`build output is missing site-dist/${entry.file}`)
    }
  }
  const outputFiles = await listFiles(distDir)
  let outputBytes = 0
  for (const file of outputFiles) outputBytes += (await stat(file)).size

  console.log(
    `[build-site] done in ${Date.now() - startedAt}ms: ${outputFiles.length} files, ${megabytes(outputBytes)} in site-dist/`,
  )
}

main().catch((error) => {
  console.error(`[build-site] error: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
})
