// @vitest-environment jsdom
import { useState } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { initI18n } from '../../../i18n'
import { VolumeControl } from './VolumeControl'
import type { PlaybackVolume } from '../playback-store'

const sent: PlaybackVolume[] = []

function Harness() {
  const [volume, setVolume] = useState<PlaybackVolume>({ percent: 60, muted: false })
  return (
    <VolumeControl
      volume={volume}
      focusRing=""
      onChange={(next) => {
        sent.push(next)
        setVolume(next)
      }}
    />
  )
}

beforeAll(async () => {
  await initI18n('en')
})
afterEach(() => {
  cleanup()
  sent.length = 0
})

const toggle = () => screen.getByTestId('replays-timeline-volume-toggle')
const slider = () => screen.getByTestId('replays-timeline-volume') as HTMLInputElement
const label = () => screen.getByTestId('replays-timeline-volume-label')
const icon = () => toggle().querySelector('svg')?.getAttribute('class') ?? ''

describe('volume control', () => {
  it('shows a speaker button and a 0–100 slider', () => {
    render(<Harness />)
    expect(toggle().getAttribute('aria-pressed')).toBe('false')
    expect(slider().min).toBe('0')
    expect(slider().max).toBe('100')
    expect(slider().value).toBe('60')
    expect(label().textContent).toBe('60 %')
  })

  it('mute shows the crossed-out speaker and the Muted label, unmute restores the level', () => {
    render(<Harness />)
    fireEvent.click(toggle())
    expect(toggle().getAttribute('aria-pressed')).toBe('true')
    expect(icon()).toContain('lucide-volume-x')
    expect(label().textContent).toBe('Muted')
    fireEvent.click(toggle())
    expect(sent.at(-1)).toEqual({ percent: 60, muted: false })
    expect(label().textContent).toBe('60 %')
    expect(icon()).toContain('lucide-volume-2')
  })

  it('arrow keys step the slider by 5 and Enter/Space toggle mute', () => {
    render(<Harness />)
    expect(slider().step).toBe('5')
    // jsdom does not turn arrow keys into value changes; the native step is asserted above.
    fireEvent.change(slider(), { target: { value: '65' } })
    expect(sent.at(-1)).toEqual({ percent: 65, muted: false })
    // Enter and Space activate a native button as a click.
    fireEvent.click(toggle())
    expect(sent.at(-1)).toEqual({ percent: 65, muted: true })
  })

  it('both controls carry accessible names', () => {
    render(<Harness />)
    expect(screen.getByRole('button', { name: 'Mute' })).toBe(toggle())
    expect(screen.getByRole('slider', { name: 'Game volume' })).toBe(slider())
    expect(slider().getAttribute('aria-valuetext')).toBe('60 %')
  })
})
