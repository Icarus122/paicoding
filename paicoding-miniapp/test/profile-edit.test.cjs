const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')

const pagePath = path.resolve(__dirname, '../src/pages/profile-edit/profile-edit.js')
const pageCode = fs.readFileSync(pagePath, 'utf8')

function loadPage(options = {}) {
  const calls = {
    persistUser: [],
    request: [],
    upload: [],
    toast: [],
    navigateBack: 0,
  }
  let pageConfig
  const auth = {
    getStoredUser: () => options.storedUser || {},
    persistUser: (user) => calls.persistUser.push(user),
  }
  const requestApi = {
    request: async (requestOptions) => {
      calls.request.push(requestOptions)
      if (options.requestReject) {
        throw options.requestReject
      }
      return options.requestResult || {}
    },
    upload: async (url, filePath, name) => {
      calls.upload.push({ url, filePath, name })
      if (options.uploadReject) {
        throw options.uploadReject
      }
      return options.uploadResult || {}
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
      if (id === '../../utils/request') {
        return requestApi
      }
      throw new Error(`Unexpected require: ${id}`)
    },
    wx: {
      showToast: (payload) => calls.toast.push(payload),
      navigateBack: () => {
        calls.navigateBack += 1
      },
    },
  }
  vm.runInNewContext(pageCode, sandbox, { filename: pagePath })
  const page = Object.assign({}, pageConfig, {
    data: JSON.parse(JSON.stringify(pageConfig.data)),
    setData(patch) {
      Object.assign(this.data, patch)
    },
  })
  return { page, calls }
}

test('initializes from stored user without login refresh', () => {
  const storedUser = {
    nickName: '技术派',
    avatarUrl: 'https://example.com/avatar.png',
    profile: 'Java 与 AI',
  }
  const { page } = loadPage({ storedUser })

  page.onLoad()

  assert.equal(page.data.nickName, storedUser.nickName)
  assert.equal(page.data.avatarUrl, storedUser.avatarUrl)
  assert.equal(page.data.profile, storedUser.profile)
})

test('uploads avatar directly and persists returned user', async () => {
  const uploadResult = {
    nickName: '技术派',
    avatarUrl: 'https://example.com/new.png',
    profile: '',
  }
  const { page, calls } = loadPage({ uploadResult })
  page.setData({ avatarUrl: 'https://example.com/old.png' })

  await page.onChooseAvatar({ detail: { avatarUrl: 'wxfile://temp.png' } })

  assert.deepEqual(calls.upload, [{
    url: '/mini/api/user/avatar',
    filePath: 'wxfile://temp.png',
    name: 'image',
  }])
  assert.deepEqual(calls.persistUser, [uploadResult])
  assert.equal(page.data.avatarUrl, uploadResult.avatarUrl)
})

test('restores previous avatar when upload fails', async () => {
  const { page, calls } = loadPage({
    uploadReject: new Error('上传失败'),
  })
  page.setData({ avatarUrl: 'https://example.com/old.png' })

  await page.onChooseAvatar({ detail: { avatarUrl: 'wxfile://temp.png' } })

  assert.equal(page.data.avatarUrl, 'https://example.com/old.png')
  assert.equal(calls.toast.at(-1).title, '上传失败')
})

test('blocks duplicate avatar upload and duplicate save', async () => {
  const { page, calls } = loadPage()

  page.setData({ uploading: true })
  await page.onChooseAvatar({ detail: { avatarUrl: 'wxfile://temp.png' } })
  assert.equal(calls.upload.length, 0)

  page.setData({ uploading: false, saving: true, nickName: '技术派' })
  await page.saveProfile()
  assert.equal(calls.request.length, 0)
})

test('validates nickname and profile before save', async () => {
  const { page, calls } = loadPage()

  page.setData({ nickName: '   ', profile: '' })
  await page.saveProfile()
  assert.equal(calls.request.length, 0)
  assert.equal(calls.toast.at(-1).title, '请填写昵称')

  page.setData({ nickName: '技术派', profile: 'hello\nworld' })
  await page.saveProfile()
  assert.equal(calls.request.length, 0)
  assert.equal(calls.toast.at(-1).title, '简介格式不合法')
})

test('saves profile directly and navigates back', async () => {
  const requestResult = {
    nickName: '技术派',
    avatarUrl: 'https://example.com/avatar.png',
    profile: 'Java 与 AI',
  }
  const { page, calls } = loadPage({ requestResult })

  page.setData({ nickName: ' 技术派 ', profile: ' Java 与 AI ' })
  await page.saveProfile()

  assert.equal(calls.request.length, 1)
  assert.equal(calls.request[0].url, '/mini/api/user/profile')
  assert.equal(calls.request[0].method, 'POST')
  assert.equal(calls.request[0].data.nickName, '技术派')
  assert.equal(calls.request[0].data.profile, 'Java 与 AI')
  assert.equal(calls.persistUser.length, 1)
  assert.equal(calls.persistUser[0].nickName, requestResult.nickName)
  assert.equal(calls.persistUser[0].avatarUrl, requestResult.avatarUrl)
  assert.equal(calls.persistUser[0].profile, requestResult.profile)
  assert.equal(calls.navigateBack, 1)
})
