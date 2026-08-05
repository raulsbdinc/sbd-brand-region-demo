"use client"

import { useRouter } from "next/navigation"
import { AnimatePresence, motion } from "motion/react"
import { X } from "lucide-react"
import { useApp } from "@/components/app-providers"
import { BrandWordmark } from "@/components/brand-wordmark"
import type { Session } from "@/lib/types"
import { getMethod } from "@/lib/methods"

import { PasskeyFlow } from "@/components/flows/passkey-flow"
import { MagicLinkFlow } from "@/components/flows/magic-link-flow"
import { EmailCodeFlow } from "@/components/flows/email-code-flow"
import { PasswordFlow } from "@/components/flows/password-flow"
import { SocialFlow } from "@/components/flows/social-flow"
import { SsoFlow } from "@/components/flows/sso-flow"
import { QrInviteFlow } from "@/components/flows/qr-invite-flow"

export interface FlowProps {
  onComplete: (session: Session) => void
  onSwitchMethod: () => void
}

export function FlowOverlay() {
  const { activeFlow, closeFlow, setSession } = useApp()
  const router = useRouter()

  function handleComplete(session: Session) {
    setSession(session)
    closeFlow()
    router.push("/profile")
  }

  function handleSwitchMethod() {
    closeFlow()
    router.push("/pathways")
  }

  const flowProps: FlowProps = {
    onComplete: handleComplete,
    onSwitchMethod: handleSwitchMethod,
  }

  return (
    <AnimatePresence>
      {activeFlow && (
        <motion.div
          key={activeFlow}
          initial={{ opacity: 0, x: 24 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -24 }}
          transition={{ duration: 0.25, ease: "easeOut" }}
          className="fixed inset-x-0 bottom-0 top-16 z-40 flex flex-col bg-background text-foreground"
          role="dialog"
          aria-modal="true"
          aria-label={`${getMethod(activeFlow).name} sign-in flow`}
        >
          <div className="flex items-center justify-between border-b border-border px-4 py-3 sm:px-6">
            <div className="flex items-center gap-2">
              <BrandWordmark />
              <span className="text-sm font-medium text-muted-foreground">
                {getMethod(activeFlow).name}
              </span>
            </div>
            <button
              type="button"
              onClick={handleSwitchMethod}
              className="flex items-center gap-1 rounded-md px-2 py-1 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <X className="size-4" />
              Close
            </button>
          </div>

          <div className="flex-1 overflow-y-auto">
            {activeFlow === "passkey" && <PasskeyFlow {...flowProps} />}
            {activeFlow === "magic-link" && <MagicLinkFlow {...flowProps} />}
            {activeFlow === "email-code" && <EmailCodeFlow {...flowProps} />}
            {activeFlow === "password" && <PasswordFlow {...flowProps} />}
            {activeFlow === "social" && <SocialFlow {...flowProps} />}
            {activeFlow === "sso" && <SsoFlow {...flowProps} />}
            {activeFlow === "qr" && <QrInviteFlow {...flowProps} />}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
