import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import * as nodeFs from 'node:fs'
import * as crypto from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'

function cleanOldAssets(): Plugin {
  return {
    name: 'clean-old-assets',
    async writeBundle(_options, bundle) {
      const fs = await import('fs/promises')
      const outDir = path.resolve(__dirname, '../deploy')
      const assetsDir = path.join(outDir, 'assets')
      const emitted = new Set<string>(Object.keys(bundle))
      const files = await fs.readdir(assetsDir).catch(() => [] as string[])
      for (const file of files) {
        if (!file.match(/-[A-Za-z0-9_-]+\.(js|css)$/)) continue
        if (!emitted.has(`assets/${file}`)) {
          await fs.unlink(path.join(assetsDir, file))
        }
      }
    },
  }
}

// ---------- 本地开发态 API ----------
// 后端是 Cloudflare Pages Functions（public/_worker.js），依赖 D1 等云端绑定，Vite dev 无法直接运行。
// 此插件仅在 vite dev 下挂载 /api 路由：
//   1. 未配置 LOCAL_API_TARGET：内置本地 Mock，真实实现注册/登录/会话，账号存 .local-dev-api/users.json
//   2. 配置 LOCAL_API_TARGET：把 /api 请求同源代理到真实后端，绕开浏览器跨域限制
// 生产构建不会加载此插件，业务代码零改动。

interface DevUser {
  id: number
  username: string
  email: string
  passwordHash: string
  salt: string
  role: 'super_admin' | 'admin' | 'guest'
  createdAt: string
}

interface DevState {
  seq: number
  users: DevUser[]
}

const DEV_JWT_SECRET = 'xinblog-local-dev-only-secret'

function sendJson(res: ServerResponse, code: number, data: unknown, msg = 'ok'): void {
  res.statusCode = 200
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Headers', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS')
  res.end(JSON.stringify({ code, data, msg }))
}

async function readRawBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)))
  }
  return Buffer.concat(chunks)
}

async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const raw = await readRawBody(req)
  if (raw.length === 0) return {}
  try {
    const parsed = JSON.parse(raw.toString('utf8')) as unknown
    return parsed !== null && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

function field(body: Record<string, unknown>, key: string): string {
  const value = body[key]
  return typeof value === 'string' ? value.trim() : ''
}

function hashPassword(password: string, salt: string): string {
  return crypto.scryptSync(password, salt, 64).toString('hex')
}

function checkPassword(password: string, user: DevUser): boolean {
  const expected = Buffer.from(user.passwordHash, 'hex')
  const actual = Buffer.from(hashPassword(password, user.salt), 'hex')
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual)
}

// 前端 authStore.checkAuth() 用 atob() 解析 payload，因此这里用标准 base64（非 base64url）
function signToken(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64')
  const body = Buffer.from(JSON.stringify(payload)).toString('base64')
  const sig = crypto.createHmac('sha256', DEV_JWT_SECRET).update(`${header}.${body}`).digest('base64url')
  return `${header}.${body}.${sig}`
}

function decodeToken(token: string): Record<string, unknown> | null {
  const parts = token.split('.')
  if (parts.length !== 3) return null
  const [header, body, sig] = parts
  const expected = crypto.createHmac('sha256', DEV_JWT_SECRET).update(`${header}.${body}`).digest('base64url')
  if (sig !== expected) return null
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64').toString('utf8')) as Record<string, unknown>
    if (typeof payload.exp === 'number' && payload.exp < Math.floor(Date.now() / 1000)) return null
    return payload
  } catch {
    return null
  }
}

function issueTokens(user: DevUser) {
  const nowSec = Math.floor(Date.now() / 1000)
  return {
    accessToken: signToken({ sub: user.id, username: user.username, role: user.role, type: 'access', iat: nowSec, exp: nowSec + 48 * 3600 }),
    refreshToken: signToken({ sub: user.id, type: 'refresh', jti: crypto.randomUUID(), iat: nowSec, exp: nowSec + 30 * 24 * 3600 }),
  }
}

function publicUser(user: DevUser) {
  return { id: String(user.id), username: user.username, email: user.email, avatar: undefined, role: user.role }
}

async function proxyRequest(req: IncomingMessage, res: ServerResponse, url: string, target: string): Promise<void> {
  const base = target.endsWith('/') ? target : `${target}/`
  const upstreamUrl = new URL(url, base)
  const headers: Record<string, string> = {}
  const skip = new Set(['host', 'connection', 'content-length', 'accept-encoding', 'origin', 'referer'])
  for (const [key, value] of Object.entries(req.headers)) {
    if (typeof value === 'string' && !skip.has(key.toLowerCase())) headers[key] = value
  }
  const method = req.method || 'GET'
  const raw = method === 'GET' || method === 'HEAD' ? null : await readRawBody(req)
  const upstream = await fetch(upstreamUrl, {
    method,
    headers,
    ...(raw && raw.length > 0 ? { body: new Uint8Array(raw) } : {}),
  })
  const content = Buffer.from(await upstream.arrayBuffer())
  res.statusCode = upstream.status
  const contentType = upstream.headers.get('content-type')
  if (contentType) res.setHeader('Content-Type', contentType)
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.end(content)
}

function localDevApi(options: { root: string; target?: string }): Plugin {
  const { root, target } = options
  const dataDir = path.join(root, '.local-dev-api')
  const dataFile = path.join(dataDir, 'users.json')

  const loadState = (): DevState => {
    try {
      const parsed = JSON.parse(nodeFs.readFileSync(dataFile, 'utf8')) as DevState
      if (Array.isArray(parsed.users) && typeof parsed.seq === 'number') return parsed
    } catch {
      // 首次运行或数据文件损坏时回退到空库
    }
    return { seq: 1, users: [] }
  }

  const saveState = (state: DevState): void => {
    nodeFs.mkdirSync(dataDir, { recursive: true })
    nodeFs.writeFileSync(dataFile, JSON.stringify(state, null, 2), 'utf8')
  }

  const handle = async (req: IncomingMessage, res: ServerResponse, url: string): Promise<void> => {
    const { pathname } = new URL(url, 'http://localhost')
    const method = (req.method || 'GET').toUpperCase()

    if (method === 'OPTIONS') {
      sendJson(res, 0, null)
      return
    }
    if (target) {
      await proxyRequest(req, res, url, target)
      return
    }

    const body = method === 'GET' || method === 'HEAD' ? {} : await readJsonBody(req)

    // 只读接口返回空数据，保证首页与登录页正常渲染
    if (method === 'GET') {
      if (pathname === '/api/v1/site') {
        sendJson(res, 0, { site: {} })
        return
      }
      if (pathname === '/api/v1/tags') {
        sendJson(res, 0, [])
        return
      }
      if (pathname === '/api/v1/posts') {
        sendJson(res, 0, { list: [], total: 0, page: 1, limit: 10 })
        return
      }
      if (pathname === '/api/v1/user/settings') {
        sendJson(res, 0, { theme: null, ui: null })
        return
      }
      if (pathname === '/api/v1/settings/auth') {
        sendJson(res, 0, {
          allowRegister: true,
          emailVerification: false,
          enableForgotPassword: false,
          loginVerification: false,
          registerVerification: false,
          forgotPasswordVerification: false,
          verificationMode: 'none',
          turnstileSiteKey: '',
          turnstileSecret: '',
          geetestCaptchaId: '',
          geetestCaptchaKey: '',
          hcaptchaSiteKey: '',
          hcaptchaSecret: '',
        })
        return
      }
      if (pathname === '/api/v1/auth/captcha/config') {
        sendJson(res, 0, {
          mode: 'none',
          loginRequired: false,
          registerRequired: false,
          forgotRequired: false,
          turnstileSiteKey: '',
          geetestCaptchaId: '',
          hcaptchaSiteKey: '',
        })
        return
      }
    }

    // 注册（对齐 public/_worker.js 的校验与响应结构）
    if (pathname === '/api/v1/auth/register' && method === 'POST') {
      const username = field(body, 'username')
      const password = typeof body.password === 'string' ? body.password : ''
      const email = field(body, 'email')
      if (!username || !password) {
        sendJson(res, 400, null, '用户名和密码必填')
        return
      }
      if (/[\u4e00-\u9fa5]/.test(username)) {
        sendJson(res, 400, null, '用户名不能包含中文')
        return
      }
      if (password.length < 6) {
        sendJson(res, 400, null, '密码至少 6 位')
        return
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        sendJson(res, 400, null, '邮箱格式不正确')
        return
      }
      const state = loadState()
      if (state.users.some((u) => u.username.toLowerCase() === username.toLowerCase() || u.email.toLowerCase() === email.toLowerCase())) {
        sendJson(res, 409, null, '用户名或邮箱已存在')
        return
      }
      const salt = crypto.randomBytes(16).toString('hex')
      const role: DevUser['role'] = state.users.length === 0 ? 'super_admin' : 'guest'
      const user: DevUser = {
        id: state.seq,
        username,
        email,
        passwordHash: hashPassword(password, salt),
        salt,
        role,
        createdAt: new Date().toISOString(),
      }
      state.users.push(user)
      state.seq += 1
      saveState(state)
      sendJson(res, 0, { id: user.id, username: user.username, role: user.role }, '注册成功')
      return
    }

    if (pathname === '/api/v1/auth/login' && method === 'POST') {
      const account = field(body, 'username').toLowerCase()
      const password = typeof body.password === 'string' ? body.password : ''
      const state = loadState()
      const user = state.users.find((u) => u.username.toLowerCase() === account || u.email.toLowerCase() === account)
      if (!user || !checkPassword(password, user)) {
        sendJson(res, 401, null, '用户名或密码错误')
        return
      }
      sendJson(res, 0, { ...issueTokens(user), user: publicUser(user) })
      return
    }

    if (pathname === '/api/v1/auth/refresh' && method === 'POST') {
      const payload = decodeToken(field(body, 'refreshToken'))
      const user = payload && payload.type === 'refresh'
        ? loadState().users.find((u) => String(u.id) === String(payload.sub))
        : undefined
      if (!payload || !user) {
        sendJson(res, 401, null, '登录已过期，请重新登录')
        return
      }
      sendJson(res, 0, { ...issueTokens(user), user: publicUser(user) })
      return
    }

    if (pathname === '/api/v1/auth/logout' && method === 'POST') {
      sendJson(res, 0, null)
      return
    }

    if (pathname === '/api/v1/auth/captcha/math' && method === 'POST') {
      const a = crypto.randomInt(1, 10)
      const b = crypto.randomInt(1, 10)
      const token = signToken({ type: 'math', answer: a + b, exp: Math.floor(Date.now() / 1000) + 300 })
      sendJson(res, 0, { question: `${a} + ${b} = ?`, token })
      return
    }

    if ((pathname === '/api/v1/auth/verify-code' || pathname === '/api/v1/auth/forgot-code') && method === 'POST') {
      sendJson(res, 400, null, '本地开发态不发送邮件，邮箱验证默认已关闭')
      return
    }

    if (pathname === '/api/v1/auth/reset-password' && method === 'POST') {
      const username = field(body, 'username').toLowerCase()
      const email = field(body, 'email').toLowerCase()
      const password = typeof body.password === 'string' ? body.password : ''
      const state = loadState()
      const user = state.users.find((u) => u.username.toLowerCase() === username && u.email.toLowerCase() === email)
      if (!user || password.length < 6) {
        sendJson(res, 400, null, '用户不存在或密码不足 6 位')
        return
      }
      user.passwordHash = hashPassword(password, user.salt)
      saveState(state)
      sendJson(res, 0, null, '密码已重置，请使用新密码登录')
      return
    }

    // 其余接口返回结构化 JSON，避免前端出现「请求失败，HTTP 404」
    sendJson(res, 404, null, `本地开发态未实现该接口：${method} ${pathname}（可设置 LOCAL_API_TARGET 接入真实后端）`)
  }

  return {
    name: 'local-dev-api',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url || ''
        if (!url.startsWith('/api/')) {
          next()
          return
        }
        void handle(req, res, url).catch((err: unknown) => {
          sendJson(res, 500, null, `本地开发态 API 异常：${err instanceof Error ? err.message : String(err)}`)
        })
      })
    },
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  return {
    plugins: [react(), localDevApi({ root: __dirname, target: env.LOCAL_API_TARGET || undefined }), cleanOldAssets()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    server: {
      port: 5173,
      host: true,
    },
    build: {
      outDir: '../deploy',
      emptyOutDir: false,
    },
  }
})
