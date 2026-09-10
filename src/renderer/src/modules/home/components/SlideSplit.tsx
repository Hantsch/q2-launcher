import { SlideButtons } from './SlideButtons'
import { SlideText, type SlideTemplateProps } from './SlideText'

/**
 * `split` template (story 083 D2, concept §6.3): title/body pane beside an image.
 *
 * Real image delivery is story 084's scope - `NewsSlide.image` is carried through today only as
 * a declared path, nothing resolves it to a servable URL yet, and no slide produced by the feed
 * pipeline will ever populate it before then. Rather than render a broken `<img>`, a slide with
 * no `image` falls back to the `text` layout (concept §6.2's "a known template with a missing
 * image is rendered by `text`"), which today is every `split` slide - the effective behaviour
 * stays indistinguishable from `text` until 084 lands.
 *
 * When an image *is* present, only `title`, `body`, `image` and `buttons` are read from the
 * slide - never spread - so nothing else a slide object carries (a feed-supplied `style` or
 * `className` included) can reach the DOM.
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

export function SlideSplit({ slide, onOpenUrl }: SlideTemplateProps) {
  if (!isRenderableImageUrl(slide.image)) {
    return <SlideText slide={slide} onOpenUrl={onOpenUrl} />
  }

  return (
    <div className="home-hero-slide home-hero-slide-split">
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
