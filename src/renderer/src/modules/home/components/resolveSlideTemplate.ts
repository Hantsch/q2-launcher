import type { NewsSlide, NewsTemplate } from '@shared/modules/home'

/**
 * Which of the three fixed templates actually renders a slide (story 083 D2, concept §6.2's "an
 * unknown `template` value, or a known template with a missing image, is rendered by the `text`
 * template as long as `title` and body text exist").
 *
 * Not a component - D3's carousel is what will hold the `switch` that turns this answer into
 * `SlideSplit`/`SlideBanner`/`SlideText`. It exists as its own pure function today so
 * `slides.test.tsx` has something to assert AC2's "unknown template falls back to text" against
 * ahead of the carousel that will call it, mirroring how `SlideSplit`/`SlideBanner` already fall
 * back to `text` themselves when their own slide has no image.
 *
 * Takes the raw `template` string rather than `NewsSlide['template']` alone: D6 (the feed
 * pipeline, not this deliverable) is what will actually validate that value against
 * `NewsTemplate`, so this function has to keep working correctly against anything already-cached
 * or hand-built data might carry.
 */
export function resolveSlideTemplate(slide: Pick<NewsSlide, 'image'> & { template: string }): NewsTemplate {
  if (slide.template === 'split' || slide.template === 'banner') {
    return slide.image ? slide.template : 'text'
  }
  return 'text'
}
