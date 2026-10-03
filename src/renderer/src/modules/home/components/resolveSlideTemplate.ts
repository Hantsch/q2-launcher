/**
 * The subset of `NewsTemplate` this component of the renderer currently knows how to render as
 * itself, rather than folding to `text`. Story 095 gives `cover` its own component
 * (`SlideCover`), so it rejoins `split`/`banner` here - restoring the earlier narrowing to
 * `'split' | 'banner' | 'text'` (from before `SlideCover` existed).
 */
type RenderedTemplate = 'split' | 'banner' | 'text' | 'cover'

/**
 * Which of the currently-rendered templates actually renders a slide.
 *
 * Story 083 / concept §6.2 originally read "an unknown `template` value, or a known template
 * with a missing image, is rendered by the `text` template" - story 084 supersedes the
 * second half of that: "a slide whose image is missing, fails to download or is not an image
 * renders without it, and the surrounding template stays intact rather than collapsing." A known
 * template (`split`/`banner`/`cover`) is therefore always rendered as itself now; `SlideSplit`/
 * `SlideBanner`/`SlideCover` are what render the full-width, no-image fallback internally (stories 084, 095) when the resolved slide carries no `imageUrl`. Any other `template` value - unknown -
 * falls back to `text` here.
 *
 * Not a component - the carousel (083) holds the `switch` that turns this answer into
 * `SlideSplit`/`SlideBanner`/`SlideCover`/`SlideText`. It exists as its own pure function so
 * `slides.test.tsx` has something to assert "unknown template falls back to text" against.
 *
 * Takes the raw `template` string rather than `NewsSlide['template']` alone: the feed pipeline is
 * what actually validates that value against `NewsTemplate`, so this function has to keep working
 * correctly against anything already-cached or hand-built data might carry.
 */
export function resolveSlideTemplate(slide: { template: string }): RenderedTemplate {
  if (slide.template === 'split' || slide.template === 'banner' || slide.template === 'cover') {
    return slide.template
  }
  return 'text'
}
