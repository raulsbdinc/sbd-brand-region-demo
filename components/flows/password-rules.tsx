"use client"

import { motion } from "motion/react"
import { CheckCircle2, Circle } from "lucide-react"
import { PASSWORD_RULES, passwordRuleState } from "@/lib/auth-service"
import { cn } from "@/lib/utils"

export function PasswordRules({ password }: { password: string }) {
  const rules = passwordRuleState(password)
  return (
    <ul className="grid gap-1.5 rounded-lg border border-border bg-card p-3 sm:grid-cols-2">
      {PASSWORD_RULES.map((rule) => {
        const ok = rules[rule.id]
        return (
          <li
            key={rule.id}
            className={cn(
              "flex items-center gap-2 text-xs transition-colors",
              ok ? "text-foreground" : "text-muted-foreground",
            )}
          >
            {ok ? (
              <motion.span
                initial={{ scale: 0.6 }}
                animate={{ scale: 1 }}
                transition={{ type: "spring", stiffness: 400, damping: 20 }}
              >
                <CheckCircle2 className="size-4 text-primary" />
              </motion.span>
            ) : (
              <Circle className="size-4 opacity-40" />
            )}
            {rule.label}
          </li>
        )
      })}
    </ul>
  )
}
