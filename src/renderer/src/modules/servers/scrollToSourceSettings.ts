/**
 * Scrolls the Settings > Servers section into view after a route change. Two rAFs (the route's
 * render commit, then the next paint) is the smallest wait that reliably sees
 * `settings-section-servers` in the DOM.
 */
export function scrollToSourceSettings(): void {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      document
        .querySelector('[data-testid="settings-section-servers"]')
        ?.scrollIntoView({ block: 'start' })
    })
  })
}
