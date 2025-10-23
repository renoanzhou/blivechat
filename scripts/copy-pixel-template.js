const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const DIST_DIR = path.join(ROOT, 'frontend', 'dist')
const TEMPLATE_DIR = path.join(ROOT, 'data', 'custom_public', 'templates', 'pixel-library')

const JS_TARGET = path.join(TEMPLATE_DIR, 'js')
const CSS_TARGET = path.join(TEMPLATE_DIR, 'css')
const THUMBNAIL_TARGET = path.join(TEMPLATE_DIR, 'thumbnail.png')
const THUMBNAIL_SOURCE = path.join(ROOT, 'frontend', 'src', 'assets', 'img', 'logo.png')
const TEMPLATE_META_PATH = path.join(TEMPLATE_DIR, 'template.json')

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
}

function copyFile(src, dest) {
  ensureDir(path.dirname(dest))
  fs.copyFileSync(src, dest)
  console.log('Copied', path.relative(ROOT, src), '->', path.relative(ROOT, dest))
}

function extractAssets(html) {
  const jsMatches = Array.from(html.matchAll(/<script[^>]+src=\"(?:\.\/|\/)?(js\/[^\"]+)\"/g)).map(match => match[1])
  const cssMatches = Array.from(html.matchAll(/<link[^>]+href=\"(?:\.\/|\/)?(css\/[^\"]+)\"/g)).map(match => match[1])
  return {
    js: Array.from(new Set(jsMatches)),
    css: Array.from(new Set(cssMatches)),
  }
}

function main() {
  const htmlPath = path.join(DIST_DIR, 'library.html')
  if (!fs.existsSync(htmlPath)) {
    throw new Error('Could not find library.html in dist. Please run `npm run build` first.')
  }
  const htmlContent = fs.readFileSync(htmlPath, 'utf8')
  const assets = extractAssets(htmlContent)

  if (!assets.js.length) {
    throw new Error('No JS assets found in library.html')
  }

  ensureDir(JS_TARGET)
  ensureDir(CSS_TARGET)

  assets.js.forEach(rel => {
    copyFile(path.join(DIST_DIR, rel), path.join(TEMPLATE_DIR, rel))
  })

  assets.css.forEach(rel => {
    copyFile(path.join(DIST_DIR, rel), path.join(TEMPLATE_DIR, rel))
  })

  const sdkSource = path.join(ROOT, 'frontend', 'src', 'blcsdk.js')
  copyFile(sdkSource, path.join(TEMPLATE_DIR, 'blcsdk.js'))

  const headLinks = assets.css.map(rel => `    <link rel="stylesheet" href="./${rel}" />`).join('\n')
  const scriptTags = assets.js.map(rel => `    <script src="./${rel}" defer></script>`).join('\n')

  const outputHtml = `<!DOCTYPE html>\n<html lang="zh-CN">\n  <head>\n    <meta charset="utf-8" />\n    <meta http-equiv="X-UA-Compatible" content="IE=edge" />\n    <meta name="viewport" content="width=device-width,initial-scale=1,user-scalable=no" />\n    <meta name="referrer" content="no-referrer" />\n    <title>直播图书馆 Pixel</title>\n${headLinks}\n  </head>\n  <body>\n    <div id="app"></div>\n    <script src="./blcsdk.js"></script>\n${scriptTags}\n  </body>\n</html>\n`

  fs.writeFileSync(path.join(TEMPLATE_DIR, 'index.html'), outputHtml)
  console.log('Updated template index.html')

  if (fs.existsSync(THUMBNAIL_SOURCE)) {
    copyFile(THUMBNAIL_SOURCE, THUMBNAIL_TARGET)
  } else {
    console.warn('Thumbnail source not found at', path.relative(ROOT, THUMBNAIL_SOURCE))
  }

  const templateMetadata = {
    name: 'Pixel Library',
    version: '1.0.0',
    author: 'blivechat',
    description: 'Study room pixel overlay template with seat board UI.',
    thumbnail: 'thumbnail.png',
    url: 'index.html',
  }
  fs.writeFileSync(TEMPLATE_META_PATH, `${JSON.stringify(templateMetadata, null, 2)}\n`)
  console.log('Updated template metadata')
}

main()
