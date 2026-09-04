#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const DETAIL_MODULE = path.join(ROOT, 'paicoding-miniapp/src/pages/detail/detail.js');
const AUTH_MODULE = path.join(ROOT, 'paicoding-miniapp/src/utils/auth.js');
const REQUEST_MODULE = path.join(ROOT, 'paicoding-miniapp/src/utils/request.js');
const CONFIG_MODULE = path.join(ROOT, 'paicoding-miniapp/src/utils/config.js');
const moduleCache = new Map();

function ok(result) {
  return {
    statusCode: 200,
    data: {
      status: { code: 0 },
      result
    }
  };
}

function nextTick(fn) {
  setTimeout(fn, 0);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function applyPath(target, pathKey, value) {
  const parts = pathKey.split('.');
  let current = target;
  for (let i = 0; i < parts.length - 1; i += 1) {
    if (!current[parts[i]]) {
      current[parts[i]] = {};
    }
    current = current[parts[i]];
  }
  current[parts[parts.length - 1]] = value;
}

function clearModules() {
  moduleCache.clear();
}

function loadCommonJs(modulePath) {
  const resolvedPath = path.resolve(modulePath);
  if (moduleCache.has(resolvedPath)) {
    return moduleCache.get(resolvedPath).exports;
  }
  const module = { exports: {} };
  moduleCache.set(resolvedPath, module);
  const source = fs.readFileSync(resolvedPath, 'utf8');
  const moduleDir = path.dirname(resolvedPath);
  const localRequire = (request) => {
    if (!request.startsWith('.')) {
      return require(request);
    }
    const targetPath = path.resolve(moduleDir, request);
    return loadCommonJs(path.extname(targetPath) ? targetPath : `${targetPath}.js`);
  };
  const factory = vm.runInThisContext(`(function(require, module, exports, __filename, __dirname) {\n${source}\n})`, {
    filename: resolvedPath
  });
  factory(localRequire, module, module.exports, resolvedPath, moduleDir);
  return module.exports;
}

function createHarness() {
  const storage = {};
  const requestQueue = [];
  const requestCalls = [];
  const toastCalls = [];
  const previewCalls = [];
  const stopPullDownCalls = [];
  let commentSectionObserver = null;
  let loginCalls = 0;
  let pageDefinition = null;

  global.Page = (definition) => {
    pageDefinition = definition;
  };

  global.wx = {
    getAccountInfoSync() {
      return { miniProgram: { envVersion: 'develop' } };
    },
    getStorageSync(key) {
      return storage[key];
    },
    setStorageSync(key, value) {
      storage[key] = value;
    },
    removeStorageSync(key) {
      delete storage[key];
    },
    login(options) {
      loginCalls += 1;
      nextTick(() => options.success({ code: `wx-code-${loginCalls}` }));
    },
    request(options) {
      requestCalls.push(options);
      const handler = requestQueue.shift();
      if (!handler) {
        nextTick(() => options.fail({ errMsg: `unexpected request ${options.url}` }));
        return;
      }
      nextTick(() => options.success(typeof handler === 'function' ? handler(options) : handler));
    },
    showToast(options) {
      toastCalls.push(options);
    },
    previewImage(options) {
      previewCalls.push(options);
    },
    stopPullDownRefresh() {
      stopPullDownCalls.push(true);
    },
    createIntersectionObserver() {
      return {
        relativeToViewport() {
          return this;
        },
        observe(selector, callback) {
          if (selector === '#comment-section') {
            commentSectionObserver = callback;
          }
        },
        disconnect() {}
      };
    }
  };

  clearModules();
  loadCommonJs(DETAIL_MODULE);

  const page = {
    data: clone(pageDefinition.data),
    setData(patch, callback) {
      Object.keys(patch).forEach((key) => {
        applyPath(this.data, key, patch[key]);
      });
      if (typeof callback === 'function') {
        callback();
      }
    }
  };

  Object.keys(pageDefinition).forEach((key) => {
    if (key !== 'data') {
      page[key] = pageDefinition[key].bind(page);
    }
  });

  return {
    page,
    storage,
    requestQueue,
    requestCalls,
    toastCalls,
    previewCalls,
    stopPullDownCalls,
    triggerCommentSection(intersectionRatio) {
      if (commentSectionObserver) {
        commentSectionObserver({ intersectionRatio });
      }
    },
    get loginCalls() {
      return loginCalls;
    }
  };
}

async function testAiEntryLoadsDetailWithoutLogin() {
  const h = createHarness();
  h.requestQueue.push(ok({
    articleId: 101,
    title: 'AI 文章',
    praised: false,
    praiseCount: 0,
    collected: false,
    collectionCount: 0
  }), ok({ list: [], hasMore: false }));

  await h.page.onLoad({ id: '101', from: 'ai-skill' });

  assert.strictEqual(h.loginCalls, 0);
  assert.strictEqual(h.requestCalls.length, 2);
  assert.strictEqual(h.requestCalls[0].url.endsWith('/mini/api/articles/101'), true);
  assert.strictEqual(h.requestCalls[1].url.endsWith('/mini/api/articles/101/comments'), true);
  assert.strictEqual(h.page.data.fromAiSkill, true);
  assert.strictEqual(h.page.data.article.articleId, 101);
}

async function testNormalEntryLogsInBeforeDetail() {
  const h = createHarness();
  h.requestQueue.push(
    ok({ token: 'normal-token', user: { userId: 1, nickName: 'normal-user' } }),
    ok({ articleId: 102, title: '普通详情' }),
    ok({ list: [], hasMore: false })
  );

  await h.page.onLoad({ id: '102' });

  assert.strictEqual(h.loginCalls, 1);
  assert.strictEqual(h.requestCalls.length, 3);
  assert.strictEqual(h.requestCalls[0].url.endsWith('/mini/api/auth/login'), true);
  assert.strictEqual(h.requestCalls[0].method, 'POST');
  assert.strictEqual(h.requestCalls[1].url.endsWith('/mini/api/articles/102'), true);
  assert.strictEqual(h.requestCalls[1].header.Authorization, 'Bearer normal-token');
  assert.strictEqual(h.requestCalls[2].url.endsWith('/mini/api/articles/102/comments'), true);
  assert.strictEqual(h.page.data.fromAiSkill, false);
}

async function testSceneEntryLoadsDetail() {
  const h = createHarness();
  h.requestQueue.push(
    ok({ token: 'scene-token', user: { userId: 9, nickName: 'scene-user' } }),
    ok({ articleId: 115, title: '小程序码详情' }),
    ok({ list: [], hasMore: false })
  );

  await h.page.onLoad({ scene: encodeURIComponent('id=115') });

  assert.strictEqual(h.loginCalls, 1);
  assert.strictEqual(h.page.data.id, '115');
  assert.strictEqual(h.requestCalls[1].url.endsWith('/mini/api/articles/115'), true);
  assert.strictEqual(h.requestCalls[2].url.endsWith('/mini/api/articles/115/comments'), true);
  assert.strictEqual(h.page.data.article.articleId, 115);
}

async function testInvalidSceneDoesNotLoginOrRequest() {
  const h = createHarness();

  await h.page.onLoad({ scene: '%E0%A4%A' });

  assert.strictEqual(h.loginCalls, 0);
  assert.strictEqual(h.requestCalls.length, 0);
  assert.strictEqual(h.page.data.error, '文章不存在');
}

async function testAiEntryActivePraiseStillRequiresLogin() {
  const h = createHarness();
  h.requestQueue.push(
    ok({
      articleId: 103,
      title: 'AI 详情互动',
      praised: false,
      praiseCount: 0,
      collected: false,
      collectionCount: 0
    }),
    ok({ list: [], hasMore: false }),
    ok({ token: 'praise-token', user: { userId: 2, nickName: 'praise-user' } }),
    ok({ done: true }),
    ok({
      articleId: 103,
      title: 'AI 详情互动',
      praised: true,
      praiseCount: 1,
      collected: false,
      collectionCount: 0
    })
  );

  await h.page.onLoad({ id: '103', from: 'ai-skill' });
  assert.strictEqual(h.loginCalls, 0);

  await h.page.togglePraise();

  assert.strictEqual(h.loginCalls, 1);
  assert.strictEqual(h.requestCalls.length, 5);
  assert.strictEqual(h.requestCalls[2].url.endsWith('/mini/api/auth/login'), true);
  assert.strictEqual(h.requestCalls[3].url.endsWith('/mini/api/articles/103/favor?type=2'), true);
  assert.strictEqual(h.requestCalls[3].method, 'POST');
  assert.strictEqual(h.requestCalls[3].header.Authorization, 'Bearer praise-token');
  assert.strictEqual(h.requestCalls[4].url.endsWith('/mini/api/articles/103'), true);
  assert.strictEqual(h.page.data.article.praised, true);
}

async function testCollectRequiresLoginAndRefreshesDetail() {
  const h = createHarness();
  h.requestQueue.push(
    ok({
      articleId: 104,
      title: '收藏详情互动',
      praised: false,
      praiseCount: 0,
      collected: false,
      collectionCount: 0
    }),
    ok({ list: [], hasMore: false }),
    ok({ token: 'collect-token', user: { userId: 3, nickName: 'collect-user' } }),
    ok({ done: true }),
    ok({
      articleId: 104,
      title: '收藏详情互动',
      praised: false,
      praiseCount: 0,
      collected: true,
      collectionCount: 1
    })
  );

  await h.page.onLoad({ id: '104', from: 'ai-skill' });
  await h.page.toggleCollect();

  assert.strictEqual(h.loginCalls, 1);
  assert.strictEqual(h.requestCalls.length, 5);
  assert.strictEqual(h.requestCalls[3].url.endsWith('/mini/api/articles/104/favor?type=3'), true);
  assert.strictEqual(h.requestCalls[3].method, 'POST');
  assert.strictEqual(h.requestCalls[3].header.Authorization, 'Bearer collect-token');
  assert.strictEqual(h.requestCalls[4].url.endsWith('/mini/api/articles/104'), true);
  assert.strictEqual(h.page.data.article.collected, true);
  assert.strictEqual(h.page.data.article.collectionCount, 1);
}

async function testFollowAndUnfollowAuthorRequireLogin() {
  const h = createHarness();
  h.requestQueue.push(
    ok({
      articleId: 118,
      authorId: 8,
      title: '关注作者',
      followed: false
    }),
    ok({ list: [], hasMore: false }),
    ok({ token: 'follow-token', user: { userId: 9, nickName: 'follow-user' } }),
    ok({ userId: 9, nickName: 'follow-user' }),
    ok({ done: true }),
    ok({ userId: 9, nickName: 'follow-user' }),
    ok({ userId: 9, nickName: 'follow-user' }),
    ok({ done: true })
  );

  await h.page.onLoad({ id: '118', from: 'ai-skill' });
  await h.page.toggleFollow();

  assert.strictEqual(h.loginCalls, 1);
  assert.strictEqual(h.requestCalls[4].url.endsWith('/mini/api/users/8/follow'), true);
  assert.strictEqual(h.requestCalls[4].method, 'POST');
  assert.deepStrictEqual(h.requestCalls[4].data, { followed: true });
  assert.strictEqual(h.requestCalls[4].header.Authorization, 'Bearer follow-token');
  assert.strictEqual(h.page.data.article.followed, true);

  await h.page.toggleFollow();

  assert.strictEqual(h.requestCalls[7].url.endsWith('/mini/api/users/8/follow'), true);
  assert.deepStrictEqual(h.requestCalls[7].data, { followed: false });
  assert.strictEqual(h.page.data.article.followed, false);
}

async function testPraiseDoubleTapDoesNotSubmitTwice() {
  const h = createHarness();
  h.requestQueue.push(
    ok({
      articleId: 105,
      title: '点赞连点',
      praised: false,
      praiseCount: 0,
      collected: false,
      collectionCount: 0
    }),
    ok({ list: [], hasMore: false }),
    ok({ token: 'double-tap-token', user: { userId: 4, nickName: 'double-tap-user' } }),
    ok({ done: true }),
    ok({
      articleId: 105,
      title: '点赞连点',
      praised: true,
      praiseCount: 1,
      collected: false,
      collectionCount: 0
    })
  );

  await h.page.onLoad({ id: '105', from: 'ai-skill' });
  const first = h.page.togglePraise();
  const second = h.page.togglePraise();
  await Promise.all([first, second]);

  const favorCalls = h.requestCalls.filter((call) => call.url.endsWith('/mini/api/articles/105/favor?type=2'));
  assert.strictEqual(favorCalls.length, 1);
  assert.strictEqual(h.page.data.article.praised, true);
  assert.strictEqual(h.page.data.article.praiseCount, 1);
}

async function testBottomActionSwitchesAtCommentSection() {
  const h = createHarness();
  h.requestQueue.push(
    ok({ articleId: 116, title: '底栏切换' }),
    ok({ list: [], hasMore: false })
  );

  await h.page.onLoad({ id: '116', from: 'ai-skill' });

  assert.strictEqual(h.page.data.commentSectionVisible, false);
  h.triggerCommentSection(1);
  assert.strictEqual(h.page.data.commentSectionVisible, true);
  h.triggerCommentSection(0);
  assert.strictEqual(h.page.data.commentSectionVisible, false);
}

async function testArticleImagesCanPreview() {
  const h = createHarness();
  h.requestQueue.push(ok({
    articleId: 106,
    title: '图片预览',
    contentHtml: '<p>架构图</p><img src="https://cdn.paicoding.com/a.png"><img src="https://cdn.paicoding.com/a.png"><img src="/relative.png"><img src="https://cdn.paicoding.com/b.png">'
  }), ok({ list: [], hasMore: false }));

  await h.page.onLoad({ id: '106', from: 'ai-skill' });

  assert.deepStrictEqual(h.page.data.article.imageUrls, [
    'https://cdn.paicoding.com/a.png',
    'https://cdn.paicoding.com/b.png'
  ]);

  h.page.previewImage({ currentTarget: { dataset: { url: 'https://cdn.paicoding.com/b.png' } } });

  assert.strictEqual(h.previewCalls.length, 1);
  assert.strictEqual(h.previewCalls[0].current, 'https://cdn.paicoding.com/b.png');
  assert.deepStrictEqual(h.previewCalls[0].urls, h.page.data.article.imageUrls);
}

async function testCommentsLoadMore() {
  const h = createHarness();
  h.storage.PAICODING_USER = { userId: 7, nickName: 'owner' };
  h.requestQueue.push(
    ok({
      articleId: 107,
      title: '评论分页',
      commentCount: 2
    }),
    ok({
      list: [{
        commentId: 1,
        userId: 7,
        userName: '王二',
        commentContent: '第一条',
        childComments: [{ commentId: 11, userId: 8, userName: '读者', commentContent: '回复' }]
      }],
      hasMore: true
    }),
    ok({
      list: [{ commentId: 2, userName: '小派', commentContent: '第二条' }],
      hasMore: false
    })
  );

  await h.page.onLoad({ id: '107', from: 'ai-skill' });
  assert.strictEqual(h.page.data.comments.length, 1);
  assert.strictEqual(h.page.data.comments[0].userInitial, '王');
  assert.strictEqual(h.page.data.comments[0].canDelete, true);
  assert.strictEqual(h.page.data.comments[0].childComments[0].userInitial, '读');
  assert.strictEqual(h.page.data.comments[0].childComments[0].canDelete, false);
  assert.strictEqual(h.page.data.commentsHasMore, true);

  await h.page.loadMoreComments();

  assert.strictEqual(h.requestCalls[2].url.endsWith('/mini/api/articles/107/comments'), true);
  assert.strictEqual(h.requestCalls[2].data.page, 2);
  assert.strictEqual(h.page.data.comments.length, 2);
  assert.strictEqual(h.page.data.commentsHasMore, false);
}

async function testLoadMoreRepliesAppendsChildren() {
  const h = createHarness();
  h.storage.PAICODING_USER = { userId: 8, nickName: 'reader' };
  h.requestQueue.push(
    ok({
      articleId: 113,
      title: '子回复分页',
      commentCount: 4
    }),
    ok({
      list: [{
        commentId: 20,
        userId: 7,
        userName: '王二',
        commentContent: '一级评论',
        childCommentCount: 3,
        hasMoreChild: true,
        childComments: [{ commentId: 21, userId: 9, userName: '读者A', commentContent: '已加载回复' }]
      }],
      hasMore: false
    }),
    ok({
      list: [
        { commentId: 21, userId: 9, userName: '读者A', commentContent: '已加载回复' },
        { commentId: 22, userId: 8, userName: 'reader', commentContent: '第二页回复' },
        { commentId: 23, userId: 10, userName: '读者B', commentContent: '继续讨论' }
      ],
      hasMore: false
    })
  );

  await h.page.onLoad({ id: '113', from: 'ai-skill' });
  await h.page.loadMoreReplies({ currentTarget: { dataset: { top: '20' } } });

  assert.strictEqual(h.requestCalls[2].url.endsWith('/mini/api/articles/113/comments/20/children'), true);
  assert.strictEqual(h.requestCalls[2].data.page, 1);
  assert.strictEqual(h.requestCalls[2].data.size, 20);
  assert.strictEqual(h.page.data.comments[0].childComments.length, 3);
  assert.strictEqual(h.page.data.comments[0].childComments[1].commentId, 22);
  assert.strictEqual(h.page.data.comments[0].childComments[1].canDelete, true);
  assert.strictEqual(h.page.data.comments[0].hasMoreChild, false);
  assert.strictEqual(h.page.data.comments[0].childPage, 1);
}

async function testPullDownRefreshReloadsDetailAndComments() {
  const h = createHarness();
  h.page.setData({
    id: '114',
    article: {
      articleId: 114,
      title: '旧详情',
      commentCount: 1
    },
    comments: [{ commentId: 31, userName: '旧评论', commentContent: '旧内容' }],
    commentPage: 2,
    commentsHasMore: false
  });
  h.requestQueue.push(
    ok({
      articleId: 114,
      title: '刷新详情',
      commentCount: 2
    }),
    ok({
      list: [{ commentId: 32, userName: '新评论', commentContent: '新内容' }],
      hasMore: true
    })
  );

  await h.page.onPullDownRefresh();

  assert.strictEqual(h.requestCalls[0].url.endsWith('/mini/api/articles/114'), true);
  assert.strictEqual(h.requestCalls[1].url.endsWith('/mini/api/articles/114/comments'), true);
  assert.deepStrictEqual(h.requestCalls[1].data, { page: 1, size: 10 });
  assert.strictEqual(h.page.data.article.title, '刷新详情');
  assert.deepStrictEqual(h.page.data.comments.map((item) => item.commentId), [32]);
  assert.strictEqual(h.page.data.commentPage, 1);
  assert.strictEqual(h.page.data.commentsHasMore, true);
  assert.strictEqual(h.stopPullDownCalls.length, 1);
}

async function testSubmitCommentRequiresLoginAndRefreshesList() {
  const h = createHarness();
  h.requestQueue.push(
    ok({
      articleId: 108,
      title: '发表评论',
      commentCount: 0
    }),
    ok({ list: [], hasMore: false }),
    ok({ token: 'comment-token', user: { userId: 5, nickName: 'comment-user' } }),
    ok({
      list: [{ commentId: 3, userName: 'comment-user', commentContent: '写得不错' }],
      hasMore: false
    })
  );

  await h.page.onLoad({ id: '108', from: 'ai-skill' });
  h.page.onCommentInput({ detail: { value: ' 写得不错 ' } });
  await h.page.submitComment();

  assert.strictEqual(h.loginCalls, 1);
  assert.strictEqual(h.requestCalls[2].url.endsWith('/mini/api/auth/login'), true);
  assert.strictEqual(h.requestCalls[3].url.endsWith('/mini/api/articles/108/comments'), true);
  assert.strictEqual(h.requestCalls[3].method, 'POST');
  assert.strictEqual(h.requestCalls[3].header.Authorization, 'Bearer comment-token');
  assert.strictEqual(h.requestCalls[3].data.commentContent, '写得不错');
  assert.strictEqual(h.page.data.commentDraft, '');
  assert.strictEqual(h.page.data.comments.length, 1);
  assert.strictEqual(h.page.data.article.commentCount, 1);
  assert.strictEqual(h.toastCalls[h.toastCalls.length - 1].title, '评论已发布');
}

async function testReplyCommentSubmitsParentAndTopCommentIds() {
  const h = createHarness();
  h.requestQueue.push(
    ok({
      articleId: 110,
      title: '回复评论',
      commentCount: 1
    }),
    ok({
      list: [{
        commentId: 10,
        userName: '王二',
        commentContent: '一级评论',
        childComments: [{ commentId: 12, userName: '读者', commentContent: '子回复' }]
      }],
      hasMore: false
    }),
    ok({ token: 'reply-token', user: { userId: 6, nickName: 'reply-user' } }),
    ok({
      list: [{
        commentId: 10,
        userName: '王二',
        commentContent: '一级评论',
        childCommentCount: 2,
        childComments: [{ commentId: 12, userName: '读者', commentContent: '子回复' }]
      }],
      hasMore: false,
      submittedCommentId: 13
    })
  );

  await h.page.onLoad({ id: '110', from: 'ai-skill' });
  h.page.startReply({ currentTarget: { dataset: { id: '12', top: '10', name: '读者' } } });
  h.page.onReplyInput({ detail: { value: ' 同意 ' } });
  await h.page.submitComment();

  assert.deepStrictEqual(h.requestCalls[3].data, {
    commentContent: '同意',
    parentCommentId: 12,
    topCommentId: 10
  });
  assert.strictEqual(h.requestCalls[3].header.Authorization, 'Bearer reply-token');
  assert.strictEqual(h.page.data.commentReplyTarget, null);
  assert.strictEqual(h.page.data.comments[0].childComments.length, 2);
  assert.strictEqual(h.page.data.article.commentCount, 2);
}

async function testInlineReplyKeepsTopLevelDraftAndClosesOnCancel() {
  const h = createHarness();
  h.page.onCommentInput({ detail: { value: '顶部草稿' } });

  h.page.startReply({ currentTarget: { dataset: { id: '15', top: '10', name: '读者A' } } });
  h.page.onReplyInput({ detail: { value: '回复草稿' } });

  assert.strictEqual(h.page.data.commentDraft, '顶部草稿');
  assert.strictEqual(h.page.data.commentReplyTarget.parentCommentId, 15);
  assert.strictEqual(h.page.data.commentReplyTarget.topCommentId, 10);
  assert.strictEqual(h.page.data.replyDraft, '回复草稿');
  assert.strictEqual(h.page.data.replyCanSubmit, true);

  h.page.cancelReply();

  assert.strictEqual(h.page.data.commentDraft, '顶部草稿');
  assert.strictEqual(h.page.data.commentReplyTarget, null);
  assert.strictEqual(h.page.data.replyDraft, '');
  assert.strictEqual(h.page.data.replyCanSubmit, false);
}

async function testDeleteOwnCommentRequiresLoginAndRefreshesList() {
  const h = createHarness();
  h.storage.PAICODING_TOKEN = 'delete-token';
  h.storage.PAICODING_USER = { userId: 6, nickName: 'reply-user' };
  h.page.setData({
    article: {
      articleId: 111,
      title: '删除评论',
      commentCount: 3
    },
    currentUserId: 6,
    comments: [{
      commentId: 10,
      userId: 7,
      userName: '王二',
      commentContent: '一级评论',
      childCommentCount: 3,
      childPage: 1,
      childComments: [
        { commentId: 13, userId: 6, userName: 'reply-user', commentContent: '同意', canDelete: true },
        { commentId: 14, userId: 7, userName: '王二', commentContent: '保留回复' },
        { commentId: 15, userId: 8, userName: '读者', commentContent: '已展开回复' }
      ]
    }]
  });
  h.requestQueue.push(
    ok({ userId: 6, nickName: 'reply-user' }),
    ok({
      list: [{
        commentId: 10,
        userId: 7,
        userName: '王二',
        commentContent: '一级评论',
        childCommentCount: 2,
        hasMoreChild: true,
        childComments: [{ commentId: 14, userId: 7, userName: '王二', commentContent: '保留回复' }]
      }],
      hasMore: false
    })
  );

  await h.page.deleteComment({ currentTarget: { dataset: { id: '13' } } });

  assert.strictEqual(h.loginCalls, 0);
  assert.strictEqual(h.requestCalls[0].url.endsWith('/mini/api/user/me'), true);
  assert.strictEqual(h.requestCalls[1].url.endsWith('/mini/api/articles/111/comments/13/delete'), true);
  assert.strictEqual(h.requestCalls[1].method, 'POST');
  assert.strictEqual(h.requestCalls[1].header.Authorization, 'Bearer delete-token');
  assert.strictEqual(h.page.data.comments[0].childComments.length, 2);
  assert.deepStrictEqual(h.page.data.comments[0].childComments.map((item) => item.commentId), [14, 15]);
  assert.strictEqual(h.page.data.comments[0].hasMoreChild, false);
  assert.strictEqual(h.page.data.article.commentCount, 2);
  assert.strictEqual(h.toastCalls[h.toastCalls.length - 1].title, '评论已删除');
}

async function testToggleCommentPraiseRequiresLoginAndRefreshesList() {
  const h = createHarness();
  h.storage.PAICODING_TOKEN = 'comment-praise-token';
  h.storage.PAICODING_USER = { userId: 6, nickName: 'reply-user' };
  h.page.setData({
    article: {
      articleId: 112,
      title: '评论点赞',
      commentCount: 1
    },
    currentUserId: 6,
    comments: [{
      commentId: 10,
      userId: 7,
      userName: '王二',
      commentContent: '一级评论',
      childCommentCount: 2,
      childPage: 1,
      childComments: [
        { commentId: 14, userId: 7, userName: '王二', commentContent: '第一条回复', praised: false, praiseCount: 0 },
        { commentId: 15, userId: 8, userName: '读者', commentContent: '已展开回复', praised: false, praiseCount: 0 }
      ]
    }]
  });
  h.requestQueue.push(
    ok({ userId: 6, nickName: 'reply-user' }),
    ok({
      list: [{
        commentId: 10,
        userId: 7,
        userName: '王二',
        commentContent: '一级评论',
        childCommentCount: 2,
        hasMoreChild: true,
        childComments: [{
          commentId: 14,
          userId: 7,
          userName: '王二',
          commentContent: '第一条回复',
          praised: true,
          praiseCount: 1
        }]
      }],
      hasMore: false
    })
  );

  await h.page.toggleCommentPraise({ currentTarget: { dataset: { id: '14', praised: 'false' } } });

  assert.strictEqual(h.loginCalls, 0);
  assert.strictEqual(h.requestCalls[0].url.endsWith('/mini/api/user/me'), true);
  assert.strictEqual(h.requestCalls[1].url.endsWith('/mini/api/articles/112/comments/14/favor?type=2'), true);
  assert.strictEqual(h.requestCalls[1].method, 'POST');
  assert.strictEqual(h.requestCalls[1].header.Authorization, 'Bearer comment-praise-token');
  assert.strictEqual(h.page.data.comments[0].childComments.length, 2);
  assert.strictEqual(h.page.data.comments[0].childComments[0].praised, true);
  assert.strictEqual(h.page.data.comments[0].childComments[0].praiseCount, 1);
  assert.strictEqual(h.page.data.comments[0].childComments[1].commentId, 15);
  assert.strictEqual(h.page.data.comments[0].hasMoreChild, false);
}

async function testBlankCommentIsRejectedLocally() {
  const h = createHarness();
  h.requestQueue.push(
    ok({
      articleId: 109,
      title: '空评论',
      commentCount: 0
    }),
    ok({ list: [], hasMore: false })
  );

  await h.page.onLoad({ id: '109', from: 'ai-skill' });
  h.page.onCommentInput({ detail: { value: '   ' } });
  await h.page.submitComment();

  assert.strictEqual(h.loginCalls, 0);
  assert.strictEqual(h.requestCalls.length, 2);
  assert.strictEqual(h.toastCalls[h.toastCalls.length - 1].title, '请输入评论内容');
}

(async () => {
  await testAiEntryLoadsDetailWithoutLogin();
  await testNormalEntryLogsInBeforeDetail();
  await testSceneEntryLoadsDetail();
  await testInvalidSceneDoesNotLoginOrRequest();
  await testAiEntryActivePraiseStillRequiresLogin();
  await testCollectRequiresLoginAndRefreshesDetail();
  await testFollowAndUnfollowAuthorRequireLogin();
  await testPraiseDoubleTapDoesNotSubmitTwice();
  await testBottomActionSwitchesAtCommentSection();
  await testArticleImagesCanPreview();
  await testCommentsLoadMore();
  await testLoadMoreRepliesAppendsChildren();
  await testPullDownRefreshReloadsDetailAndComments();
  await testSubmitCommentRequiresLoginAndRefreshesList();
  await testReplyCommentSubmitsParentAndTopCommentIds();
  await testInlineReplyKeepsTopLevelDraftAndClosesOnCancel();
  await testDeleteOwnCommentRequiresLoginAndRefreshesList();
  await testToggleCommentPraiseRequiresLoginAndRefreshesList();
  await testBlankCommentIsRejectedLocally();
  console.log('miniapp detail page tests: ok');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
