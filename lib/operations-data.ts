export type OperationsRange = "24h" | "7d" | "30d"

export interface OperationsTrendPoint {
  label: string
  successful: number
  failed: number
  registrations: number
}

export interface OperationsEvent {
  id: string
  time: string
  type: "blocked" | "degraded" | "recovered" | "configuration"
  title: string
  detail: string
  count: number
}

export interface OperationsSnapshot {
  mode: "demo"
  range: OperationsRange
  generatedAt: string
  tenant: {
    id: string
    name: string
    hostingCode: string
    hostingName: string
    marketCount: number
    special: boolean
  }
  metrics: {
    authentications: number
    activeUsers: number
    successRate: number
    registrationRate: number
    verificationRate: number
    mfaCoverage: number
    blockedAttempts: number
    p95Latency: number
  }
  trend: OperationsTrendPoint[]
  journeyMix: Array<{ name: string; value: number }>
  funnel: Array<{ name: string; value: number; rate: number }>
  markets: Array<{ name: string; code: string; authentications: number; successRate: number; registrations: number }>
  health: Array<{ name: string; state: "Healthy" | "Watch"; value: string; detail: string }>
  events: OperationsEvent[]
}

const RANGE_MULTIPLIER: Record<OperationsRange, number> = { "24h": 1, "7d": 6, "30d": 24 }
const REGION_FACTOR: Record<string, number> = { americas: 1.2, emea: 0.92, apac: 0.7, japan: 0.34, china: 0.5 }

const TENANT_MARKETS: Record<string, Array<[string, string, number]>> = {
  americas: [["United States", "US", 54], ["Canada", "CA", 18], ["Brazil", "BR", 14], ["Mexico", "MX", 9], ["Argentina", "AR", 5]],
  emea: [["Germany", "DE", 24], ["United Kingdom", "UK", 22], ["France", "FR", 20], ["Italy", "IT", 14], ["Spain", "ES", 12]],
  apac: [["Australia", "AU", 30], ["South Korea", "KR", 22], ["India", "IN", 20], ["Singapore", "SG", 15], ["Malaysia", "MY", 9]],
  japan: [["Japan", "JP", 100]],
  china: [["China", "CN", 100]],
}

const RANGE_LABELS: Record<OperationsRange, string[]> = {
  "24h": ["00:00", "03:00", "06:00", "09:00", "12:00", "15:00", "18:00", "21:00"],
  "7d": ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
  "30d": ["Jun 14", "Jun 18", "Jun 22", "Jun 26", "Jun 30", "Jul 4", "Jul 8", "Jul 13"],
}

function hash(value: string): number {
  return [...value].reduce((total, character) => (total * 31 + character.charCodeAt(0)) >>> 0, 17)
}

function wobble(seed: number, index: number, amplitude: number): number {
  return ((Math.sin(seed + index * 1.73) + 1) / 2 - 0.5) * amplitude
}

export function buildOperationsSnapshot(input: {
  range: OperationsRange
  tenant: OperationsSnapshot["tenant"]
}): OperationsSnapshot {
  const { range, tenant } = input
  const seed = hash(`${tenant.id}-${range}`)
  const multiplier = RANGE_MULTIPLIER[range]
  const factor = REGION_FACTOR[tenant.id] ?? 0.62
  const authentications = Math.round(18460 * multiplier * factor)
  const successRate = Number((97.4 + wobble(seed, 2, 1.2)).toFixed(1))
  const failures = Math.round(authentications * (1 - successRate / 100))
  const registrations = Math.round(authentications * (0.086 + wobble(seed, 4, 0.012)))
  const labels = RANGE_LABELS[range]
  const weightTotal = labels.reduce((sum, _, index) => sum + 0.78 + index * 0.06, 0)

  const trend = labels.map((label, index) => {
    const weight = (0.78 + index * 0.06) / weightTotal
    const pointTotal = Math.round(authentications * weight * (1 + wobble(seed, index, 0.18)))
    const failed = Math.max(1, Math.round(failures * weight * (1 + wobble(seed + 4, index, 0.28))))
    return {
      label,
      successful: Math.max(0, pointTotal - failed),
      failed,
      registrations: Math.max(1, Math.round(registrations * weight * (1 + wobble(seed + 8, index, 0.22)))),
    }
  })

  const marketRows = TENANT_MARKETS[tenant.id] ?? [[tenant.name, tenant.hostingCode, 100] as [string, string, number]]
  const markets = marketRows.map(([name, code, share], index) => ({
    name,
    code,
    authentications: Math.round(authentications * share / 100),
    successRate: Number((successRate + wobble(seed + 9, index, 0.9)).toFixed(1)),
    registrations: Math.round(registrations * share / 100),
  }))

  return {
    mode: "demo",
    range,
    generatedAt: "2026-07-13T14:30:00.000Z",
    tenant,
    metrics: {
      authentications,
      activeUsers: Math.round(authentications * 0.63),
      successRate,
      registrationRate: Number((71.8 + wobble(seed, 5, 3.4)).toFixed(1)),
      verificationRate: Number((88.6 + wobble(seed, 6, 2.2)).toFixed(1)),
      mfaCoverage: Number((42.4 + wobble(seed, 7, 5.6)).toFixed(1)),
      blockedAttempts: Math.max(4, Math.round(failures * 0.14)),
      p95Latency: Math.round(620 + wobble(seed, 8, 80)),
    },
    trend,
    journeyMix: [
      { name: "Password", value: 44 },
      { name: "Passkey", value: 23 },
      { name: "Social", value: 19 },
      { name: "Email OTP", value: 14 },
    ],
    funnel: [
      { name: "Registration started", value: registrations, rate: 100 },
      { name: "Account created", value: Math.round(registrations * 0.83), rate: 83 },
      { name: "Email verified", value: Math.round(registrations * 0.736), rate: 73.6 },
      { name: "Profile completed", value: Math.round(registrations * 0.718), rate: 71.8 },
    ],
    markets,
    health: [
      { name: "Authentication", state: "Healthy", value: `${successRate}%`, detail: "Success rate above the 97% operating target" },
      { name: "Verification", state: "Healthy", value: "88.6%", detail: "Email verification completes within 24 hours" },
      { name: "Latency", state: "Healthy", value: "620 ms", detail: "P95 Universal Login completion latency" },
      { name: "MFA adoption", state: "Watch", value: "42.4%", detail: "Below the proposed 50% rollout checkpoint" },
    ],
    events: [
      { id: "evt-1", time: "14:18", type: "blocked", title: "Credential-stuffing attempts blocked", detail: "Aggregate Attack Protection signal; no user identifiers shown.", count: Math.max(3, Math.round(failures * 0.08)) },
      { id: "evt-2", time: "12:42", type: "recovered", title: "Email delivery latency recovered", detail: "Verification delivery returned below the operational threshold.", count: 1 },
      { id: "evt-3", time: "09:05", type: "degraded", title: "Elevated failed logins observed", detail: "Failures exceeded the rolling baseline for one 15-minute window.", count: Math.max(2, Math.round(failures * 0.05)) },
      { id: "evt-4", time: "07:30", type: "configuration", title: "Tenant policy review completed", detail: "Synthetic record of an operations change window.", count: 1 },
    ],
  }
}
