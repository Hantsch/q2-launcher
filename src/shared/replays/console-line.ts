/**
 * Console line validation — pure. A line sent to the running demo's console must be exactly one
 * line of printable ASCII (0x20-0x7E), at most CONSOLE_LINE_MAX characters after trimming. The
 * first violated rule is reported as an i18n-friendly reason code (never prose).
 *
 * Pure by contract: this file lives in `src/shared`, so no `node:*` import, no DOM types, no IPC,
 * no electron.
 */
import { z } from 'zod'

export const CONSOLE_LINE_MAX = 255

export type ConsoleLineReason = 'empty' | 'multiline' | 'control' | 'nonAscii' | 'tooLong'

export type ValidateConsoleLineResult = { ok: true; line: string } | { ok: false; reason: ConsoleLineReason }

function firstViolation(raw: string): ConsoleLineReason | null {
  if (raw.includes('\r') || raw.includes('\n')) return 'multiline'
  let nonAscii = false
  for (let i = 0; i < raw.length; i++) {
    const c = raw.charCodeAt(i)
    if (c < 0x20 || c === 0x7f) return 'control'
    if (c > 0x7f) nonAscii = true
  }
  if (nonAscii) return 'nonAscii'
  const trimmed = raw.trim()
  if (trimmed.length > CONSOLE_LINE_MAX) return 'tooLong'
  if (trimmed.length === 0) return 'empty'
  return null
}

/** The issue message carries the reason code. */
export const consoleLineSchema = z
  .string()
  .superRefine((raw, ctx) => {
    const reason = firstViolation(raw)
    if (reason !== null) ctx.addIssue({ code: 'custom', message: reason })
  })
  .transform((raw) => raw.trim())

export function validateConsoleLine(raw: string): ValidateConsoleLineResult {
  const parsed = consoleLineSchema.safeParse(raw)
  if (parsed.success) return { ok: true, line: parsed.data }
  return { ok: false, reason: parsed.error.issues[0].message as ConsoleLineReason }
}
