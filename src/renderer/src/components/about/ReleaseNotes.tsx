import type { ReleaseNoteSection } from '@shared/release-notes'

/**
 * Story 099 D3: presentational rendering of a version's already-parsed release notes
 * (`ReleaseNoteSection[]`, produced by `parseReleaseNotes`/`extractVersionSection` in
 * `@shared/release-notes`, D1/D2).
 *
 * AC6: structurally impossible to inject markup. Every heading and item is a plain string
 * rendered as a React text child - never `dangerouslySetInnerHTML`, never an HTML string. A
 * raw-HTML-looking item (e.g. `<img src=x onerror="alert(1)">`) renders as inert visible text,
 * because React escapes text children by construction; there is no code path here that could turn
 * it into a real element.
 */
export function ReleaseNotes({ sections }: { sections: ReleaseNoteSection[] }) {
  return (
    <div className="space-y-3">
      {sections.map((section, sectionIndex) => (
        <div key={`${sectionIndex}-${section.heading}`} className="space-y-1">
          <h2 className="font-display text-xs tracking-[0.08em] text-ink-dim uppercase">
            {section.heading}
          </h2>
          <ul className="list-disc space-y-0.5 pl-4 text-xs leading-relaxed text-ink-dim">
            {section.items.map((item, itemIndex) => (
              <li key={itemIndex}>{item}</li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  )
}
