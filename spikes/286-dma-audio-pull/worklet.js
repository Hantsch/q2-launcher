// AudioWorklet: plays the engine's painted frames and reports what it consumed. Frames arrive as
// planar-stereo Float32 blocks over the port, or through a SharedArrayBuffer ring. (story 286)

const QUANTUM = 128

class EnginePlayer extends AudioWorkletProcessor {
  constructor(options) {
    super()
    const { sab } = options.processorOptions
    this.queue = []
    this.head = 0
    this.consumed = 0
    this.underruns = 0
    this.primed = false
    this.sinceReport = 0
    if (sab) {
      this.ring = new Float32Array(sab.ring)
      this.ringFrames = this.ring.length / 2
      this.ctl = new Int32Array(sab.ctl)
    } else {
      this.port.onmessage = ({ data }) => {
        this.queue.push(data.block)
        this.primed = true
      }
    }
  }

  process(_inputs, outputs) {
    const out = outputs[0]
    let got = 0
    if (this.ctl) {
      const written = Atomics.load(this.ctl, 0)
      if (!this.primed && written > 0) this.primed = true
      got = Math.max(0, Math.min(QUANTUM, written - this.consumed))
      for (let i = 0; i < got; i++) {
        const at = (this.consumed + i) % this.ringFrames
        out[0][i] = this.ring[at * 2]
        out[1][i] = this.ring[at * 2 + 1]
      }
    } else {
      while (got < QUANTUM && this.queue.length > 0) {
        const block = this.queue[0]
        const frames = block.length / 2
        const n = Math.min(QUANTUM - got, frames - this.head)
        out[0].set(block.subarray(this.head, this.head + n), got)
        out[1].set(block.subarray(frames + this.head, frames + this.head + n), got)
        got += n
        this.head += n
        if (this.head === frames) {
          this.queue.shift()
          this.head = 0
        }
      }
    }
    // Counting starts with the first frame handed over, not with the engine's boot.
    if (this.primed && got < QUANTUM) this.underruns++
    this.consumed += got
    if (this.ctl) {
      Atomics.store(this.ctl, 1, this.consumed)
      Atomics.store(this.ctl, 2, this.underruns)
    } else if (++this.sinceReport >= 4) {
      this.sinceReport = 0
      this.port.postMessage({ consumed: this.consumed, underruns: this.underruns })
    }
    return true
  }
}

registerProcessor('engine-player', EnginePlayer)
