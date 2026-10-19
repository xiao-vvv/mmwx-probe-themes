import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, ChevronDown, LoaderCircle, Palette, RefreshCw } from 'lucide-react'
import type { ThemeName } from './types'
import './nezha-dash-frame.css'

const THEME_OPTIONS: { value: ThemeName; label: string }[] = [
  { value: 'premium', label: 'Premium' },
  { value: 'ran', label: '岚 · Ran' },
  { value: 'nezha-dash', label: 'Nezha Dash' },
  { value: 'nezha-beauty', label: 'Nezha 美化' },
]

const THEME_NAMES = new Set<ThemeName>(THEME_OPTIONS.map((option) => option.value))

function isThemeName(value: unknown): value is ThemeName {
  return typeof value === 'string' && THEME_NAMES.has(value as ThemeName)
}

type NezhaDashFrameProps = {
  variant: Extract<ThemeName, 'nezha-dash' | 'nezha-beauty'>
  value: ThemeName | null
  onThemeChange: (name: ThemeName | null) => void
}

type FrameStatus = 'loading' | 'ready' | 'error'

const FRAME_DETAILS = {
  'nezha-dash': {
    label: 'Nezha Dash',
    source: '/themes/nezha-dash/index.html',
  },
  'nezha-beauty': {
    label: 'Nezha 美化',
    source: '/themes/nezha-dash/index.html?skin=beauty',
  },
} as const

export function NezhaDashFrame({ variant, value, onThemeChange }: NezhaDashFrameProps) {
  const [open, setOpen] = useState(false)
  const [frameState, setFrameState] = useState<{ variant: typeof variant; status: FrameStatus }>({
    variant,
    status: 'loading',
  })
  const [frameKey, setFrameKey] = useState(0)
  const frameRef = useRef<HTMLIFrameElement>(null)
  const frameVariantRef = useRef(variant)
  const switcherRef = useRef<HTMLDivElement>(null)
  const frameStatus = frameState.variant === variant ? frameState.status : 'loading'
  const frameDetails = FRAME_DETAILS[variant]

  const attachFrame = useCallback((frame: HTMLIFrameElement | null) => {
    frameRef.current = frame
    if (frame) frameVariantRef.current = variant
  }, [variant])

  const pick = useCallback((name: ThemeName | null) => {
    setOpen(false)
    onThemeChange(name)
  }, [onThemeChange])

  useEffect(() => {
    if (!open) return
    const handlePointerDown = (event: MouseEvent) => {
      if (!switcherRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [open])

  useEffect(() => {
    setFrameState((current) => current.variant === variant
      ? current
      : { variant, status: 'loading' })
  }, [variant])

  useEffect(() => {
    if (frameStatus !== 'loading') return
    const timeout = window.setTimeout(() => {
      setFrameState((current) => current.variant === variant
        ? { ...current, status: 'error' }
        : current)
    }, 15_000)
    return () => window.clearTimeout(timeout)
  }, [frameStatus, variant])

  useEffect(() => {
    const handleMessage = (event: MessageEvent<unknown>) => {
      if (event.source !== frameRef.current?.contentWindow || event.origin !== window.location.origin) return
      if (!event.data || typeof event.data !== 'object') return

      const message = event.data as { type?: unknown; theme?: unknown; value?: unknown }
      if (message.type === 'mmwx-nezha-dash-ready') {
        setFrameState({ variant: frameVariantRef.current, status: 'ready' })
        return
      }
      if (message.type !== 'mmwx-theme-change') return
      const requestedTheme = Object.hasOwn(message, 'theme') ? message.theme : message.value
      if (requestedTheme === null || isThemeName(requestedTheme)) pick(requestedTheme)
    }

    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [pick])

  const retry = () => {
    setFrameState({ variant, status: 'loading' })
    setFrameKey((current) => current + 1)
  }

  return (
    <main className="nezha-dash-frame" aria-busy={frameStatus === 'loading'}>
      <iframe
        key={`${variant}:${frameKey}`}
        ref={attachFrame}
        className="nezha-dash-frame__iframe"
        src={frameDetails.source}
        title={`${frameDetails.label}服务器监控主题`}
        onLoad={() => frameRef.current?.contentWindow?.postMessage(
          { type: 'mmwx-nezha-dash-ping' },
          window.location.origin,
        )}
        onError={() => setFrameState({ variant, status: 'error' })}
      />
      {frameStatus !== 'ready' && (
        <div
          className="nezha-dash-frame__status"
          role={frameStatus === 'error' ? 'alert' : 'status'}
        >
          {frameStatus === 'loading' ? (
            <>
              <LoaderCircle className="nezha-dash-frame__spinner" size={22} aria-hidden="true" />
              <span>正在加载 {frameDetails.label}主题…</span>
            </>
          ) : (
            <>
              <strong>{frameDetails.label}主题加载失败</strong>
              <span>请稍后重试，或切换到其他主题。</span>
              <button type="button" onClick={retry}>
                <RefreshCw size={15} aria-hidden="true" />
                <span>重新加载</span>
              </button>
            </>
          )}
        </div>
      )}
      {/* 就绪后主题会在自己的按钮排里渲染切换器(SiteThemeSwitch);
          父层浮钮只在加载/出错时兜底, 保证主题挂了也能切走 */}
      {frameStatus !== 'ready' && (
      <div
        className={`nezha-dash-frame__switcher ${variant === 'nezha-beauty' ? 'is-beauty' : 'is-farm'}`}
        ref={switcherRef}
      >
        <button
          type="button"
          className="nezha-dash-frame__trigger"
          aria-haspopup="listbox"
          aria-expanded={open}
          onClick={() => setOpen((current) => !current)}
        >
          <Palette size={16} aria-hidden="true" />
          <span>切换主题</span>
          <ChevronDown className={open ? 'is-open' : ''} size={14} aria-hidden="true" />
        </button>
        {open && (
          <div className="nezha-dash-frame__menu" role="listbox" aria-label="切换主题">
            <button
              type="button"
              role="option"
              aria-selected={value === null}
              onClick={() => pick(null)}
            >
              <span>跟随主控</span>
              {value === null && <Check size={14} aria-hidden="true" />}
            </button>
            {THEME_OPTIONS.map((option) => (
              <button
                type="button"
                role="option"
                aria-selected={value === option.value}
                key={option.value}
                onClick={() => pick(option.value)}
              >
                <span>{option.label}</span>
                {value === option.value && <Check size={14} aria-hidden="true" />}
              </button>
            ))}
          </div>
        )}
      </div>
      )}
    </main>
  )
}
