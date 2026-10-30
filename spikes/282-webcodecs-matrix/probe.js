// Runs in the page: every probe fails soft (error recorded, run continues).
import {
  AudioSample,
  AudioSampleSource,
  CanvasSource,
  Mp4OutputFormat,
  Output,
  StreamTarget,
  canEncodeAudio,
} from 'mediabunny'
import { registerAacEncoder } from '@mediabunny/aac-encoder'

const msg = (e) => (e instanceof Error ? e.message : String(e))

// Order matters: codec outermost, then resolution, fps, acceleration - a later step picks the
// "first supported" entry from this list.
const CODECS = ['avc1.640028', 'avc1.4d0028', 'avc1.42e01f', 'vp09.00.10.08', 'av01.0.04M.08']
const SIZES = [
  [1280, 720],
  [1920, 1080],
]
const FPS = [30, 60]
const ACCEL = ['no-preference', 'prefer-hardware', 'prefer-software']

async function probeVideo() {
  const out = []
  for (const codec of CODECS)
    for (const [width, height] of SIZES)
      for (const framerate of FPS)
        for (const hardwareAcceleration of ACCEL) {
          const entry = { codec, width, height, framerate, hardwareAcceleration, supported: false }
          try {
            const r = await VideoEncoder.isConfigSupported({
              codec,
              width,
              height,
              framerate,
              bitrate: 8_000_000,
              hardwareAcceleration,
            })
            entry.supported = r.supported === true
          } catch (e) {
            entry.error = msg(e)
          }
          out.push(entry)
        }
  return out
}

async function probeAudio() {
  const configs = [
    { codec: 'mp4a.40.2', sampleRate: 48000, numberOfChannels: 2, bitrate: 160000 },
    { codec: 'opus', sampleRate: 48000, numberOfChannels: 2, bitrate: 128000 },
  ]
  const out = []
  for (const config of configs) {
    const entry = { ...config, supported: false }
    try {
      entry.supported = (await AudioEncoder.isConfigSupported(config)).supported === true
    } catch (e) {
      entry.error = msg(e)
    }
    out.push(entry)
  }
  return out
}

async function probeMediabunny() {
  const r = { aacBefore: false, aacAfter: false }
  try {
    r.aacBefore = (await canEncodeAudio('aac')) === true
  } catch (e) {
    r.aacBeforeError = msg(e)
  }
  try {
    registerAacEncoder()
    r.aacAfter = (await canEncodeAudio('aac')) === true
  } catch (e) {
    r.aacAfterError = msg(e)
  }
  return r
}

const QUADS = [
  { x: 0, y: 0, rgb: [255, 0, 0] },
  { x: 1, y: 0, rgb: [0, 255, 0] },
  { x: 0, y: 1, rgb: [0, 0, 255] },
  { x: 1, y: 1, rgb: [255, 255, 255] },
]

function draw(canvas, gl) {
  const w = canvas.width
  const h = canvas.height
  gl.disable(gl.SCISSOR_TEST)
  gl.clearColor(0, 0, 0, 1)
  gl.clear(gl.COLOR_BUFFER_BIT)
  gl.enable(gl.SCISSOR_TEST)
  for (const q of QUADS) {
    gl.scissor((q.x * w) / 2, (q.y * h) / 2, w / 2, h / 2)
    gl.clearColor(q.rgb[0] / 255, q.rgb[1] / 255, q.rgb[2] / 255, 1)
    gl.clear(gl.COLOR_BUFFER_BIT)
  }
}

// Reads the frame back as RGBA; a blank frame must not pass, so every quadrant is checked.
async function readFrame(canvas) {
  const frame = new VideoFrame(canvas, { timestamp: 0 })
  try {
    const w = frame.displayWidth
    const h = frame.displayHeight
    const buf = new Uint8Array(w * h * 4)
    await frame.copyTo(buf, { format: 'RGBA', rect: { x: 0, y: 0, width: w, height: h } })
    // GL quadrant y=0 is the bottom, canvas row 0 the top, so y is flipped for sampling.
    for (const q of QUADS) {
      const px = Math.floor(q.x * (w / 2) + w / 4)
      const py = Math.floor((1 - q.y) * (h / 2) + h / 4)
      const o = (py * w + px) * 4
      for (let c = 0; c < 3; c++) if (Math.abs(buf[o + c] - q.rgb[c]) > 8) return 'blank'
    }
    return 'pattern'
  } finally {
    frame.close()
  }
}

async function probeCapture() {
  let canvas
  let gl
  try {
    canvas = document.getElementById('c')
    gl = canvas.getContext('webgl2', { preserveDrawingBuffer: false })
    if (!gl) throw new Error('no webgl2 context')
  } catch (e) {
    const m = `error:${msg(e)}`
    return { sameTask: m, afterAwait: m }
  }
  const r = { sameTask: 'error:not run', afterAwait: 'error:not run' }
  try {
    draw(canvas, gl)
    r.sameTask = await readFrame(canvas)
  } catch (e) {
    r.sameTask = `error:${msg(e)}`
  }
  try {
    draw(canvas, gl)
    await new Promise((res) => setTimeout(res, 0))
    r.afterAwait = await readFrame(canvas)
  } catch (e) {
    r.afterAwait = `error:${msg(e)}`
  }
  return r
}

const SAMPLE_FRAMES = 600
const SAMPLE_FPS = 60
const SAMPLE_SECONDS = 10
const SAMPLE_RATE = 48000
const SAMPLE_CHANNELS = 2
const AUDIO_CHUNK = 1024

// Rotates the quadrant colours each frame so consecutive frames differ and a stuck canvas shows.
function drawRotating(canvas, gl, i) {
  const w = canvas.width
  const h = canvas.height
  gl.disable(gl.SCISSOR_TEST)
  gl.clearColor(0, 0, 0, 1)
  gl.clear(gl.COLOR_BUFFER_BIT)
  gl.enable(gl.SCISSOR_TEST)
  QUADS.forEach((q, n) => {
    const rgb = QUADS[(n + i) % QUADS.length].rgb
    gl.scissor((q.x * w) / 2, (q.y * h) / 2, w / 2, h / 2)
    gl.clearColor(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255, 1)
    gl.clear(gl.COLOR_BUFFER_BIT)
  })
}

async function writeSample(video, mediabunny) {
  const entry = video.find(
    (v) => v.supported && v.codec.startsWith('avc1.') && v.framerate === SAMPLE_FPS,
  )
  if (!entry) throw new Error('no supported avc1 60 fps entry in the matrix')
  const audioPath = mediabunny.aacBefore ? 'webcodecs' : 'polyfill'
  if (audioPath === 'polyfill' && !mediabunny.aacAfter)
    throw new Error('AAC unavailable natively and polyfill not registered')

  const canvas = document.getElementById('c')
  canvas.width = entry.width
  canvas.height = entry.height
  const gl = canvas.getContext('webgl2')
  if (!gl) throw new Error('no webgl2 context')

  let bytes = 0
  const writable = new WritableStream({
    async write({ data, position }) {
      await window.spike.write(position, data)
      bytes += data.byteLength
    },
  })
  const output = new Output({
    format: new Mp4OutputFormat({ fastStart: false }),
    target: new StreamTarget(writable, { chunked: true }),
  })
  const videoSource = new CanvasSource(canvas, {
    codec: 'avc',
    bitrate: 8_000_000,
    fullCodecString: entry.codec,
  })
  const audioSource = new AudioSampleSource({ codec: 'aac', bitrate: 160000 })
  output.addVideoTrack(videoSource, { frameRate: SAMPLE_FPS })
  output.addAudioTrack(audioSource)
  await output.start()

  const audioLoop = (async () => {
    const total = SAMPLE_RATE * SAMPLE_SECONDS
    for (let at = 0; at < total; at += AUDIO_CHUNK) {
      const n = Math.min(AUDIO_CHUNK, total - at)
      const data = new Float32Array(n * SAMPLE_CHANNELS)
      for (let k = 0; k < n; k++) {
        const s = 0.3 * Math.sin((2 * Math.PI * 440 * (at + k)) / SAMPLE_RATE)
        for (let c = 0; c < SAMPLE_CHANNELS; c++) data[k * SAMPLE_CHANNELS + c] = s
      }
      const sample = new AudioSample({
        data,
        format: 'f32',
        numberOfChannels: SAMPLE_CHANNELS,
        sampleRate: SAMPLE_RATE,
        timestamp: at / SAMPLE_RATE,
      })
      await audioSource.add(sample)
      sample.close()
    }
  })()
  const videoLoop = (async () => {
    for (let i = 0; i < SAMPLE_FRAMES; i++) {
      drawRotating(canvas, gl, i)
      await videoSource.add(i / SAMPLE_FPS, 1 / SAMPLE_FPS)
    }
  })()
  await Promise.all([audioLoop, videoLoop])
  await output.finalize()
  await window.spike.finish()
  return { codec: entry.codec, width: entry.width, height: entry.height, audioPath, bytes }
}

const report = {
  electron: null,
  chrome: null,
  platform: null,
  video: [],
  audio: [],
  mediabunny: { aacBefore: false, aacAfter: false },
  capture: { sameTask: 'error:not run', afterAwait: 'error:not run' },
  sample: null,
}
try {
  const ua = navigator.userAgent
  report.electron = /Electron\/([\d.]+)/.exec(ua)?.[1] ?? null
  report.chrome = /Chrome\/([\d.]+)/.exec(ua)?.[1] ?? null
  report.platform = navigator.platform
} catch (e) {
  report.versionError = msg(e)
}
report.video = await probeVideo()
report.audio = await probeAudio()
report.mediabunny = await probeMediabunny()
report.capture = await probeCapture()
try {
  report.sample = await writeSample(report.video, report.mediabunny)
} catch (e) {
  report.sampleError = msg(e)
}
window.spike.report(JSON.stringify(report))
