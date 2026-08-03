"use client"

import { useMemo, useState } from "react"
import useSWR from "swr"
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  CheckCircle2,
  CircleAlert,
  Clock3,
  Database,
  ExternalLink,
  KeyRound,
  LockKeyhole,
  ShieldCheck,
  UserRoundCheck,
  UsersRound,
} from "lucide-react"
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  XAxis,
  YAxis,
} from "recharts"
import { useApp } from "@/components/app-providers"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart"
import { Progress } from "@/components/ui/progress"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { buildOperationsSnapshot, type OperationsRange } from "@/lib/operations-data"
import { cn } from "@/lib/utils"

interface RegionInfo {
  id: string
  name: string
  hostingCode: string
  hostingName: string
  marketCount: number
  special: boolean
}
interface RegionResponse { active: string; regions: RegionInfo[] }

const fetcher = (url: string) => fetch(url).then((response) => response.json() as Promise<RegionResponse>)
const number = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 })

const trendConfig = {
  successful: { label: "Successful", color: "var(--chart-1)" },
  failed: { label: "Failed", color: "var(--chart-4)" },
  registrations: { label: "Registrations", color: "var(--chart-2)" },
} satisfies ChartConfig

const journeyConfig = {
  Password: { label: "Password", color: "var(--chart-1)" },
  Passkey: { label: "Passkey", color: "var(--chart-2)" },
  Social: { label: "Social", color: "var(--chart-3)" },
  "Email OTP": { label: "Email OTP", color: "var(--chart-5)" },
} satisfies ChartConfig

const journeyColors = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-5)"]

export function OperationsDashboard() {
  const { data } = useSWR("/api/region", fetcher, { revalidateOnFocus: false })
  const { country } = useApp()
  const [range, setRange] = useState<OperationsRange>("7d")
  const tenant = data?.regions.find((region) => region.id === data.active) ?? {
    id: "americas",
    name: "Americas",
    hostingCode: "US",
    hostingName: "United States",
    marketCount: 9,
    special: false,
  }
  const snapshot = useMemo(() => buildOperationsSnapshot({ range, tenant }), [range, tenant])

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-8 sm:px-6 lg:py-12">
      <section className="flex flex-col gap-6 border-b pb-8 lg:flex-row lg:items-end lg:justify-between">
        <div className="flex max-w-3xl flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge>Demo data</Badge>
            <Badge variant="outline">Current tenant only</Badge>
            <Badge variant="secondary">{tenant.hostingCode} residency</Badge>
          </div>
          <div className="flex flex-col gap-2">
            <p className="font-mono text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">CIAM operations / {tenant.id}</p>
            <h1 className="text-balance text-4xl font-semibold tracking-tight sm:text-5xl">Identity operations at a glance.</h1>
            <p className="max-w-2xl text-pretty leading-relaxed text-muted-foreground">
              A privacy-safe command center for authentication health, registration conversion, verification, MFA, and threat signals.
            </p>
          </div>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex flex-col gap-1">
            <span className="text-xs font-medium text-muted-foreground">Reporting window</span>
            <Tabs value={range} onValueChange={(value) => setRange(value as OperationsRange)}>
              <TabsList aria-label="Reporting window">
                <TabsTrigger value="24h">24 hours</TabsTrigger>
                <TabsTrigger value="7d">7 days</TabsTrigger>
                <TabsTrigger value="30d">30 days</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
          <div className="rounded-lg border bg-card px-4 py-2.5">
            <p className="text-xs text-muted-foreground">Selected tenant</p>
            <p className="font-medium">DeWalt · {tenant.name}</p>
            <p className="text-xs text-muted-foreground">Hosted in {tenant.hostingName} · site context {country.toUpperCase()}</p>
          </div>
        </div>
      </section>

      <Alert>
        <Database />
        <AlertTitle>Public POC — all figures are deterministic synthetic aggregates</AlertTitle>
        <AlertDescription>
          This page makes no tenant-wide Auth0 calls and contains no user-level records. Production would ingest Auth0 Logs or Log Streams through a protected backend and expose aggregate metrics to authorized operators.
        </AlertDescription>
      </Alert>

      <section aria-labelledby="summary-title" className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-4">
          <h2 id="summary-title" className="text-lg font-semibold">Operating summary</h2>
          <span className="font-mono text-xs text-muted-foreground">Generated Jul 13, 2026 · 14:30 UTC</span>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard icon={KeyRound} label="Authentications" value={number.format(snapshot.metrics.authentications)} change="8.4%" positive />
          <MetricCard icon={ShieldCheck} label="Success rate" value={`${snapshot.metrics.successRate}%`} change="0.6 pts" positive />
          <MetricCard icon={UsersRound} label="Active users" value={number.format(snapshot.metrics.activeUsers)} change="5.2%" positive />
          <MetricCard icon={CircleAlert} label="Blocked attempts" value={number.format(snapshot.metrics.blockedAttempts)} change="12.1%" positive={false} />
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.65fr_0.85fr]">
        <Card>
          <CardHeader className="flex-row items-start justify-between gap-4">
            <div className="flex flex-col gap-1">
              <CardTitle>Authentication volume</CardTitle>
              <CardDescription>Successful and failed attempts with registration starts.</CardDescription>
            </div>
            <Badge variant="outline">P95 {snapshot.metrics.p95Latency} ms</Badge>
          </CardHeader>
          <CardContent>
            <ChartContainer config={trendConfig} className="h-72 w-full">
              <AreaChart data={snapshot.trend} margin={{ left: 0, right: 8, top: 10, bottom: 0 }}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} />
                <YAxis tickLine={false} axisLine={false} width={44} tickFormatter={(value) => number.format(value)} />
                <ChartTooltip content={<ChartTooltipContent indicator="line" />} />
                <Area type="monotone" dataKey="successful" fill="var(--color-successful)" fillOpacity={0.16} stroke="var(--color-successful)" strokeWidth={2} />
                <Area type="monotone" dataKey="failed" fill="var(--color-failed)" fillOpacity={0.12} stroke="var(--color-failed)" strokeWidth={2} />
                <Area type="monotone" dataKey="registrations" fill="var(--color-registrations)" fillOpacity={0.08} stroke="var(--color-registrations)" strokeWidth={2} />
              </AreaChart>
            </ChartContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Journey mix</CardTitle>
            <CardDescription>Share of successful sign-ins by method.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col items-center gap-4 sm:flex-row xl:flex-col">
            <ChartContainer config={journeyConfig} className="h-52 w-full max-w-64">
              <PieChart>
                <ChartTooltip content={<ChartTooltipContent nameKey="name" hideLabel />} />
                <Pie data={snapshot.journeyMix} dataKey="value" nameKey="name" innerRadius={52} outerRadius={78} strokeWidth={3}>
                  {snapshot.journeyMix.map((item, index) => <Cell key={item.name} fill={journeyColors[index]} />)}
                </Pie>
              </PieChart>
            </ChartContainer>
            <div className="grid w-full gap-2">
              {snapshot.journeyMix.map((item, index) => (
                <div key={item.name} className="flex items-center justify-between gap-3 text-sm">
                  <span className="flex items-center gap-2"><span className="size-2.5 rounded-sm" style={{ backgroundColor: journeyColors[index] }} />{item.name}</span>
                  <span className="font-mono font-medium tabular-nums">{item.value}%</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Registration funnel</CardTitle>
            <CardDescription>Conversion from contextual entry point to completed profile.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            {snapshot.funnel.map((step, index) => (
              <div key={step.name} className="flex flex-col gap-2">
                <div className="flex items-end justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <span className="flex size-7 items-center justify-center rounded-md bg-muted font-mono text-xs font-semibold">{index + 1}</span>
                    <div><p className="text-sm font-medium">{step.name}</p><p className="text-xs text-muted-foreground">{number.format(step.value)} journeys</p></div>
                  </div>
                  <span className="font-mono text-sm font-semibold tabular-nums">{step.rate}%</span>
                </div>
                <Progress value={step.rate} aria-label={`${step.name}: ${step.rate}%`} />
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Tenant health</CardTitle>
            <CardDescription>Operational checkpoints for the selected identity tenant.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            {snapshot.health.map((check) => (
              <div key={check.name} className="flex flex-col gap-3 rounded-lg border p-4">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-medium">{check.name}</span>
                  <Badge variant={check.state === "Healthy" ? "secondary" : "outline"}>{check.state}</Badge>
                </div>
                <p className="font-mono text-2xl font-semibold tabular-nums">{check.value}</p>
                <p className="text-xs leading-relaxed text-muted-foreground">{check.detail}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-4 xl:grid-cols-[1fr_1.3fr]">
        <Card>
          <CardHeader>
            <CardTitle>Market activity</CardTitle>
            <CardDescription>Top aggregate markets in the current tenant scope.</CardDescription>
          </CardHeader>
          <CardContent>
            <ChartContainer config={{ authentications: { label: "Authentications", color: "var(--chart-1)" } }} className="h-64 w-full">
              <BarChart data={snapshot.markets} layout="vertical" margin={{ left: 6, right: 10 }}>
                <CartesianGrid horizontal={false} />
                <XAxis type="number" hide />
                <YAxis dataKey="code" type="category" axisLine={false} tickLine={false} width={30} />
                <ChartTooltip content={<ChartTooltipContent hideLabel />} />
                <Bar dataKey="authentications" fill="var(--color-authentications)" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ChartContainer>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader><TableRow><TableHead>Market</TableHead><TableHead className="text-right">Success</TableHead><TableHead className="text-right">Registrations</TableHead></TableRow></TableHeader>
                <TableBody>{snapshot.markets.map((market) => <TableRow key={market.code}><TableCell className="font-medium">{market.name}</TableCell><TableCell className="text-right font-mono">{market.successRate}%</TableCell><TableCell className="text-right font-mono">{number.format(market.registrations)}</TableCell></TableRow>)}</TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recent operational signals</CardTitle>
            <CardDescription>Aggregate events only. No identities, emails, IP addresses, or raw log payloads.</CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader><TableRow><TableHead>Time</TableHead><TableHead>Signal</TableHead><TableHead>State</TableHead><TableHead className="text-right">Count</TableHead></TableRow></TableHeader>
              <TableBody>
                {snapshot.events.map((event) => (
                  <TableRow key={event.id}>
                    <TableCell className="font-mono text-xs text-muted-foreground">{event.time}</TableCell>
                    <TableCell><p className="font-medium">{event.title}</p><p className="max-w-md text-xs leading-relaxed text-muted-foreground">{event.detail}</p></TableCell>
                    <TableCell><Badge variant="outline" className={cn(event.type === "blocked" && "border-destructive/40 text-destructive")}>{event.type}</Badge></TableCell>
                    <TableCell className="text-right font-mono">{event.count}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
        <Card>
          <CardHeader><CardTitle>Coverage checkpoints</CardTitle><CardDescription>Operational adoption indicators for this demonstration.</CardDescription></CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-3 lg:grid-cols-1">
            <Coverage icon={UserRoundCheck} label="Registration completion" value={snapshot.metrics.registrationRate} />
            <Coverage icon={CheckCircle2} label="Email verification" value={snapshot.metrics.verificationRate} />
            <Coverage icon={LockKeyhole} label="MFA coverage" value={snapshot.metrics.mfaCoverage} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Production data path</CardTitle><CardDescription>How this public demonstration becomes a governed operational capability.</CardDescription></CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-3">
            {[
              [Activity, "1. Ingest", "Auth0 Logs API for bounded retrieval or Log Streams for durable event delivery."],
              [ShieldCheck, "2. Govern", "Protected service, least-privilege scopes, regional retention, and pseudonymization."],
              [Database, "3. Present", "Authorized aggregate dashboards with audit trails and warehouse/BI export."],
            ].map(([Icon, title, detail]) => {
              const StepIcon = Icon as typeof Activity
              return <div key={title as string} className="flex flex-col gap-3 rounded-lg border p-4"><StepIcon className="size-5 text-primary" aria-hidden="true" /><p className="font-medium">{title as string}</p><p className="text-sm leading-relaxed text-muted-foreground">{detail as string}</p></div>
            })}
          </CardContent>
        </Card>
      </section>

      <div className="flex flex-col gap-3 rounded-xl border bg-muted/40 p-5 text-sm sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3"><Clock3 className="mt-0.5 size-5 text-primary" aria-hidden="true" /><div><p className="font-medium">Scope boundary</p><p className="text-muted-foreground">The public POC proves the dashboard experience, not live administrative access or cross-tenant aggregation.</p></div></div>
        <a className="inline-flex shrink-0 items-center gap-2 font-medium underline underline-offset-4" href="https://auth0.com/docs/deploy-monitor/logs/retrieve-log-events-using-mgmt-api" target="_blank" rel="noreferrer">Auth0 Logs documentation<ExternalLink className="size-4" aria-hidden="true" /></a>
      </div>
    </main>
  )
}

function MetricCard({ icon: Icon, label, value, change, positive }: { icon: typeof Activity; label: string; value: string; change: string; positive: boolean }) {
  return <Card><CardHeader className="flex-row items-start justify-between gap-3 pb-2"><div className="flex flex-col gap-1"><CardDescription>{label}</CardDescription><CardTitle className="font-mono text-3xl tabular-nums">{value}</CardTitle></div><span className="flex size-9 items-center justify-center rounded-lg bg-muted"><Icon className="size-5" aria-hidden="true" /></span></CardHeader><CardContent><p className={cn("flex items-center gap-1 text-xs font-medium", positive ? "text-foreground" : "text-destructive")}>{positive ? <ArrowUpRight className="size-3.5" /> : <ArrowDownRight className="size-3.5" />}{change} <span className="font-normal text-muted-foreground">vs prior window</span></p></CardContent></Card>
}

function Coverage({ icon: Icon, label, value }: { icon: typeof Activity; label: string; value: number }) {
  return <div className="flex flex-col gap-2"><div className="flex items-center justify-between gap-3"><span className="flex items-center gap-2 text-sm font-medium"><Icon className="size-4" aria-hidden="true" />{label}</span><span className="font-mono text-sm font-semibold">{value}%</span></div><Progress value={value} aria-label={`${label}: ${value}%`} /></div>
}
