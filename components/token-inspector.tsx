"use client"

import useSWR from "swr"
import { AnimatePresence, motion } from "motion/react"
import { Braces, ChevronUp, Lock, X } from "lucide-react"
import { useApp } from "@/components/app-providers"
import type { DecodedToken } from "@/lib/types"
import { synthesizeMockMetadata } from "@/lib/metadata-schema"
import {
  SBD_ACCESS_TOKEN_CLAIM_KEYS,
  SBD_ID_TOKEN_CLAIM_KEYS,
} from "@/lib/claims"
import { cn } from "@/lib/utils"

interface RealSessionResponse {
  session: {
    email: string
    idToken: DecodedToken | null
    accessToken: DecodedToken | null
    userMetadata: Record<string, unknown> | null
    appMetadata: Record<string, unknown> | null
    metadataSource: "directory" | null
    metadataError: string | null
  } | null
}

const fetcher = (url: string) =>
  fetch(url).then((r) => r.json() as Promise<RealSessionResponse>)

function TokenBlock({
  title,
  token,
  highlightKeys,
}: {
  title: string
  token: DecodedToken
  highlightKeys: string[]
}) {
  return (
    <div className="rounded-lg border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {title}
        </span>
      </div>
      <div className="space-y-3 p-3">
        <div>
          <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Header
          </p>
          <pre className="overflow-x-auto rounded-md bg-muted p-2 font-mono text-[11px] leading-relaxed text-foreground">
            {JSON.stringify(token.header, null, 2)}
          </pre>
        </div>
        <div>
          <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Payload (claims)
          </p>
          <div className="overflow-x-auto rounded-md bg-muted p-2 font-mono text-[11px] leading-relaxed">
            <span>{"{"}</span>
            {Object.entries(token.payload).map(([k, v], i, arr) => {
              const highlighted = highlightKeys.includes(k)
              return (
                <div key={k} className="pl-3">
                  <span
                    className={cn(
                      "rounded px-1",
                      highlighted &&
                        "bg-primary/20 font-semibold text-foreground ring-1 ring-primary/40",
                    )}
                  >
                    <span className="text-muted-foreground">{`"${k}"`}</span>
                    {": "}
                    <span className="text-foreground">{JSON.stringify(v)}</span>
                    {i < arr.length - 1 ? "," : ""}
                  </span>
                </div>
              )
            })}
            <span>{"}"}</span>
          </div>
        </div>
      </div>
    </div>
  )
}

function MetadataBlock({
  title,
  description,
  data,
  readOnly,
}: {
  title: string
  description: string
  data: Record<string, unknown>
  readOnly?: boolean
}) {
  const isEmpty = Object.keys(data).length === 0
  return (
    <div className="rounded-lg border border-border bg-card">
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {title}
        </span>
        {readOnly ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            <Lock className="size-3" />
            Read-only
          </span>
        ) : null}
      </div>
      <div className="space-y-2 p-3">
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          {description}
        </p>
        {isEmpty ? (
          <p className="rounded-md bg-muted p-2 font-mono text-[11px] text-muted-foreground">
            {"{}  // no values set"}
          </p>
        ) : (
          <pre className="overflow-x-auto rounded-md bg-muted p-2 font-mono text-[11px] leading-relaxed text-foreground">
            {JSON.stringify(data, null, 2)}
          </pre>
        )}
      </div>
    </div>
  )
}

export function TokenInspector() {
  const {
    tokenInspectorOpen,
    setTokenInspectorOpen,
    session,
    authConfigured,
    brand,
    country,
  } = useApp()

  // When there's no client-side mock session, the user may still have a REAL
  // Auth0 session (promoted social / password flows leave a server cookie).
  // Fetch and decode it so the inspector reflects genuine logins too.
  const { data: realData } = useSWR(
    authConfigured && !session ? "/api/token-inspector" : null,
    fetcher,
    { revalidateOnFocus: true },
  )
  const realSession = !session ? realData?.session ?? null : null

  // Unified view model: prefer the mock session, else the real one.
  const idToken = session ? session.tokens.idToken : realSession?.idToken ?? null
  const accessToken = session
    ? session.tokens.accessToken
    : realSession?.accessToken ?? null
  const activeEmail = session?.email ?? realSession?.email ?? null
  const isReal = !session && Boolean(realSession)

  // Metadata view model. user_metadata / app_metadata are NOT in the token —
  // for a real session they come from the directory (Management API); for a
  // mock session we synthesize a plausible, clearly-labeled pair.
  const directoryMeta =
    isReal && realSession?.metadataSource === "directory"
      ? {
          userMetadata: realSession.userMetadata ?? {},
          appMetadata: realSession.appMetadata ?? {},
        }
      : null
  const mockMeta = session
    ? synthesizeMockMetadata({
        roles: session.roles,
        muid: session.muid,
        brand,
        country,
      })
    : null
  const metadata = directoryMeta
    ? { ...directoryMeta, source: "directory" as const }
    : mockMeta
      ? {
          userMetadata: mockMeta.user_metadata,
          appMetadata: mockMeta.app_metadata,
          source: "simulated" as const,
        }
      : null
  const metadataError = isReal ? realSession?.metadataError ?? null : null

  return (
    <>
      <div className="sticky bottom-0 z-30 border-t border-border bg-card">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-2 sm:px-6">
          <button
            type="button"
            onClick={() => setTokenInspectorOpen(true)}
            className="flex items-center gap-2 rounded-md px-2 py-1 text-sm font-medium text-foreground transition-colors hover:bg-muted outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Braces className="size-4 text-primary" />
            Token inspector
            <ChevronUp className="size-4 text-muted-foreground" />
          </button>
          <span className="text-xs text-muted-foreground">
            {activeEmail
              ? `${isReal ? "Real Auth0 session" : "Active session"} — decoded tokens for ${activeEmail}`
              : "No active session — sign in to populate tokens"}
          </span>
        </div>
      </div>

      <AnimatePresence>
        {tokenInspectorOpen && (
          <motion.div
            className="fixed inset-0 z-50 flex items-end justify-center bg-foreground/40 p-0 sm:p-4"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setTokenInspectorOpen(false)}
          >
            <motion.div
              className="w-full max-w-3xl overflow-hidden rounded-t-2xl border border-border bg-background shadow-2xl sm:rounded-2xl"
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", damping: 28, stiffness: 280 }}
              onClick={(e) => e.stopPropagation()}
              role="dialog"
              aria-modal="true"
              aria-label="Token inspector"
            >
              <div className="flex items-center justify-between border-b border-border px-4 py-3">
                <div className="flex items-center gap-2">
                  <Braces className="size-4 text-primary" />
                  <h2 className="text-sm font-semibold">Token inspector</h2>
                </div>
                <button
                  type="button"
                  onClick={() => setTokenInspectorOpen(false)}
                  className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <X className="size-4" />
                  <span className="sr-only">Close token inspector</span>
                </button>
              </div>

              <div className="max-h-[70vh] space-y-4 overflow-y-auto p-4">
                <p className="text-xs text-muted-foreground">
                  Decoded tokens for the current session. ID-token display
                  context and approved-API access-token authorization claims are
                  highlighted separately. Signatures are not verified in this
                  inspector.
                </p>
                {idToken || accessToken ? (
                  <>
                    {idToken ? (
                      <TokenBlock
                        title="ID token — display and session context"
                        token={idToken}
                        highlightKeys={SBD_ID_TOKEN_CLAIM_KEYS}
                      />
                    ) : null}
                    {accessToken ? (
                      <TokenBlock
                        title="Access token — approved API authorization"
                        token={accessToken}
                        highlightKeys={SBD_ACCESS_TOKEN_CLAIM_KEYS}
                      />
                    ) : (
                      <div className="rounded-lg border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
                        The access token is opaque (no API audience configured),
                        so it has no readable JWT payload to decode.
                      </div>
                    )}
                  </>
                ) : (
                  <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                    No active session. Complete a sign-in flow to populate the ID
                    and access tokens.
                  </div>
                )}

                {metadata ? (
                  <div className="space-y-3 border-t border-border pt-4">
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="text-sm font-semibold">Directory metadata</h3>
                      <span
                        className={cn(
                          "rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide",
                          metadata.source === "directory"
                            ? "bg-primary/15 text-primary ring-1 ring-primary/30"
                            : "bg-muted text-muted-foreground",
                        )}
                      >
                        {metadata.source === "directory"
                          ? "Read from Auth0"
                          : "Demo data"}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      These records live in the Okta/Auth0 directory, not in the
                      token. They are read with the Management API (
                      <code className="rounded bg-muted px-1">getUser</code>),
                      scoped to this user.
                      {metadata.source === "simulated"
                        ? " Shown here as a simulation because there is no live, Management-API-backed session."
                        : null}
                    </p>
                    {metadataError ? (
                      <p className="rounded-md border border-dashed border-border p-2 text-[11px] text-muted-foreground">
                        Could not read metadata from Auth0: {metadataError}
                      </p>
                    ) : null}
                    <MetadataBlock
                      title="user_metadata"
                      description="User-editable preferences (the account center writes these). Never affects what the user is allowed to do."
                      data={metadata.userMetadata}
                    />
                    <MetadataBlock
                      title="app_metadata"
                      description="Server-controlled entitlements an Action reads into claims — roles, directory id, data-residency region. Not writable from the account center."
                      data={metadata.appMetadata}
                      readOnly
                    />
                  </div>
                ) : null}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
