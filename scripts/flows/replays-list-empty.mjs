// Story 151 D4 acceptance flow: proves the Demos view's empty state actually says what it is (AC
// "the empty state tells you where to add demo folders") and that its "open source settings"
// action really lands on the Settings section a user would use to fix it. Runs against the `empty`
// fixture variant - zero installations, no extra folders, so a scan genuinely finds nothing.
//
// Selectors - read `src/renderer/src/modules/replays/ReplaysListStatus.tsx` and
// `src/renderer/src/modules/replays/ReplaysView.tsx` before changing any of these:
//   nav-replays                    TitleBar.tsx - primary nav entry
//   replays-list-empty             ReplaysListStatus.tsx - the empty state
//   replays-list-empty-settings    ReplaysListStatus.tsx - its "open source settings" button
//   settings-section-replays       SettingsView.tsx - the shell's own Panel wrapper

export const variant = 'empty'

const TIMEOUT_MS = 8_000

export default async function replaysListEmpty({ page, shot, step }) {
  step('opening the Demos view with nothing to scan shows the empty state')
  await page.getByTestId('nav-replays').click({ timeout: TIMEOUT_MS })

  const empty = page.getByTestId('replays-list-empty')
  await empty.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  const text = await empty.innerText()
  if (!text.trim()) {
    throw new Error('replays-list-empty: expected the empty state to render non-empty text')
  }
  await shot('replays-list-empty')

  step('clicking its "open source settings" action scrolls the Replays settings section into view')
  await page.getByTestId('replays-list-empty-settings').click({ timeout: TIMEOUT_MS })

  const section = page.getByTestId('settings-section-replays')
  await section.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  const inViewport = await section.evaluate((el) => {
    const rect = el.getBoundingClientRect()
    // `scrollIntoView({ block: 'start' })` (ReplaysView.tsx's `handleOpenSettings`) puts the
    // section's own top edge at (or near) the viewport's top - the section itself may be taller
    // than the viewport, so this checks the top edge landed on screen, not that the whole section
    // fits inside it.
    return rect.top >= 0 && rect.top < window.innerHeight && rect.width > 0 && rect.height > 0
  })
  if (!inViewport) {
    throw new Error(
      'replays-list-empty: expected settings-section-replays to be scrolled into the viewport',
    )
  }

  await shot('replays-list-empty-settings-section')
}
