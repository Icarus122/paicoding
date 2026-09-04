const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')

const pagePath = path.resolve(__dirname, '../src/pages/following/following.js')
const pageCode = fs.readFileSync(pagePath, 'utf8')
const pageWxml = fs.readFileSync(path.resolve(__dirname, '../src/pages/following/following.wxml'), 'utf8')
const pageWxss = fs.readFileSync(path.resolve(__dirname, '../src/pages/following/following.wxss'), 'utf8')

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
    modal: [],
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
      showModal: (payload) => {
        calls.modal.push(payload)
        payload.success({ confirm: options.modalConfirm !== false })
      },
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

test('uses TDesign tabs with spacing inside the full-width scroll view', () => {
  assert.match(pageWxml, /<t-tabs[^>]+bind:change="switchTab"/)
  assert.match(pageWxml, /<t-tab-panel value="follow" label="关注">/)
  assert.match(pageWxml, /<t-tab-panel value="fans" label="粉丝">/)
  assert.match(pageWxml, /<scroll-view[^>]+>\s*<view class="list-content">/)
  assert.equal(pageWxss.includes('.user-scroll {\n  height: calc(100vh - 96rpx);\n}'), true)
  assert.equal(pageWxss.includes('.user-scroll {\n  padding:'), false)
  assert.equal(pageWxss.includes('.list-content {\n  padding: 24rpx 30rpx 0;\n}'), true)
})

test('loads the requested initial tab and normalizes users', async () => {
  const { page, calls } = loadPage({
    requestHandler: async () => ({
      list: [{ userId: 7, userName: '小派', followed: true }],
      hasMore: true,
    }),
  })

  await page.onLoad({ tab: 'fans' })

  assert.equal(page.data.activeTab, 'fans')
  assert.equal(calls.request[0].url, '/mini/api/user/follows')
  assert.equal(calls.request[0].data.type, 'fans')
  assert.equal(page.data.fans.users[0].userInitial, '小')
  assert.equal(page.data.fans.hasMore, true)
})

test('loads each tab lazily and preserves previously loaded state', async () => {
  const { page, calls } = loadPage()

  await page.onLoad({})
  await page.switchTab(tabEvent('fans'))
  await page.switchTab(tabEvent('follow'))

  assert.equal(calls.request.length, 2)
  assert.equal(calls.request[0].data.type, 'follow')
  assert.equal(calls.request[1].data.type, 'fans')
})

test('appends the next page to the active list', async () => {
  const { page } = loadPage({
    requestHandler: async requestOptions => requestOptions.data.page === 1
      ? { list: [{ userId: 1, userName: '一' }], hasMore: true }
      : { list: [{ userId: 2, userName: '二' }], hasMore: false },
  })

  await page.onLoad({})
  await page.loadMore(event('follow'))

  assert.deepEqual(page.data.follow.users.map(user => user.userId), [1, 2])
  assert.equal(page.data.follow.page, 3)
  assert.equal(page.data.follow.hasMore, false)
})

test('changes a fan between 回关 and 已互关 without removing the row', async () => {
  const { page, calls } = loadPage()
  page.setData({
    'fans.users': [{ userId: 9, userName: '粉丝', followed: false }],
  })

  await page.toggleRelationship(event('fans', { id: 9, followed: false }))
  assert.equal(page.data.fans.users[0].followed, true)
  assert.equal(calls.request[0].data.followed, true)
  assert.equal(calls.toast.at(-1).title, '已互关')

  await page.toggleRelationship(event('fans', { id: 9, followed: true }))
  assert.equal(page.data.fans.users.length, 1)
  assert.equal(page.data.fans.users[0].followed, false)
  assert.equal(calls.request[1].data.followed, false)
})

test('removes an unfollowed user only after confirmation', async () => {
  const { page, calls } = loadPage()
  page.setData({
    'follow.users': [{ userId: 5, userName: '作者', followed: true }],
  })

  await page.toggleRelationship(event('follow', { id: 5, followed: true }))

  assert.equal(calls.modal.length, 1)
  assert.equal(calls.request[0].data.followed, false)
  assert.equal(page.data.follow.users.length, 0)
})

test('keeps relationship state when a mutation fails', async () => {
  const { page, calls } = loadPage({
    requestHandler: async () => {
      throw new Error('网络异常')
    },
  })
  page.setData({
    'fans.users': [{ userId: 6, userName: '粉丝', followed: false }],
  })

  await page.toggleRelationship(event('fans', { id: 6, followed: false }))

  assert.equal(page.data.fans.users[0].followed, false)
  assert.equal(page.data.fans.users[0].submitting, false)
  assert.equal(calls.toast.at(-1).title, '网络异常')
})

test('blocks duplicate relationship submissions for the same row', async () => {
  const { page, calls } = loadPage()
  page.setData({
    'fans.users': [{ userId: 8, userName: '粉丝', followed: false, submitting: true }],
  })

  await page.toggleRelationship(event('fans', { id: 8, followed: false }))

  assert.equal(calls.request.length, 0)
})
