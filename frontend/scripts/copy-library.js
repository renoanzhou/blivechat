#!/usr/bin/env node
const fs = require('fs')
const path = require('path')

const projectRoot = path.resolve(__dirname, '..')
const distDir = path.join(projectRoot, 'dist')
const targetRoot = path.resolve(projectRoot, '..', 'data', 'custom_public', 'study-room')

const REQUIRED_FILES = ['library.html']

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true })
}

function copyRecursive(srcDir, destDir) {
  if (!fs.existsSync(srcDir)) {
    return
  }
  ensureDir(destDir)
  for (const entry of fs.readdirSync(srcDir)) {
    const srcPath = path.join(srcDir, entry)
    const destPath = path.join(destDir, entry)
    const stat = fs.statSync(srcPath)
    if (stat.isDirectory()) {
      copyRecursive(srcPath, destPath)
    } else {
      fs.copyFileSync(srcPath, destPath)
    }
  }
}

function rewriteHtml(html, resources) {
  let output = html
  const replacements = []

  const scriptRegex = /<script[^>]+src="\/([^"]+)"[^>]*><\/script>/g
  let match
  while ((match = scriptRegex.exec(html)) !== null) {
    const resource = match[1]
    resources.add(resource)
    replacements.push({ match: match[0], updated: match[0].replace(resource, `./${resource}`) })
  }

  const linkRegex = /<link[^>]+href="\/([^"]+)"[^>]*>/g
  while ((match = linkRegex.exec(html)) !== null) {
    const resource = match[1]
    resources.add(resource)
    replacements.push({ match: match[0], updated: match[0].replace(resource, `./${resource}`) })
  }

  for (const { match: token, updated } of replacements) {
    output = output.replace(token, updated)
  }
  return output
}

if (!fs.existsSync(distDir)) {
  console.error('Cannot find dist directory. Run "npm run build" first.')
  process.exit(1)
}

for (const required of REQUIRED_FILES) {
  if (!fs.existsSync(path.join(distDir, required))) {
    console.error(`Missing ${required} in dist/. Run "npm run build" first.`)
    process.exit(1)
  }
}

const resourceSet = new Set()
const htmlPath = path.join(distDir, 'library.html')
const html = fs.readFileSync(htmlPath, 'utf8')
const rewrittenHtml = rewriteHtml(html, resourceSet)

// Prepare target structure
fs.rmSync(targetRoot, { recursive: true, force: true })
ensureDir(targetRoot)

// Copy required resources
for (const resource of resourceSet) {
  const srcPath = path.join(distDir, resource)
  const destPath = path.join(targetRoot, resource)
  ensureDir(path.dirname(destPath))
  if (!fs.existsSync(srcPath)) {
    console.warn(`Resource ${resource} referenced in HTML but not found in dist/`)
    continue
  }
  fs.copyFileSync(srcPath, destPath)
}

// Copy shared assets (fonts/images/static) if they exist
copyRecursive(path.join(distDir, 'fonts'), path.join(targetRoot, 'fonts'))
copyRecursive(path.join(distDir, 'img'), path.join(targetRoot, 'img'))
copyRecursive(path.join(distDir, 'static'), path.join(targetRoot, 'static'))

fs.writeFileSync(path.join(targetRoot, 'index.html'), rewrittenHtml, 'utf8')

console.log('Library assets copied to data/custom_public/study-room/')
