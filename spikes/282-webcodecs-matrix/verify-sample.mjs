// Reads the spike's sample MP4 back with Mediabunny and checks frame count and audio duration.
// Usage: node verify-sample.mjs <file>; exits 1 on any gap or unreadable file.

import { readFileSync } from 'node:fs'
import { ALL_FORMATS, BufferSource, EncodedPacketSink, Input } from 'mediabunny'

const file = process.argv[2]
if (!file) {
  console.error('usage: node verify-sample.mjs <file>')
  process.exit(1)
}

try {
  const input = new Input({ source: new BufferSource(readFileSync(file)), formats: ALL_FORMATS })
  const video = await input.getPrimaryVideoTrack()
  const audio = await input.getPrimaryAudioTrack()
  if (!video || !audio) throw new Error(`missing track (video=${!!video} audio=${!!audio})`)
  let frames = 0
  for await (const _packet of new EncodedPacketSink(video).packets()) frames++
  const seconds = await audio.computeDuration()
  console.log(`frames=${frames} audio=${seconds.toFixed(2)}s`)
  process.exit(frames >= 599 && frames <= 601 && Math.abs(seconds - 10) <= 1 / 60 ? 0 : 1)
} catch (e) {
  console.error(`verify failed: ${e instanceof Error ? e.message : e}`)
  process.exit(1)
}
