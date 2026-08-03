"use client"

import type { ReactNode } from "react"
import { motion } from "motion/react"
import { AlertTriangle } from "lucide-react"
import { cn } from "@/lib/utils"

/** Centered, comfortably-spaced column used by every flow screen. */
export function FlowContainer({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <div className="flex min-h-full justify-center px-5 py-8 sm:py-12">
      <div className={cn("w-full max-w-md", className)}>{children}</div>
    </div>
  )
}

/** Animated wrapper so each step slides in. */
export function FlowStep({
  children,
  stepKey,
}: {
  children: ReactNode
  stepKey: string | number
}) {
  return (
    <motion.div
      key={stepKey}
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.22, ease: "easeOut" }}
    >
      {children}
    </motion.div>
  )
}

export function FlowHeading({
  title,
  description,
}: {
  title: ReactNode
  description?: ReactNode
}) {
  return (
    <div className="mb-6 space-y-2">
      <h1 className="text-pretty text-2xl font-bold tracking-tight sm:text-3xl">
        {title}
      </h1>
      {description ? (
        <p className="text-pretty leading-relaxed text-muted-foreground">
          {description}
        </p>
      ) : null}
    </div>
  )
}

/**
 * Shown by a flow that performs a REAL Auth0 login when the integration's env
 * vars are missing. Promoted flows (social, password) have no mock fallback, so
 * this is the honest state instead of pretending to sign in.
 */
export function FlowNotConfigured({
  method,
  onSwitchMethod,
}: {
  method: string
  onSwitchMethod?: () => void
}) {
  return (
    <FlowContainer>
      <FlowStep stepKey="not-configured">
        <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-6">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 size-5 shrink-0 text-destructive" />
            <div>
              <h1 className="text-lg font-bold text-foreground">
                {method} isn&apos;t configured yet
              </h1>
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                This is a real Auth0 sign-in, but the Auth0 environment variables
                are missing, so it can&apos;t run. Add{" "}
                <span className="font-mono text-xs text-foreground">
                  AUTH0_DOMAIN
                </span>
                ,{" "}
                <span className="font-mono text-xs text-foreground">
                  AUTH0_CLIENT_ID
                </span>
                ,{" "}
                <span className="font-mono text-xs text-foreground">
                  AUTH0_CLIENT_SECRET
                </span>
                , and{" "}
                <span className="font-mono text-xs text-foreground">
                  AUTH0_SECRET
                </span>{" "}
                to the project, then redeploy.
              </p>
            </div>
          </div>
        </div>
        {onSwitchMethod ? (
          <button
            type="button"
            onClick={onSwitchMethod}
            className="mt-4 w-full rounded text-center text-sm font-medium text-muted-foreground underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring"
          >
            Use a different sign-in method
          </button>
        ) : null}
      </FlowStep>
    </FlowContainer>
  )
}

/** "Step 1 of 3" style indicator with progress dots. */
export function StepIndicator({
  current,
  total,
}: {
  current: number
  total: number
}) {
  return (
    <div className="mb-5 flex items-center gap-3">
      <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Step {current} of {total}
      </span>
      <div className="flex flex-1 gap-1.5" aria-hidden="true">
        {Array.from({ length: total }).map((_, i) => (
          <span
            key={i}
            className={cn(
              "h-1.5 flex-1 rounded-full transition-colors",
              i < current ? "bg-primary" : "bg-muted",
            )}
          />
        ))}
      </div>
    </div>
  )
}
