import { SlideButtons } from './SlideButtons'
import { SlideText, type SlideTemplateProps } from './SlideText'

/**
 * `banner` template (story 083 D2, concept §6.3): image strip across the top, title/body/buttons
 * below - full width, single column, no side-by-side pane like `SlideSplit`.
 *
 * Same missing-image fallback as `SlideSplit`, for the same reason (story 084 is what will ever
 * put a resolvable value in `NewsSlide.image`): no `image` renders through `SlideText` instead of
 * an empty/broken image strip.
 */
/**
 * Story 083 finding 4 (defensive, renderer-side only): a slide's `image` is feed-supplied and the
 * shared schema only requires a non-empty string (`shared/modules/home.ts`, `z.string().min(1)`) -
 * real resolution to a servable URL is 084's job. Until then, only render an `<img>` for a value
 * that already parses as an absolute `http(s)` URL, so a `data:`/`javascript:`/relative value
 * can never reach `src` - same "no CSS/HTML/colour/layout value from the feed" premise as AC2.
 * Not a schema/type change (084 owns that); an unusable image just falls back to `SlideText`,
 * exactly like a genuinely missing one already does.
 */
function isRenderableImageUrl(image: string | undefined): boolean {
  if (!image) return false
  try {
    const parsed = new URL(image)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

export function SlideBanner({ slide, onOpenUrl }: SlideTemplateProps) {
  if (!isRenderableImageUrl(slide.image)) {
    return <SlideText slide={slide} onOpenUrl={onOpenUrl} />
  }

  return (
    <div className="home-hero-slide home-hero-slide-banner">
      <div className="home-hero-media">
        <img src={slide.image} alt="" />
      </div>
      <div className="home-hero-content">
        <h2 className="home-hero-title">{slide.title}</h2>
        <p className="home-hero-body">{slide.body}</p>
        <SlideButtons buttons={slide.buttons} onOpenUrl={onOpenUrl} />
      </div>
    </div>
  )
}
