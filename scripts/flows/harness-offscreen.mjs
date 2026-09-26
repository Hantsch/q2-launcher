// Proves the harness window stays out of the way: placed left of every display, never focused,
// and still painting — a stalled offscreen renderer would make every screenshot blank or hang.
// Run it and watch the desktop: nothing should appear. `Q2L_UI_VISIBLE=1` shows the window again
// (and makes the offscreen assertion fail, on purpose).

const CLICK_TIMEOUT_MS = 8_000

export default async function harnessOffscreen({ app, page, shot, step }) {
  step('window is offscreen and unfocused')
  // The window is created with `show: false` and only shown on `ready-to-show`
  // (src/main/window.ts), which can land after the harness hands over the page.
  const state = await app.evaluate(async ({ BrowserWindow, screen }, timeoutMs) => {
    const window = BrowserWindow.getAllWindows()[0]
    const deadline = Date.now() + timeoutMs
    while (!window.isVisible() && Date.now() < deadline) {
      await new Promise((settle) => setTimeout(settle, 50))
    }
    const bounds = window.getBounds()
    const onScreen = screen.getAllDisplays().some((display) => {
      const area = display.bounds
      return (
        bounds.x < area.x + area.width &&
        bounds.x + bounds.width > area.x &&
        bounds.y < area.y + area.height &&
        bounds.y + bounds.height > area.y
      )
    })
    return { bounds, onScreen, focused: window.isFocused(), visible: window.isVisible() }
  }, CLICK_TIMEOUT_MS)
  if (state.onScreen) throw new Error(`window overlaps a display: ${JSON.stringify(state.bounds)}`)
  if (state.focused) throw new Error('window took focus')
  if (!state.visible) throw new Error('window is not shown at all')

  step('renderer still paints while offscreen')
  await page.getByTestId('nav-config').click({ timeout: CLICK_TIMEOUT_MS })
  await page.getByTestId('config-profile-row').first().waitFor({ timeout: CLICK_TIMEOUT_MS })
  const frames = await page.evaluate(
    () =>
      new Promise((done) => {
        let count = 0
        const tick = () => (++count < 10 ? requestAnimationFrame(tick) : done(count))
        requestAnimationFrame(tick)
        setTimeout(() => done(count), 2_000)
      }),
  )
  if (frames < 10) throw new Error(`renderer throttled offscreen: ${frames}/10 frames in 2s`)

  await shot('config-offscreen')
}
