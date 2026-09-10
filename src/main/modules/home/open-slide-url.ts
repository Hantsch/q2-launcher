import { shell } from 'electron'
import { fail, ok, type Outcome } from '@shared/types'
import { NEWS_BUTTON_HOST_ALLOWLIST } from '@shared/modules/home'
import type { Logger } from '../../lib/logger'

/**
 * Story 083 D5: opens a news slide button's `url` through `shell.openExternal`, but only after
 * checking it is `http(s)` and its host is on `NEWS_BUTTON_HOST_ALLOWLIST` - the same allowlist
 * constant 082 defined for a button's `url` at parse time (`shared/modules/home.ts`). A feed URL
 * is foreign content, so this gets its own handler rather than reusing `app:openExternal`, which
 * only validates the scheme (see `main/ipc/app.ts`).
 *
 * `isAllowedButtonHost` (082) is not reused here on purpose: it also requires `https:`, while this
 * handler's own contract (083 D5) allows either `http:` or `https:`. Both checks share the same
 * allowlist constant - there is exactly one list of trusted hosts in this codebase.
 *
 * Never throws: a malformed URL, a disallowed scheme, or a disallowed host all resolve to a
 * refusal `Outcome` instead. Either outcome is logged, so a refusal is visible in support logs
 * even though nothing is shown to the user beyond the button silently not doing anything.
 */
export async function openSlideUrl(url: string, log: Logger): Promise<Outcome<null>> {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    log.warn(`slide.openUrl: refused a malformed url`)
    return fail('home.error.urlNotAllowed')
  }

  const schemeAllowed = parsed.protocol === 'http:' || parsed.protocol === 'https:'
  const hostAllowed = (NEWS_BUTTON_HOST_ALLOWLIST as readonly string[]).includes(parsed.hostname)

  if (!schemeAllowed || !hostAllowed) {
    log.warn(`slide.openUrl: refused '${parsed.protocol}//${parsed.hostname}' (not on the allowlist)`)
    return fail('home.error.urlNotAllowed')
  }

  await shell.openExternal(url)
  log.info(`slide.openUrl: opened '${parsed.protocol}//${parsed.hostname}'`)
  return ok(null)
}
