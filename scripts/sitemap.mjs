#!/usr/bin/env node
// Builds sitemap.xml from the site's own HTML files, so every public page is
// listed exactly once and nothing else is.
//
//   node scripts/sitemap.mjs            rewrite sitemap.xml
//   node scripts/sitemap.mjs --check    fail if sitemap.xml lists the wrong pages (CI)
//   node scripts/sitemap.mjs --netlify  Netlify build: get full git history, then rewrite
//
// Rules:
// - Every .html file is a page and goes in the sitemap, unless EXCLUDED below
//   names it with a reason, or it sets <meta name="robots" content="noindex">.
// - The URL is the page's <link rel="canonical"> (relative ones resolved
//   against the page URL) when it has one, otherwise the file path
//   (index.html becomes its folder). The check fails on a canonical on any
//   other host (it would tell Google the real page lives elsewhere) and on one
//   ending in index.html (Google would index /index.html instead of /).
// - lastmod is the date of the last git commit that touched the page's file.
//   No history (shallow clone, uncommitted file) means no lastmod, never a
//   made-up date.
// Zero dependencies on purpose: the site has no package.json.

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

export const SITE = 'https://villasatsheriden.com'

// Pages that must stay out of the sitemap: path from the repo root, and why.
// (privacypolicy.html and termsandconditions.html are left out because they
// carry <meta name="robots" content="noindex">, not because of this list.)
export const EXCLUDED = {}

const SKIP_DIRS = new Set(['.git', '.github', '.claude', '.netlify', 'node_modules', 'netlify', 'scripts'])
const ROOT = fileURLToPath(new URL('..', import.meta.url))

function htmlFiles(dir = ROOT) {
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) out.push(...htmlFiles(join(dir, entry.name)))
    } else if (entry.name.endsWith('.html')) {
      out.push(relative(ROOT, join(dir, entry.name)).split(sep).join('/'))
    }
  }
  return out.sort()
}

function attr(tag, name) {
  const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, 'i'))
  return m ? m[1] : null
}

function canonicalOf(html) {
  for (const tag of html.match(/<link\b[^>]*>/gi) || []) {
    if ((attr(tag, 'rel') || '').toLowerCase() === 'canonical') return attr(tag, 'href')
  }
  return null
}

function isNoindex(html) {
  for (const tag of html.match(/<meta\b[^>]*>/gi) || []) {
    const name = (attr(tag, 'name') || '').toLowerCase()
    if ((name === 'robots' || name === 'googlebot') && /noindex/i.test(attr(tag, 'content') || '')) return true
  }
  return false
}

function pathUrl(file) {
  if (file === 'index.html') return `${SITE}/`
  if (file.endsWith('/index.html')) return `${SITE}/${file.slice(0, -'index.html'.length)}`
  return `${SITE}/${file}`
}

function git(...args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
}

function isShallow() {
  try {
    return git('rev-parse', '--is-shallow-repository') !== 'false'
  } catch {
    return true
  }
}

function lastmod(file, shallow) {
  if (shallow) return null
  try {
    if (git('status', '--porcelain', '--', file)) return null // uncommitted change: no honest date yet
    return git('log', '-1', '--format=%cI', '--', file) || null
  } catch {
    return null
  }
}

// Works out what the sitemap should be. Returns { pages, problems }.
export function plan() {
  const pages = []
  const problems = []
  const files = htmlFiles()
  for (const file of files) {
    if (EXCLUDED[file]) continue
    const html = readFileSync(join(ROOT, file), 'utf8')
    if (isNoindex(html)) continue
    const href = canonicalOf(html)
    // Relative canonicals (most pages here say href="amenities.html") resolve
    // against the page's own URL, the way Google reads them.
    const canonical = href === null ? null : new URL(href, pathUrl(file)).href
    if (canonical !== null && !canonical.startsWith(`${SITE}/`)) {
      problems.push(`${file} has <link rel="canonical" href="${href}">, which is not on ${SITE}. Change it to href="${pathUrl(file)}".`)
      continue
    }
    if (canonical !== null && /\/index\.html$/.test(canonical)) {
      problems.push(`${file} has <link rel="canonical" href="${href}">, which names ${canonical}. Google would index that instead of the folder URL. Change it to href="${canonical.slice(0, -'index.html'.length)}".`)
      continue
    }
    pages.push({ file, loc: canonical || pathUrl(file) })
  }
  // A noindex response header hides the whole site no matter what the sitemap says.
  for (const file of ['netlify.toml', '_headers']) {
    if (!existsSync(join(ROOT, file))) continue
    readFileSync(join(ROOT, file), 'utf8').split('\n').forEach((line, i) => {
      if (/^\s*[^#]*x-robots-tag[^#]*noindex/i.test(line)) problems.push(`${file} line ${i + 1} sends an X-Robots-Tag noindex header, which keeps pages out of Google. Remove it (noindex single pages with a <meta name="robots"> tag instead).`)
    })
  }
  // robots.txt must point Google at the sitemap and must not block the site.
  const robotsFile = join(ROOT, 'robots.txt')
  if (!existsSync(robotsFile)) {
    problems.push(`robots.txt is missing. Add one with "Sitemap: ${SITE}/sitemap.xml".`)
  } else {
    const robots = readFileSync(robotsFile, 'utf8')
    if (!robots.split('\n').some(l => l.trim() === `Sitemap: ${SITE}/sitemap.xml`)) problems.push(`robots.txt has no "Sitemap: ${SITE}/sitemap.xml" line. Add it.`)
    if (/^\s*disallow:\s*\/\s*$/im.test(robots)) problems.push('robots.txt has "Disallow: /", which blocks the whole site. Remove it.')
  }
  for (const file of Object.keys(EXCLUDED)) {
    if (!files.includes(file)) problems.push(`EXCLUDED in scripts/sitemap.mjs names ${file}, which no longer exists. Remove that line.`)
  }
  const seen = new Map()
  for (const p of pages) {
    if (seen.has(p.loc)) problems.push(`${p.file} and ${seen.get(p.loc)} both claim ${p.loc}. Fix one page's canonical.`)
    seen.set(p.loc, p.file)
  }
  pages.sort((a, b) => (a.file === 'index.html' ? -1 : b.file === 'index.html' ? 1 : 0))
  return { pages, problems }
}

export function render(pages, shallow = isShallow()) {
  const rows = pages.map(({ file, loc }) => {
    const date = lastmod(file, shallow)
    return `  <url>\n    <loc>${loc}</loc>\n${date ? `    <lastmod>${date}</lastmod>\n` : ''}  </url>`
  })
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!-- Generated by scripts/sitemap.mjs. Do not edit by hand; see README.md "Adding a page". -->\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${rows.join('\n')}\n</urlset>\n`
}

function locsIn(xml) {
  return [...xml.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/g)].map(m => m[1])
}

function fail(lines) {
  console.error(`Sitemap check failed (scripts/sitemap.mjs):\n  - ${lines.join('\n  - ')}`)
  process.exit(1)
}

function main() {
  const mode = process.argv[2] || ''
  const { pages, problems } = plan()
  if (problems.length) fail(problems)

  if (mode === '--check') {
    const file = join(ROOT, 'sitemap.xml')
    const committed = existsSync(file) ? locsIn(readFileSync(file, 'utf8')) : []
    const want = pages.map(p => p.loc)
    const errors = []
    for (const p of pages) {
      if (!committed.includes(p.loc)) errors.push(`${p.file} is not in sitemap.xml. Run \`node scripts/sitemap.mjs\` and commit sitemap.xml. If the page must stay out of Google, add "${p.file}" to EXCLUDED in scripts/sitemap.mjs with a one-line reason.`)
    }
    for (const loc of committed) {
      if (!want.includes(loc)) errors.push(`sitemap.xml lists ${loc}, which is not a page here (deleted, renamed, excluded or noindex). Run \`node scripts/sitemap.mjs\` and commit sitemap.xml.`)
    }
    if (new Set(committed).size !== committed.length) errors.push('sitemap.xml lists a URL twice. Run `node scripts/sitemap.mjs` and commit sitemap.xml.')
    if (errors.length) fail(errors)
    console.log(`Sitemap check passed: ${pages.length} pages, ${Object.keys(EXCLUDED).length} excluded.`)
    return
  }

  if (mode === '--netlify' && isShallow()) {
    // Netlify clones shallow, which would date every page to the newest commit.
    try {
      execFileSync('git', ['fetch', '--unshallow', '--quiet'], { cwd: ROOT, stdio: 'inherit' })
    } catch {
      console.warn('git fetch --unshallow failed; sitemap.xml will have no lastmod dates this deploy.')
    }
  }
  const xml = render(pages)
  writeFileSync(join(ROOT, 'sitemap.xml'), xml)
  const dated = (xml.match(/<lastmod>/g) || []).length
  console.log(`Wrote sitemap.xml: ${pages.length} pages, ${dated} dated from git history.`)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main()
