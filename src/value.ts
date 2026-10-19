import type { ProbeServer } from './types'

export const CYCLE_DAYS = {
  month: 30,
  quarter: 90,
  half_year: 180,
  year: 365,
} as const

export interface RemainingValue {
  days: number
  cycleDays: number
  daily: number
  value: number
  currency: string
  isCny: boolean
}

export function computeRemainingValue(server: ProbeServer): RemainingValue | null {
  if (!server.expires_at || server.renewal_price === undefined) return null
  const expires = new Date(`${server.expires_at}T23:59:59`).getTime()
  const days = Math.ceil((expires - Date.now()) / 86400000)
  if (days <= 0) return null // 已过期，无剩余价值
  const cycleDays = CYCLE_DAYS[server.renewal_cycle || 'month']
  const isCny = server.renewal_price_cny !== undefined
  const price = isCny ? server.renewal_price_cny! : server.renewal_price
  const daily = price / cycleDays
  return {
    days,
    cycleDays,
    daily,
    value: daily * days,
    currency: isCny ? 'CNY' : server.renewal_currency || 'CNY',
    isCny,
  }
}

export function formatMoney(value: number, currency: string, isCny: boolean, precise = false): string {
  if (isCny) return precise ? `¥${value.toFixed(2)}` : `¥${value.toFixed(0)}`
  return `${currency} ${value.toFixed(2)}`
}
