// post-tweet.mjs — Playwright runner for x-promoter.
// Driven by post-tweet.sh via env vars:
//   TWEETS_JSON  — JSON array of tweet bodies (1 = single, N = thread)
//   PROFILE_DIR  — persistent Playwright user-data dir
//   FAILURE_PNG  — path to write a screenshot if selectors break
//
// Exit codes (consumed by post-tweet.sh):
//   0   posted; permalink URL printed to stdout
//   10  login required
//   20  UI selector failed; screenshot saved

import { chromium } from 'playwright'
import { mkdirSync, chmodSync, statSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const TWEETS = JSON.parse(process.env.TWEETS_JSON || '[]')
const PROFILE = process.env.PROFILE_DIR
const FAILURE_PNG = process.env.FAILURE_PNG
// X aggressively blocks headless contexts. Default visible; opt-in via env.
const HEADLESS = process.env.X_HEADLESS === '1'

if (!Array.isArray(TWEETS) || TWEETS.length === 0) {
  console.error('post-tweet.mjs: TWEETS_JSON missing or empty')
  process.exit(2)
}
if (!PROFILE) {
  console.error('post-tweet.mjs: PROFILE_DIR missing')
  process.exit(2)
}

// Profile dir holds session cookies — restrict to owner-only.
mkdirSync(PROFILE, { recursive: true, mode: 0o700 })
const restrict = (path) => {
  try {
    chmodSync(path, statSync(path).isDirectory() ? 0o700 : 0o600)
    if (statSync(path).isDirectory()) {
      for (const entry of readdirSync(path)) restrict(join(path, entry))
    }
  } catch {
    // best-effort; do not fail the post over a chmod
  }
}
restrict(PROFILE)

const ctx = await chromium.launchPersistentContext(PROFILE, {
  headless: HEADLESS,
  viewport: { width: 1280, height: 900 },
})

const fail = async (code, msg) => {
  console.error(`post-tweet.mjs: ${msg}`)
  if (code === 20 && FAILURE_PNG) {
    const pages = ctx.pages()
    if (pages[0]) {
      await pages[0].screenshot({ path: FAILURE_PNG, fullPage: true }).catch(() => {})
    }
  }
  await ctx.close().catch(() => {})
  process.exit(code)
}

const page = ctx.pages()[0] || (await ctx.newPage())

try {
  await page.goto('https://x.com/home', { waitUntil: 'domcontentloaded', timeout: 30000 })
} catch (e) {
  await fail(10, `navigation to /home failed (treated as logged out): ${e.message}`)
}

// Pre-flight: if X bounced us to login / flow, treat as logged out.
const url = page.url()
if (/\/(login|i\/flow\/login|i\/flow\/signup)/.test(url)) {
  await fail(10, `redirected to ${url}; persistent profile is not logged in`)
}

// ARIA names X uses across locales. Extend per-locale regex as new ones surface.
const COMPOSER_NAME = /post text|what is happening|tweet|发布文字|有什么新鲜事|发推|发文|発信中の出来事|ポスト|투고|무슨 일이 일어나고 있나요/i
const ADD_POST_NAME = /add post|add tweet|add another|添加帖子|添加推文|追加投稿|추가/i
const POST_BUTTON_NAME = /^(post|post all|发帖|发布|全部发布|发推|ポスト|投稿|게시)$/i
const VIEW_LINK_NAME = /view|查看|表示|보기/i

// Locate the composer textbox. X exposes it as a contenteditable role=textbox.
let composer
try {
  composer = page.getByRole('textbox', { name: COMPOSER_NAME }).first()
  await composer.waitFor({ state: 'visible', timeout: 15000 })
} catch (e) {
  await fail(20, `home composer not found via ARIA role: ${e.message}`)
}

// Type the first tweet.
try {
  await composer.click()
  await composer.fill('')
  await page.keyboard.type(TWEETS[0], { delay: 12 })
} catch (e) {
  await fail(20, `typing first tweet failed: ${e.message}`)
}

// For threads, click "Add" and type subsequent tweets.
for (let i = 1; i < TWEETS.length; i++) {
  let addBtn
  try {
    addBtn = page.getByRole('button', { name: ADD_POST_NAME }).first()
    await addBtn.waitFor({ state: 'visible', timeout: 8000 })
    await addBtn.click()
  } catch (e) {
    await fail(20, `add-post button not found for thread tweet ${i + 1}: ${e.message}`)
  }
  try {
    const nextBox = page.getByRole('textbox', { name: COMPOSER_NAME }).nth(i)
    await nextBox.waitFor({ state: 'visible', timeout: 8000 })
    await nextBox.click()
    await page.keyboard.type(TWEETS[i], { delay: 12 })
  } catch (e) {
    await fail(20, `typing thread tweet ${i + 1} failed: ${e.message}`)
  }
}

// Click Post / Post all.
let postBtn
try {
  postBtn = page.getByTestId('tweetButtonInline').first()
  if (!(await postBtn.isVisible().catch(() => false))) {
    postBtn = page.getByRole('button', { name: POST_BUTTON_NAME }).last()
  }
  await postBtn.waitFor({ state: 'visible', timeout: 8000 })
  await postBtn.click()
} catch (e) {
  await fail(20, `post button not found / not clickable: ${e.message}`)
}

// Capture the permalink URL. X shows a "View" link in the success toast,
// or navigates to /<handle>/status/<id> for thread roots in some cases.
let permalink = ''
try {
  const viewLink = page.getByRole('link', { name: VIEW_LINK_NAME }).first()
  await viewLink.waitFor({ state: 'visible', timeout: 15000 })
  const href = await viewLink.getAttribute('href')
  if (href) permalink = href.startsWith('http') ? href : `https://x.com${href}`
} catch {
  // Fallback: poll the URL for /status/.
  const start = Date.now()
  while (Date.now() - start < 15000) {
    if (/\/status\/\d+/.test(page.url())) {
      permalink = page.url()
      break
    }
    await page.waitForTimeout(500)
  }
}

if (!permalink) {
  await fail(20, 'posted but permalink URL not captured')
}

console.log(permalink)
await ctx.close()
process.exit(0)
