#!/usr/bin/env node
/* 联网 / 离线开关的自测（不需要 uTools，也不需要浏览器）
   · fetchFavicon 的「仅本地」闸门：online === false 时一个请求都不能发
   · preload 末尾的 contextBridge 日志守卫：contextIsolation 关闭导致的那种
     "预期失败" 不能再往 plugin.log 里写一行

   为什么用 extract + new Function 而不是 require('../preload.js')：
   preload 顶层会碰 window / electron / utools，直接在 Node 里 require 会抛错，
   而且有些分支会往用户的真实数据目录写日志。这里只把待测函数的源码抽出来跑，
   外部依赖（request / parseIconLinks / guessMime）用桩注入。

   用法：node tools/offline-test.js
*/
'use strict'

const fs = require('fs')
const path = require('path')

const PRELOAD = path.join(__dirname, '..', 'preload.js')
const src = fs.readFileSync(PRELOAD, 'utf8')

let pass = 0
let fail = 0
function ok (name, cond, extra) {
  if (cond) {
    pass++
    console.log('PASS  ' + name + (extra ? '  [' + extra + ']' : ''))
  } else {
    fail++
    console.log('FAIL  ' + name + (extra ? '  [' + extra + ']' : ''))
  }
}

/* ---------- 1. 抽出真实的 fetchFavicon 源码 ---------- */

function sliceFunction (source, header) {
  const start = source.indexOf(header)
  if (start < 0) throw new Error('源码里找不到：' + header)
  // 从函数头往后逐行找第一个顶格的 "}"（本文件的函数都按顶格收尾）
  let i = source.indexOf('\n', start)
  while (i >= 0) {
    const next = source.indexOf('\n', i + 1)
    const line = source.slice(i + 1, next < 0 ? source.length : next)
    if (line === '}') return source.slice(start, i + 2)
    if (next < 0) break
    i = next
  }
  throw new Error('没找到函数结尾：' + header)
}

const callLog = []
const stubRequest = async (url, opts) => {
  callLog.push({ url: url, opts: opts })
  return { ok: false, status: 0, error: 'stub: 测试里不发真实请求' }
}
const stubParseIconLinks = () => []
const stubGuessMime = () => 'image/x-icon'

const body = sliceFunction(src, 'async function fetchFavicon (')
const factory = new Function(
  'request', 'parseIconLinks', 'guessMime',
  body + '\nreturn fetchFavicon'
)
const fetchFavicon = factory(stubRequest, stubParseIconLinks, stubGuessMime)

/* ---------- 2. 「仅本地」闸门 ---------- */

async function main () {
  callLog.length = 0
  const off = await fetchFavicon('https://example.com', { online: false })
  ok('offline-blocks-all-requests', callLog.length === 0, 'requests=' + callLog.length)
  ok('offline-returns-not-ok', off && off.ok === false)
  ok('offline-flags-itself', off && off.offline === true)

  callLog.length = 0
  const withService = await fetchFavicon('https://example.com', {
    online: false, service: 'https://favicon.im/{domain}'
  })
  ok('offline-blocks-service-template-too', callLog.length === 0, 'requests=' + callLog.length)
  ok('offline-with-service-still-not-ok', withService && withService.ok === false)

  callLog.length = 0
  await fetchFavicon('https://example.com', { online: true })
  ok('online-does-request', callLog.length > 0, 'requests=' + callLog.length)
  ok('online-request-targets-the-page', callLog.length > 0 && callLog[0].url === 'https://example.com/',
    callLog.length ? callLog[0].url : 'none')

  callLog.length = 0
  await fetchFavicon('https://example.com', {})
  ok('default-is-online', callLog.length > 0, 'requests=' + callLog.length)

  // 参数整体缺省也要当成联网（老数据没有这个设置项时不能突然变哑巴）
  callLog.length = 0
  await fetchFavicon('https://example.com')
  ok('missing-options-is-online', callLog.length > 0, 'requests=' + callLog.length)

  /* ---------- 3. contextBridge 日志守卫（静态检查） ---------- */

  const exposeIdx = src.indexOf('exposeInMainWorld')
  ok('preload-still-exposes-services', exposeIdx > 0)
  const tail = src.slice(exposeIdx)
  const catchIdx = tail.indexOf('catch')
  const catchBlock = catchIdx >= 0 ? tail.slice(catchIdx, catchIdx + 320) : ''
  ok('catch-guards-on-contextIsolation', /contextIsolation/i.test(catchBlock),
    catchBlock ? catchBlock.split('\n')[1].trim() : 'no catch block')
  ok('catch-does-not-log-unconditionally',
    !/catch\s*\(e\)\s*\{\s*log\(/.test(catchBlock.replace(/\s+/g, ' ')) &&
    /\bif\s*\(/.test(catchBlock),
    '有 if 守卫')

  console.log('')
  console.log(fail ? ('FAILED ' + fail + ' / ' + (pass + fail)) : ('ALL PASS  (' + pass + ' 项)'))
  process.exit(fail ? 1 : 0)
}

main().catch(e => {
  console.log('ERROR  ' + e.message)
  process.exit(1)
})
