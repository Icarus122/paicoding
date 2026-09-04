const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')

const pagePath = path.resolve(__dirname, '../src/pages/my-articles/my-articles.js')
const pageCode = fs.readFileSync(pagePath, 'utf8')
const pageWxml = fs.readFileSync(path.resolve(__dirname, '../src/pages/my-articles/my-articles.wxml'), 'utf8')
const pageWxss = fs.readFileSync(path.resolve(__dirname, '../src/pages/my-articles/my-articles.wxss'), 'utf8')
const profileWxml = fs.readFileSync(path.resolve(__dirname, '../src/pages/profile/profile.wxml'), 'utf8')
const profileJs = fs.readFileSync(path.resolve(__dirname, '../src/pages/profile/profile.js'), 'utf8')

function setByPath(target, pathKey, value) {
  const parts = pathKey.split('.')
  let current = target
  parts.slice(0, -1).forEach((part) => {
    current = current[part]
  })
  current[parts.at(-1)] = value
}

function loadPage(options = {}) {
  const calls = {
    request: [],
    navigate: [],
    toast: [],
  }
  let pageConfig
  const auth = {
    requestWithLogin: async (requestOptions) => {
      calls.request.push(requestOptions)
      if (options.requestHandler) {
        return options.requestHandler(requestOptions, calls.request.length)
      }
      return { list: [], hasMore: false }
    },
  }
  const sandbox = {
    Page: (config) => {
      pageConfig = config
    },
    require: (id) => {
      if (id === '../../utils/auth') {
        return auth
      }
      throw new Error(`Unexpected require: ${id}`)
    },
    wx: {
      navigateTo: payload => calls.navigate.push(payload),
      showToast: payload => calls.toast.push(payload),
    },
  }
  vm.runInNewContext(pageCode, sandbox, { filename: pagePath })
  const page = Object.assign({}, pageConfig, {
    data: JSON.parse(JSON.stringify(pageConfig.data)),
    setData(patch) {
      Object.entries(patch).forEach(([pathKey, value]) => setByPath(this.data, pathKey, value))
    },
  })
  return { page, calls }
}

function event(type, data = {}) {
  return { currentTarget: { dataset: Object.assign({ type }, data) } }
}

function tabEvent(value) {
  return { detail: { value } }
}

test('uses TDesign tabs and keeps scroll padding inside the list content', () => {
  assert.match(pageWxml, /<t-tabs[^>]+bind:change="switchTab"/)
  assert.match(pageWxml, /<t-tab-panel value="article" label="文章">/)
  assert.match(pageWxml, /<t-tab-panel value="draft" label="草稿">/)
  assert.match(pageWxml, /<scroll-view[^>]+>\s*<view class="list-content">/)
  assert.equal(pageWxss.includes('.article-scroll {\n  height: calc(100vh - 96rpx);\n}'), true)
  assert.equal(pageWxss.includes('.article-scroll {\n  padding:'), false)
  assert.equal(pageWxml.includes('写文章'), false)
  assert.match(pageWxml, /catchtap="publishDraft"/)
})

test('profile entry opens my articles page', () => {
  assert.match(profileWxml, /bindtap="openMyArticles"/)
  assert.match(profileJs, /\/pages\/my-articles\/my-articles/)
})

test('loads requested initial tab and normalizes review status', async () => {
  const { page, calls } = loadPage({
    requestHandler: async () => ({
      list: [{ articleId: 1, title: '审核文章', status: 2 }],
      hasMore: true,
    }),
  })

  await page.onLoad({ tab: 'draft' })

  assert.equal(page.data.activeTab, 'draft')
  assert.equal(calls.request[0].url, '/mini/api/user/articles')
  assert.equal(calls.request[0].data.type, 'draft')
  assert.equal(page.data.draft.articles[0].statusText, '审核中')
  assert.equal(page.data.draft.hasMore, true)
})

test('loads tabs lazily and appends next page independently', async () => {
  const { page, calls } = loadPage({
    requestHandler: async requestOptions => ({
      list: [{ articleId: requestOptions.data.type === 'article' ? requestOptions.data.page : 9, title: '文章', status: 1 }],
      hasMore: requestOptions.data.page === 1,
    }),
  })

  await page.onLoad({})
  await page.loadMore(event('article'))
  await page.switchTab(tabEvent('draft'))

  assert.deepEqual(page.data.article.articles.map(item => item.articleId), [1, 2])
  assert.equal(page.data.draft.articles[0].articleId, 9)
  assert.equal(calls.request.length, 3)
})

test('opens submitted articles in detail and leaves drafts on the list', () => {
  const { page, calls } = loadPage()

  page.openArticle(event('article', { id: 10, status: 1 }))
  page.openArticle(event('article', { id: 11, status: 2 }))
  page.openArticle(event('draft', { id: 12, status: 0 }))

  assert.equal(calls.navigate[0].url, '/pages/detail/detail?id=10')
  assert.equal(calls.navigate[1].url, '/pages/detail/detail?id=11')
  assert.equal(calls.navigate.length, 2)
})

test('publishes a draft and refreshes both loaded tabs', async () => {
  const { page, calls } = loadPage({
    requestHandler: async requestOptions => requestOptions.method === 'POST'
      ? { articleId: 9, status: 2 }
      : { list: [{ articleId: requestOptions.data.type === 'draft' ? 9 : 2, title: '文章', status: requestOptions.data.type === 'draft' ? 0 : 2 }], hasMore: false },
  })
  await page.onLoad({ tab: 'draft' })
  await page.switchTab(tabEvent('article'))
  await page.switchTab(tabEvent('draft'))

  await page.publishDraft(event('draft', { id: 9 }))

  assert.equal(calls.request[2].url, '/mini/api/user/articles/9/publish')
  assert.equal(calls.request[2].method, 'POST')
  assert.equal(calls.toast.at(-1).title, '已提交审核')
  assert.equal(calls.request[3].data.type, 'draft')
  assert.equal(calls.request[4].data.type, 'article')
})
