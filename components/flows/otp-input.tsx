"use client"

import { useEffect, useRef, useState } from "react"
import { cn } from "@/lib/utils"

/**
 * Six-box one-time code input. Auto-advances on entry, supports paste and
 * backspace, and calls onComplete when all six digits are present.
 */
export function OtpInput({
  length = 6,
  disabled = false,
  autoFocus = true,
  onChange,
  onComplete,
}: {
  length?: number
  disabled?: boolean
  autoFocus?: boolean
  onChange?: (value: string) => void
  onComplete?: (value: string) => void
}) {
  const [digits, setDigits] = useState<string[]>(Array(length).fill(""))
  const refs = useRef<Array<HTMLInputElement | null>>([])

  useEffect(() => {
    if (autoFocus) refs.current[0]?.focus()
  }, [autoFocus])

  function emit(next: string[]) {
    const value = next.join("")
    onChange?.(value)
    if (value.length === length && next.every(Boolean)) onComplete?.(value)
  }

  function setAt(index: number, val: string) {
    const next = [...digits]
    next[index] = val
    setDigits(next)
    emit(next)
  }

  function handleChange(index: number, raw: string) {
    const val = raw.replace(/\D/g, "")
    if (!val) {
      setAt(index, "")
      return
    }
    if (val.length > 1) {
      // Pasted multiple digits.
      const chars = val.slice(0, length - index).split("")
      const next = [...digits]
      chars.forEach((c, i) => (next[index + i] = c))
      setDigits(next)
      emit(next)
      const focusIndex = Math.min(index + chars.length, length - 1)
      refs.current[focusIndex]?.focus()
      return
    }
    setAt(index, val)
    if (index < length - 1) refs.current[index + 1]?.focus()
  }

  function handleKeyDown(index: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Backspace") {
      if (digits[index]) {
        setAt(index, "")
      } else if (index > 0) {
        refs.current[index - 1]?.focus()
        setAt(index - 1, "")
      }
    } else if (e.key === "ArrowLeft" && index > 0) {
      refs.current[index - 1]?.focus()
    } else if (e.key === "ArrowRight" && index < length - 1) {
      refs.current[index + 1]?.focus()
    }
  }

  return (
    <div className="flex gap-2" role="group" aria-label={`${length}-digit code`}>
      {digits.map((d, i) => (
        <input
          key={i}
          ref={(el) => {
            refs.current[i] = el
          }}
          inputMode="numeric"
          autoComplete={i === 0 ? "one-time-code" : "off"}
          maxLength={1}
          value={d}
          disabled={disabled}
          aria-label={`Digit ${i + 1}`}
          onChange={(e) => handleChange(i, e.target.value)}
          onKeyDown={(e) => handleKeyDown(i, e)}
          className={cn(
            "h-14 w-full rounded-lg border border-input bg-card text-center text-2xl font-bold tabular-nums text-foreground outline-none transition-all",
            "focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40",
            "disabled:opacity-50",
            d && "border-primary",
          )}
        />
      ))}
    </div>
  )
}
