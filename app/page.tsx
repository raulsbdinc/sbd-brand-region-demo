"use client"

import Image from "next/image"
import { useRouter } from "next/navigation"
import { ArrowRight, ShieldCheck, Sparkles } from "lucide-react"
import { useApp } from "@/components/app-providers"
import { PRODUCTS } from "@/lib/products"
import { SITE_CONTENT, formatPrice } from "@/lib/site"
import { Button } from "@/components/ui/button"

export default function HomePage() {
  const { session } = useApp()
  const router = useRouter()

  return (
    <main className="mx-auto w-full max-w-7xl px-4 pb-16 sm:px-6">
      {/* Hero */}
      <section className="mt-6 overflow-hidden rounded-3xl border border-border bg-card">
        <div className="grid items-center gap-6 lg:grid-cols-2">
          <div className="p-8 sm:p-12">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-3 py-1 text-xs font-semibold text-muted-foreground">
              <Sparkles className="size-3.5 text-primary" />
              {SITE_CONTENT.eyebrow}
            </span>
            <h1 className="mt-4 text-balance text-4xl font-extrabold tracking-tight sm:text-5xl">
              {SITE_CONTENT.headline}
            </h1>
            <p className="mt-4 max-w-md text-pretty leading-relaxed text-muted-foreground">
              {SITE_CONTENT.subcopy}
            </p>
            <div className="mt-7 flex flex-wrap items-center gap-3">
              <Button
                size="lg"
                className="h-12 px-6 text-base font-semibold"
                onClick={() => router.push(session ? "/welcome" : "/signin")}
              >
                {session ? "Go to your account" : "Sign in or create account"}
                <ArrowRight className="size-5" />
              </Button>
            </div>
          </div>
          <div className="relative aspect-[4/3] w-full">
            <Image
              src="/products/hero-tools.png"
              alt="Cordless power tools lineup"
              fill
              priority
              sizes="(min-width: 1024px) 50vw, 100vw"
              className="object-cover"
            />
          </div>
        </div>
      </section>

      {/* Trust strip */}
      <div className="mt-4 flex items-center gap-2 rounded-xl border border-dashed border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
        <ShieldCheck className="size-4 text-primary" />
        Demonstration storefront. Products, prices, and checkout are for
        illustration; account sign-in is live.
      </div>

      {/* Products */}
      <section className="mt-10">
        <div className="flex items-end justify-between">
          <h2 className="text-2xl font-bold tracking-tight">Featured tools</h2>
          <span className="text-sm text-muted-foreground">{PRODUCTS.length} items</span>
        </div>
        <div className="mt-5 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {PRODUCTS.map((p) => (
            <article
              key={p.id}
              className="group flex flex-col overflow-hidden rounded-2xl border border-border bg-card"
            >
              <div className="relative aspect-square bg-[var(--brand-surface-muted)]">
                <Image
                  src={p.image}
                  alt={p.name}
                  fill
                  sizes="(min-width: 1024px) 30vw, (min-width: 640px) 45vw, 90vw"
                  className="object-contain p-6 transition-transform duration-300 group-hover:scale-105"
                />
              </div>
              <div className="flex flex-1 flex-col p-5">
                <h3 className="font-semibold text-foreground">{p.name}</h3>
                <p className="mt-1 flex-1 text-sm leading-relaxed text-muted-foreground">
                  {p.blurb}
                </p>
                <div className="mt-4 flex items-center justify-between">
                  <span className="text-lg font-bold text-foreground">{formatPrice(p.price)}</span>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => router.push(session ? "/welcome" : "/signin")}
                  >
                    Add to cart
                  </Button>
                </div>
              </div>
            </article>
          ))}
        </div>
      </section>
    </main>
  )
}
