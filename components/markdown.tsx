import type { ComponentPropsWithoutRef } from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"

/**
 * Renders a markdown string using the app's design tokens. Used by the /docs
 * reader so the README files and the on-site docs never drift apart.
 */
export function Markdown({ children }: { children: string }) {
  return (
    <div className="max-w-none">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ node, ...props }) => (
            <h1
              className="mt-0 mb-4 text-pretty text-3xl font-bold tracking-tight text-foreground"
              {...props}
            />
          ),
          h2: ({ node, ...props }) => (
            <h2
              className="mt-10 mb-3 border-b border-border pb-2 text-pretty text-xl font-semibold tracking-tight text-foreground"
              {...props}
            />
          ),
          h3: ({ node, ...props }) => (
            <h3
              className="mt-6 mb-2 text-pretty text-base font-semibold text-foreground"
              {...props}
            />
          ),
          p: ({ node, ...props }) => (
            <p className="my-3 leading-relaxed text-foreground/80" {...props} />
          ),
          ul: ({ node, ...props }) => (
            <ul className="my-3 ml-5 list-disc space-y-1.5 text-foreground/80" {...props} />
          ),
          ol: ({ node, ...props }) => (
            <ol className="my-3 ml-5 list-decimal space-y-1.5 text-foreground/80" {...props} />
          ),
          li: ({ node, ...props }) => <li className="leading-relaxed" {...props} />,
          a: ({ node, ...props }) => (
            <a
              className="font-medium text-primary underline underline-offset-4 hover:opacity-80"
              {...props}
            />
          ),
          strong: ({ node, ...props }) => (
            <strong className="font-semibold text-foreground" {...props} />
          ),
          blockquote: ({ node, ...props }) => (
            <blockquote
              className="my-4 border-l-2 border-primary pl-4 text-foreground/70 italic"
              {...props}
            />
          ),
          hr: ({ node, ...props }) => <hr className="my-8 border-border" {...props} />,
          code: ({ node, className, children, ...props }: ComponentPropsWithoutRef<"code">) => {
            const isBlock = className?.includes("language-")
            if (isBlock) {
              return (
                <code
                  className="block whitespace-pre overflow-x-auto font-mono text-sm text-foreground"
                  {...props}
                >
                  {children}
                </code>
              )
            }
            return (
              <code
                className="rounded bg-muted px-1.5 py-0.5 font-mono text-[0.85em] text-foreground"
                {...props}
              >
                {children}
              </code>
            )
          },
          pre: ({ node, ...props }) => (
            <pre
              className="my-4 overflow-x-auto rounded-lg border border-border bg-muted p-4"
              {...props}
            />
          ),
          table: ({ node, ...props }) => (
            <div className="my-6 overflow-x-auto">
              <table className="w-full border-collapse text-sm" {...props} />
            </div>
          ),
          thead: ({ node, ...props }) => (
            <thead className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground" {...props} />
          ),
          th: ({ node, ...props }) => (
            <th
              className="px-3 py-2 text-left font-semibold"
              {...props}
            />
          ),
          td: ({ node, ...props }) => (
            <td className="border-b border-border px-3 py-2 align-top text-foreground/80" {...props} />
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  )
}
