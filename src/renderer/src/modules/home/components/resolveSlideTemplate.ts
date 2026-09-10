import type { NewsTemplate } from '@shared/modules/home'

/**
 * Which of the three fixed templates actually renders a slide.
 *
 * Story 083 D2 / concept §6.2 originally read "an unknown `template` value, or a known template
 * with a missing image, is rendered by the `text` template" - story 084's AC3 supersedes the
 * second half of that: "a slide whose image is missing, fails to download or is not an image
 * renders without it, and the surrounding template stays intact rather than collapsing." A known
 * template (`split`/`banner`) is therefore always rendered as itself now; `SlideSplit`/
 * `SlideBanner` are what render the full-width, no-image fallback internally (084 D5) when the
 * resolved slide carries no `imageUrl`. Only a genuinely unknown `template` value falls back to
 * `text` here.
 *
 * Not a component - the carousel (083 D3) holds the `switch` that turns this answer into
 * `SlideSplit`/`SlideBanner`/`SlideText`. It exists as its own pure function so `slides.test.tsx`
 * has something to assert "unknown template falls back to text" against.
 *
 * Takes the raw `template` string rather than `NewsSlide['template']` alone: the feed pipeline is
 * what actually validates that value against `NewsTemplate`, so this function has to keep working
 * correctly against anything already-cached or hand-built data might carry.
 */
export function resolveSlideTemplate(slide: { template: string }): NewsTemplate {
  if (slide.template === 'split' || slide.template === 'banner') {
    return slide.template
  }
  return 'text'
}
