import { useSyncExternalStore } from 'react'
import type { ProbeAppearance, ProbePayload, ProbeServer, ThemeName } from './types'

const APPEARANCE_CACHE = 'mmwx-probe-appearance'
const DARK_OVERRIDE = 'mmwx-probe-dark-override'
const THEME_OVERRIDE = 'mmwx-probe-theme-override'
// 全站默认主题(Worker KV 下发的本地缓存): 优先级 本机手动 override > 全站默认 > 主控 appearance
const SITE_DEFAULT_THEME = 'mmwx-probe-site-default-theme'
// 站长管理密钥: 持有它的浏览器切主题时会同步写全站默认(经 /?theme-admin=KEY 引导存入)
const THEME_ADMIN_KEY = 'mmwx-probe-theme-admin-key'

// ===== 日流量跨周期历史(浏览器本地缓存, 保留 90 天) =====
// 主控 daily_traffic 只含当前重置周期, 重置即清零 → 前端把每次 payload 合并进
// localStorage, 过重置日后流量趋势图仍保留历史(换设备/清缓存会丢, 零服务端依赖)。
const LOCAL_HIST_KEY = 'probe-daily-traffic-v1'
const LOCAL_HIST_DAYS = 90

type DailyHistory = Record<string, Record<string, [number, number, number]>>
type DailyRow = NonNullable<ProbeServer['daily_traffic']>[number]
export type EnrichedServer = ProbeServer & { cycle_daily_traffic?: DailyRow[] }

function loadLocalHistory(): DailyHistory | null {
  try {
    const raw = localStorage.getItem(LOCAL_HIST_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as DailyHistory
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}

function persistLocalHistory(history: DailyHistory): void {
  const cutoff = new Date(Date.now() - LOCAL_HIST_DAYS * 86400 * 1000).toISOString().slice(0, 10)
  for (const name of Object.keys(history)) {
    for (const date of Object.keys(history[name])) {
      if (date < cutoff) delete history[name][date]
    }
    if (!Object.keys(history[name]).length) delete history[name]
  }
  try {
    localStorage.setItem(LOCAL_HIST_KEY, JSON.stringify(history))
  } catch {
    // 存储满/隐私模式忽略
  }
}

// 合并: 历史(按服务器名) 为底, payload 当天数据覆盖(最新值), 按日期排序。
// 附加 cycle_daily_traffic = payload 原始周期内数据(周期拆分比例用, 避免被 90 天历史污染)
function mergeDailyTraffic(servers: ProbeServer[], history: DailyHistory | null): EnrichedServer[] {
  if (!history || !Object.keys(history).length) return servers
  return servers.map((server) => {
    const name = server.name?.trim()
    if (!name) return server
    const byDate = new Map<string, { uplink: number; downlink: number; total: number }>()
    for (const [date, recs] of Object.entries(history)) {
      const rec = recs?.[name]
      if (rec) byDate.set(date, { uplink: rec[0], downlink: rec[1], total: rec[2] })
    }
    for (const row of server.daily_traffic || []) {
      if (row?.date) byDate.set(row.date, { uplink: row.uplink ?? 0, downlink: row.downlink ?? 0, total: row.total ?? 0 })
    }
    if (!byDate.size) return server
    const merged = [...byDate.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, rec]) => ({ date, uplink: rec.uplink, downlink: rec.downlink, total: rec.total }))
    return { ...server, daily_traffic: merged, cycle_daily_traffic: server.daily_traffic || [] }
  })
}

// 本地品牌 logo: 覆盖主控下发的 logo 字段
const LOCAL_LOGO = '/images/cat-logo.png'

// 主控 WS 流的 title 恒为空串(HTTP /api/probe 才带), 记住最后一个非空标题回填,
// 否则流一推就把站名冲回默认「服务器状态」
let lastKnownTitle = ''

// payload 到达时: 合并本地跨周期历史并写回
function enrichPayload(payload: ProbePayload): ProbePayload {
  payload = { ...payload, logo: LOCAL_LOGO }
  if (payload.title?.trim()) lastKnownTitle = payload.title
  else if (lastKnownTitle) payload = { ...payload, title: lastKnownTitle }
  if (!payload?.servers?.length) return payload
  const prev = loadLocalHistory()
  const next: DailyHistory = prev && typeof prev === 'object' ? JSON.parse(JSON.stringify(prev)) : {}
  for (const server of payload.servers) {
    const name = server.name?.trim()
    if (!name || !Array.isArray(server.daily_traffic)) continue
    next[name] = next[name] ?? {}
    for (const row of server.daily_traffic) {
      if (!row?.date) continue
      next[name][row.date] = [row.uplink ?? 0, row.downlink ?? 0, row.total ?? (row.uplink ?? 0) + (row.downlink ?? 0)]
    }
  }
  persistLocalHistory(next)
  return { ...payload, servers: mergeDailyTraffic(payload.servers, next) }
}

function isProbePayload(value: unknown): value is ProbePayload {
  if (!value || typeof value !== 'object') return false
  const payload = value as Record<string, unknown>
  if (typeof payload.enabled !== 'boolean') return false
  if (payload.servers !== undefined && !Array.isArray(payload.servers)) return false
  if (payload.appearance !== undefined) {
    if (!payload.appearance || typeof payload.appearance !== 'object') return false
    const appearance = payload.appearance as Record<string, unknown>
    if (typeof appearance.theme !== 'string') return false
    if (appearance.color_mode !== undefined &&
      appearance.color_mode !== 'light' &&
      appearance.color_mode !== 'dark' &&
      appearance.color_mode !== 'system') return false
  }
  return true
}

function normalizeTheme(value?: string): ThemeName {
  return value === 'anime' || value === 'flat' || value === 'glass' || value === 'lumina' ? value : 'pixel'
}

// 2026-08-18 下架的内置主题(像素/扁平/动漫/玻璃/lumina/glassmorphism): 选择器不再提供,
// 旧访客 localStorage 覆盖与主控下发一律回退 premium。
const RETIRED_THEMES = new Set(['pixel', 'flat', 'anime', 'glass', 'lumina', 'glassmorphism'])

// 主控下发组合名 "Lumina-Gold" / "Lumina Gold" / "LUMINAGOLD" → lumina 主题 + 黑金配色
// "Lumina-Platinum" → lumina + 白金配色(浅底暗金, license.miaomiaowu.net premium light 移植)
// "Premium-Platinum"/"Premium Light" → premium 整页主题 + 白金配色
// "Glassmorphism Light/Dark" → glassmorphism 主题 + 白天/夜间模式
export function parseThemeName(raw: string): { theme: string; gold: boolean; platinum: boolean; light?: boolean } {
  const parsed = parseThemeNameRaw(raw)
  // 下架主题统一落到 premium(lumina-platinum 保留白金配色语义)
  return RETIRED_THEMES.has(parsed.theme) ? { ...parsed, theme: 'premium' } : parsed
}

function parseThemeNameRaw(raw: string): { theme: string; gold: boolean; platinum: boolean; light?: boolean } {
  const lower = raw.toLowerCase().replace(/[\s_-]/g, '')
  if (lower === 'luminagold') return { theme: 'lumina', gold: true, platinum: false }
  if (lower === 'luminaplatinum') return { theme: 'lumina', gold: false, platinum: true }
  if (lower === 'premiumplatinum' || lower === 'premiumlight') return { theme: 'premium', gold: false, platinum: true }
  if (lower === 'glassmorphismlight') return { theme: 'glassmorphism', gold: false, platinum: false, light: true }
  if (lower === 'glassmorphismdark') return { theme: 'glassmorphism', gold: false, platinum: false, light: false }
  return { theme: isBuiltinTheme(raw.toLowerCase()) ? raw.toLowerCase() : raw, gold: false, platinum: false }
}

// 主控可能下发自定义主题名（theme-{name} 类）。内置主题走主题系统（含整页主题）；
// 未知主题名照常挂 theme-{name} 类——站长可在自己的 CSS 里写 .theme-{name} 覆盖，
// 没写则回退到默认(pixel)样式。返回值 = 是否内置主题（供 UI 判断"跟随主控"时如何显示）。
export function isBuiltinTheme(value?: string): boolean {
  return value === 'pixel' || value === 'flat' || value === 'anime' || value === 'glass' || value === 'lumina' || value === 'premium' || value === 'luminagold' || value === 'luminaplatinum' || value === 'premiumplatinum' || value === 'premiumlight' || value === 'ran' || value === 'glassmorphism' || value === 'nezha-dash' || value === 'nezha-beauty'
}

export function applyAppearance(input?: ProbeAppearance) {
  const cached = (() => {
    try {
      return JSON.parse(localStorage.getItem(APPEARANCE_CACHE) || 'null') as ProbeAppearance | null
    } catch {
      return null
    }
  })()
  const appearance = input || cached || { theme: 'pixel', color_mode: 'light' }
  const themeOverride = localStorage.getItem(THEME_OVERRIDE) as ThemeName | null
  // 用户手动选择的内置主题优先；否则用主控下发的主题名。
  // 内置主题名大小写不敏感归一化（主控可能下发 Lumina/LUMINA → lumina）；
  // 自定义主题名原样保留挂 theme-{name}（站长 CSS 怎么写就怎么匹配）。
  const raw = themeOverride || localStorage.getItem(SITE_DEFAULT_THEME) || appearance.theme || 'pixel'
  // 组合名解析: "lumina-gold" → lumina 主题 + gold 黑金配色（主控下发可直接指定黑金）
  const parsed = parseThemeName(raw)
  const theme = parsed.theme
  const root = document.documentElement
  // 清理所有 theme-* 类（含可能的自定义主题类），再挂当前主题
  for (const cls of [...root.classList]) {
    if (cls.startsWith('theme-')) root.classList.remove(cls)
  }
  // Ran 主题把 data-theme 挂在 body 上作为自身配色 tokens 的载体,
  // 这里只在切到非 Ran 主题时才清(ran 组件卸载后残留会污染其他主题文字色);
  // Ran 系主题必须保留, 否则轮询每帧清掉 data-theme 会导致 Ran 页面全白。
  if (!/^ran(-|$)/i.test(theme)) {
    document.body.removeAttribute('data-theme')
  }
  root.classList.remove('dark')
  root.classList.remove('gold')
  root.classList.remove('platinum')
  root.classList.add(`theme-${theme}`)
  const darkOverride = localStorage.getItem(DARK_OVERRIDE)
  let dark: boolean
  // premium 配色三态(auto/白金/黑金, 由 PremiumProbePage 控制 localStorage premium-probe-color-mode):
  // applyAppearance 在 WS/轮询每帧(5s)都会跑, 必须尊重三态, 否则 remove('platinum') 会冲掉
  // auto/手动白金类造成白金黑金横跳(2026-08-17 用户实测)
  if (theme === 'premium') {
    const premiumMode = localStorage.getItem('premium-probe-color-mode')
    if (premiumMode === 'platinum') {
      root.classList.add('platinum')
      dark = false
    } else if (premiumMode === 'auto') {
      const now = new Date()
      const hour = (now.getUTCHours() + 8) % 24 // 北京时间(UTC+8)
      root.classList.toggle('platinum', hour >= 6 && hour < 18)
      dark = false
    } else if (premiumMode === 'dark') {
      dark = false // premium 基础样式即黑金, 不挂 dark 类
    } else if (darkOverride === 'platinum' || (parsed.platinum && !themeOverride && !darkOverride)) {
      // 未设置三态时沿用旧逻辑: 手动 darkOverride 或主控下发 premiumplatinum → 白金
      root.classList.add('platinum')
      dark = false
    } else if (darkOverride === 'gold') {
      root.classList.add('gold')
      dark = false
    } else if (darkOverride === 'dark') {
      dark = true
    } else if (darkOverride === 'light') {
      dark = false
    } else if (appearance.color_mode === 'light') {
      // Premium 的基础 CSS 是黑金；主控 light 需要先挂白金类，避免页面加载时短暂闪黑。
      root.classList.add('platinum')
      dark = false
    } else {
      dark = appearance.color_mode === 'dark' ||
        (appearance.color_mode === 'system' && matchMedia('(prefers-color-scheme: dark)').matches)
    }
  } else if (darkOverride === 'gold' || (parsed.gold && !themeOverride && !darkOverride)) {
    // 黑金配色（lumina 第三配色）: 不挂 dark, 挂 gold。
    // 手动 override 为 gold，或主控下发组合名且用户从未手动干预（主题/配色都没选过）才进入。
    // 用户一旦手动切过配色（darkOverride 任意值），主控的 gold 不再强制，尊重用户选择。
    root.classList.add('gold')
    dark = false
  } else if (darkOverride === 'platinum' || (parsed.platinum && !themeOverride && !darkOverride)) {
    // 白金配色（lumina 第四配色 / premium 第二配色, license.miaomiaowu.net premium light 移植）:
    // 浅底暗金。机制与 gold 一致。
    root.classList.add('platinum')
    dark = false
  } else if (darkOverride === 'dark') {
    dark = true
  } else if (darkOverride === 'light') {
    dark = false
  } else {
    dark = appearance.color_mode === 'dark' ||
      (appearance.color_mode === 'system' && matchMedia('(prefers-color-scheme: dark)').matches)
  }
  if (dark) root.classList.add('dark')
  // Glassmorphism 明暗下发: 写 master 缓存, GmApp 初始化时读取(用户手动切换优先)
  if (parsed.light !== undefined) {
    localStorage.setItem('gm-color-mode-master', parsed.light ? 'light' : 'dark')
  }
  root.dataset.themeReady = 'true'
  if (input) localStorage.setItem(APPEARANCE_CACHE, JSON.stringify(input))
}

export function getDarkOverride(): string | null {
  return localStorage.getItem(DARK_OVERRIDE)
}

export function setDarkOverride(mode: 'dark' | 'light' | 'gold' | 'platinum' | null) {
  if (mode) {
    localStorage.setItem(DARK_OVERRIDE, mode)
  } else {
    localStorage.removeItem(DARK_OVERRIDE)
  }
  applyAppearance()
}

const THEME_CYCLE: ThemeName[] = ['premium', 'ran', 'nezha-dash', 'nezha-beauty']

export function getThemeOverride(): ThemeName | null {
  const stored = localStorage.getItem(THEME_OVERRIDE) as ThemeName | null
  if (stored && RETIRED_THEMES.has(stored)) {
    // 旧访客手动选过已下架主题: 清掉覆盖, 回到"跟随主控"
    localStorage.removeItem(THEME_OVERRIDE)
    return null
  }
  return stored
}

// 当前生效主题: 用户手动 override 优先，否则主控下发的 theme（内置名归一化小写，自定义名原样）。
// 视图分支（如 theme==='lumina' 渲染 ServerCardLumina）应读这个，而不是只看 override。
export function getActiveTheme(): string {
  const override = getThemeOverride()
  if (override) return override
  const siteDefault = localStorage.getItem(SITE_DEFAULT_THEME)
  if (siteDefault) return parseThemeName(siteDefault).theme
  try {
    const cached = JSON.parse(localStorage.getItem(APPEARANCE_CACHE) || 'null') as ProbeAppearance | null
    return parseThemeName(cached?.theme || 'premium').theme
  } catch {
    return 'premium'
  }
}

export function cycleTheme(): ThemeName | null {
  const current = getThemeOverride()
  if (!current) {
    localStorage.setItem(THEME_OVERRIDE, 'pixel')
    applyAppearance()
    return 'pixel'
  }
  const idx = THEME_CYCLE.indexOf(current)
  if (idx < 0 || idx >= THEME_CYCLE.length - 1) {
    localStorage.removeItem(THEME_OVERRIDE)
    applyAppearance()
    return null
  }
  const next = THEME_CYCLE[idx + 1]
  localStorage.setItem(THEME_OVERRIDE, next)
  applyAppearance()
  return next
}

export function setTheme(name: ThemeName | null): ThemeName | null {
  if (name) {
    localStorage.setItem(THEME_OVERRIDE, name)
  } else {
    localStorage.removeItem(THEME_OVERRIDE)
  }
  applyAppearance()
  // 站长浏览器(持有管理密钥): 手动切到哪个主题, 哪个就同步成全站默认;
  // 选「跟随主控」则清掉全站默认。普通访客无密钥, 只影响本机。
  const adminKey = localStorage.getItem(THEME_ADMIN_KEY)
  if (adminKey) {
    void fetch('/api/default-theme', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Theme-Admin-Key': adminKey },
      body: JSON.stringify({ theme: name }),
    })
      .then((response) => {
        if (!response.ok) return
        if (name) localStorage.setItem(SITE_DEFAULT_THEME, name)
        else localStorage.removeItem(SITE_DEFAULT_THEME)
      })
      .catch(() => {
        // 同步失败不影响本机切换
      })
  }
  return name
}

// 启动时从 Worker KV 拉全站默认主题; 变化时重新应用外观(本机 override 仍最优先)
export async function syncSiteDefaultTheme(): Promise<void> {
  try {
    const response = await fetch('/api/default-theme')
    if (!response.ok) return
    const body = (await response.json()) as { theme?: string | null }
    const next = typeof body.theme === 'string' && body.theme ? body.theme : null
    const prev = localStorage.getItem(SITE_DEFAULT_THEME)
    if (next) localStorage.setItem(SITE_DEFAULT_THEME, next)
    else localStorage.removeItem(SITE_DEFAULT_THEME)
    if (next !== prev) applyAppearance()
  } catch {
    // 拉取失败沿用本地缓存
  }
}

// 站长密钥引导: 访问 /?theme-admin=KEY 后存入本机并从地址栏抹掉
export function bootstrapThemeAdminKey(): void {
  const params = new URLSearchParams(window.location.search)
  const key = params.get('theme-admin')
  if (!key) return
  localStorage.setItem(THEME_ADMIN_KEY, key)
  params.delete('theme-admin')
  const query = params.toString()
  history.replaceState(null, '', window.location.pathname + (query ? `?${query}` : '') + window.location.hash)
}

export type ProbeResult = { data?: ProbePayload; error?: string }

const POLL_INTERVAL_MS = 5000
const STREAM_STALE_MS = 15_000
const RECONNECT_DELAY_MS = 3000

let probeSnapshot: ProbeResult = {}
let stopProbeConnection: (() => void) | undefined
let deferredStop: number | undefined
const probeListeners = new Set<() => void>()

function publishProbe(next: ProbeResult) {
  probeSnapshot = next
  for (const listener of probeListeners) listener()
}

function startProbeConnection(): () => void {
  let stopped = false
  let ws: WebSocket | undefined
  let pollTimer: number | undefined
  let reconnectTimer: number | undefined
  let lastStreamUpdate = 0
  let socketStartedAt = 0
  let socketOpenedAt = 0
  let hasStreamFrame = false
  let pollInFlight: Promise<void> | undefined
  let pollAbort: AbortController | undefined

  const stopPolling = () => {
    if (pollTimer !== undefined) {
      window.clearInterval(pollTimer)
      pollTimer = undefined
    }
    // 不 abort 在途请求: 让首个 HTTP 响应跑完以学到站名(流帧 title 恒空),
    // 帧本身由 accept 前的"流已新鲜"守卫丢弃, 不会覆盖实时数据; teardown 处单独 abort
  }

  const streamFresh = () => ws?.readyState === WebSocket.OPEN &&
    hasStreamFrame && Date.now() - lastStreamUpdate <= STREAM_STALE_MS

  const accept = (payload: ProbePayload, source: 'stream' | 'poll') => {
    if (stopped) return
    if (source === 'stream') {
      hasStreamFrame = true
      lastStreamUpdate = Date.now()
      stopPolling()
    }
    applyAppearance(payload.appearance)
    const enriched = enrichPayload(payload)
    publishProbe({ data: enriched })
    if (enriched.title) document.title = enriched.title
  }

  const poll = () => {
    if (pollInFlight) return pollInFlight
    const startedAt = Date.now()
    const controller = new AbortController()
    const abortTimer = window.setTimeout(() => controller.abort(), STREAM_STALE_MS)
    pollAbort = controller
    pollInFlight = (async () => {
      try {
        const response = await fetch('/api/probe', { cache: 'no-store', signal: controller.signal })
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        const payload: unknown = await response.json()
        if (!isProbePayload(payload)) throw new Error('Invalid probe response')
        // 流帧 title 恒空: 即使本帧因流已新鲜被丢弃, 也先从 HTTP 响应学到站名供回填
        if (payload.title?.trim()) lastKnownTitle = payload.title
        // A slow fallback request must never overwrite a newer realtime frame.
        if (lastStreamUpdate > startedAt || streamFresh()) return
        accept(payload, 'poll')
      } catch (cause) {
        if (controller.signal.aborted) return
        if (!stopped && !streamFresh()) {
          publishProbe({ ...probeSnapshot, error: cause instanceof Error ? cause.message : String(cause) })
        }
      }
    })().finally(() => {
      window.clearTimeout(abortTimer)
      if (pollAbort === controller) pollAbort = undefined
      pollInFlight = undefined
    })
    return pollInFlight
  }

  const startPolling = () => {
    if (stopped || pollTimer !== undefined) return
    void poll()
    pollTimer = window.setInterval(poll, POLL_INTERVAL_MS)
  }

  let connect = () => {}
  const scheduleReconnect = () => {
    if (stopped || reconnectTimer !== undefined) return
    reconnectTimer = window.setTimeout(() => {
      reconnectTimer = undefined
      connect()
    }, RECONNECT_DELAY_MS)
  }

  connect = () => {
    if (stopped) return
    try {
      hasStreamFrame = false
      socketOpenedAt = 0
      socketStartedAt = Date.now()
      const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
      const socket = new WebSocket(`${protocol}//${location.host}/api/stream`)
      ws = socket
      socket.onopen = () => { socketOpenedAt = Date.now() }
      socket.onmessage = (event) => {
        try {
          const payload: unknown = JSON.parse(event.data)
          if (isProbePayload(payload)) accept(payload, 'stream')
        } catch { /* wait for next frame */ }
      }
      socket.onerror = () => socket.close()
      socket.onclose = () => {
        if (ws !== socket) return
        ws = undefined
        hasStreamFrame = false
        socketStartedAt = 0
        socketOpenedAt = 0
        startPolling()
        scheduleReconnect()
      }
    } catch {
      startPolling()
      scheduleReconnect()
    }
  }

  applyAppearance()
  startPolling()
  connect()

  const watchdog = window.setInterval(() => {
    const now = Date.now()
    const currentSocket = ws
    const waitingForFirstFrame = !hasStreamFrame &&
      (!socketOpenedAt || now - socketOpenedAt >= POLL_INTERVAL_MS)
    const staleStream = hasStreamFrame && now - lastStreamUpdate > STREAM_STALE_MS
    const stuckConnecting = currentSocket?.readyState === WebSocket.CONNECTING &&
      socketStartedAt > 0 && now - socketStartedAt > STREAM_STALE_MS
    if (waitingForFirstFrame || staleStream) startPolling()
    const openWithoutFrames = currentSocket?.readyState === WebSocket.OPEN &&
      socketOpenedAt > 0 && !hasStreamFrame && now - socketOpenedAt > STREAM_STALE_MS
    if (currentSocket && (stuckConnecting || staleStream || openWithoutFrames)) {
      currentSocket.close()
    }
  }, POLL_INTERVAL_MS)

  return () => {
    stopped = true
    stopPolling()
    pollAbort?.abort()
    window.clearInterval(watchdog)
    if (reconnectTimer !== undefined) window.clearTimeout(reconnectTimer)
    if (ws) {
      ws.onopen = null
      ws.onmessage = null
      ws.onerror = null
      ws.onclose = null
      ws.close()
    }
  }
}

function subscribeProbe(listener: () => void): () => void {
  probeListeners.add(listener)
  if (deferredStop !== undefined) {
    window.clearTimeout(deferredStop)
    deferredStop = undefined
  }
  if (!stopProbeConnection) stopProbeConnection = startProbeConnection()

  return () => {
    probeListeners.delete(listener)
    if (probeListeners.size || deferredStop !== undefined) return
    // React StrictMode briefly unsubscribes and immediately subscribes again in development.
    deferredStop = window.setTimeout(() => {
      deferredStop = undefined
      if (probeListeners.size) return
      stopProbeConnection?.()
      stopProbeConnection = undefined
    }, 0)
  }
}

const getProbeSnapshot = () => probeSnapshot

export function useProbe(): ProbeResult {
  return useSyncExternalStore(subscribeProbe, getProbeSnapshot, getProbeSnapshot)
}
