interface Env {
  ASSETS: Fetcher
  MMWX_ORIGIN: string
  PROBE_TOKEN: string
  THEME_KV?: KVNamespace
  THEME_ADMIN_KEY?: string
}

const routes: Record<string, string> = {
  '/api/probe': '/api/public/probe-servers',
  '/api/series': '/api/public/probe-series',
  '/api/stream': '/api/public/probe-ws',
}

function upstreamURL(request: Request, env: Env): URL | null {
  const incoming = new URL(request.url)
  const path = routes[incoming.pathname]
  if (!path) return null

  const origin = new URL(env.MMWX_ORIGIN)
  if (origin.protocol !== 'https:' && origin.hostname !== '127.0.0.1' && origin.hostname !== 'localhost') {
    throw new Error('MMWX_ORIGIN must use HTTPS')
  }
  origin.pathname = path
  origin.search = incoming.search
  return origin
}

function isSameOriginRequest(request: Request, incoming: URL): boolean {
  const fetchSite = request.headers.get('Sec-Fetch-Site')
  if (fetchSite && fetchSite !== 'same-origin') return false

  const source = request.headers.get('Origin') || request.headers.get('Referer')
  if (source) {
    try {
      return new URL(source).origin === incoming.origin
    } catch {
      return false
    }
  }

  return fetchSite === 'same-origin'
}

// Vite 构建产物文件名带内容 hash (如 index.BrXXLVdo.js), 内容不变文件名不变, 可放心 immutable。
const HASHED_ASSET = /\/assets\/[^/]+[.-][A-Za-z0-9_-]{8,}\.[a-z0-9]+$/
// 无 hash 的静态资源 (twemoji 旗帜/字体/图标/背景图), 短缓存省掉逐个 revalidate 的 RTT。
const STATIC_FILE = /\.(?:png|jpe?g|webp|svg|gif|ico|woff2?|ttf)$/i

async function serveAsset(request: Request, env: Env, incoming: URL): Promise<Response> {
  const response = await env.ASSETS.fetch(request)
  if (request.method !== 'GET' || (response.status !== 200 && response.status !== 304)) return response
  // SPA fallback 会把未知路径回成 index.html, HTML 一律不改缓存头
  if (response.headers.get('Content-Type')?.includes('text/html')) return response

  let cacheControl: string | null = null
  if (HASHED_ASSET.test(incoming.pathname)) {
    cacheControl = 'public, max-age=31536000, immutable'
  } else if (STATIC_FILE.test(incoming.pathname)) {
    cacheControl = 'public, max-age=86400'
  }
  // 字体跨站可用(自家其它面板如 dstatus 直接引用本站字体; webfont 受 CORS 限制)
  const isFont = /\.(?:woff2?|ttf)$/i.test(incoming.pathname)
  if (!cacheControl && !isFont) return response

  const headers = new Headers(response.headers)
  if (cacheControl) headers.set('Cache-Control', cacheControl)
  if (isFont) {
    headers.set('Access-Control-Allow-Origin', '*')
    headers.set('Timing-Allow-Origin', '*')
  }
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const incoming = new URL(request.url)

    // 全站默认主题(KV): GET 公开读; POST 需 X-Theme-Admin-Key 匹配(站长切主题时自动同步)
    if (incoming.pathname === '/api/default-theme') {
      // 未绑定 KV: 不启用全站默认主题, 访客按主控下发的主题显示
      if (!env.THEME_KV) {
        if (request.method === 'GET') return Response.json({ theme: null }, { headers: { 'Cache-Control': 'no-store' } })
        return new Response(null, { status: 501 })
      }
      if (request.method === 'GET') {
        const theme = await env.THEME_KV.get('default-theme')
        return Response.json({ theme }, { headers: { 'Cache-Control': 'no-store' } })
      }
      if (request.method === 'POST') {
        if (!env.THEME_ADMIN_KEY || request.headers.get('X-Theme-Admin-Key') !== env.THEME_ADMIN_KEY) {
          return new Response(null, { status: 403 })
        }
        let theme: unknown
        try {
          theme = ((await request.json()) as { theme?: unknown }).theme
        } catch {
          return new Response(null, { status: 400 })
        }
        if (theme === null || theme === undefined || theme === '') {
          await env.THEME_KV.delete('default-theme')
        } else if (typeof theme === 'string' && /^[a-z0-9-]{1,32}$/.test(theme)) {
          await env.THEME_KV.put('default-theme', theme)
        } else {
          return new Response(null, { status: 400 })
        }
        return Response.json({ ok: true })
      }
      return new Response('Method not allowed', { status: 405 })
    }

    // 访客信息（Ran 主题访客浮卡用）——直接读 CF 请求头，不调用第三方
    if (incoming.pathname === '/api/visitor') {
      if (request.method !== 'GET') return new Response('Method not allowed', { status: 405 })
      const cf = request.cf
      const optionalNumber = (value: unknown): number | undefined => {
        if (typeof value !== 'string' && typeof value !== 'number') return undefined
        const parsed = Number(value)
        return Number.isFinite(parsed) ? parsed : undefined
      }
      return Response.json(
        {
          ip: request.headers.get('CF-Connecting-IP') || 'UNKNOWN',
          city: cf?.city,
          region: cf?.region,
          country: cf?.country,
          isp: cf?.asOrganization,
          lat: optionalNumber(cf?.latitude),
          lon: optionalNumber(cf?.longitude),
          risk: null,
          proxy: 'unknown',
          type: '',
        },
        {
          headers: {
            'Cache-Control': 'private, no-store',
            'Content-Type': 'application/json; charset=utf-8',
            'X-Content-Type-Options': 'nosniff',
          },
        },
      )
    }

    if (routes[incoming.pathname] && !env.MMWX_ORIGIN) {
      return new Response('MMWX_ORIGIN is not configured', { status: 503 })
    }
    const target = upstreamURL(request, env)
    if (!target) return serveAsset(request, env, incoming)
    if (request.method !== 'GET') return new Response('Method not allowed', { status: 405 })
    if (!isSameOriginRequest(request, incoming)) return new Response(null, { status: 404 })
    if (!env.PROBE_TOKEN) {
      return new Response('Probe access secret is not configured', { status: 503 })
    }

    const headers = new Headers(request.headers)
    headers.delete('cookie')
    headers.delete('authorization')
    headers.set('X-Forwarded-Host', new URL(request.url).host)
    headers.set('X-MMwx-Probe-Token', env.PROBE_TOKEN)

    const upstream = await fetch(new Request(target, { method: 'GET', headers }))
    // WebSocket 的 101 Response 必须原样返回，不能重新构造 body/headers。
    if (upstream.status === 101 || upstream.webSocket) return upstream

    const responseHeaders = new Headers(upstream.headers)
    responseHeaders.set('Cache-Control', 'no-store')
    responseHeaders.set('X-Content-Type-Options', 'nosniff')
    responseHeaders.delete('set-cookie')
    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: responseHeaders,
    })
  },
} satisfies ExportedHandler<Env>
