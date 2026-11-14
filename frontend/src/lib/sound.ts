// Sound design, synthesized with the Web Audio API — no audio files.
// Palette: soft sine/triangle bells for interface feedback, short filtered-noise transients
// for mechanical parts (latches, valve, lid), and a generated room reverb for space.
// Everything stays quiet and short; the only "musical" moment is the reveal, scaled by rarity.

type Wave = OscillatorType

interface ToneOpts {
  type?: Wave
  attack?: number
  decay?: number
  gain?: number
  /** frequency to glide to over the note */
  glide?: number
  /** reverb send amount 0..1 */
  send?: number
  detune?: number
}

interface NoiseOpts {
  dur: number
  filter?: BiquadFilterType
  from: number
  to?: number
  q?: number
  gain?: number
  attack?: number
  send?: number
}

const STORAGE_KEY = 'ncs.muted'
const PENTATONIC = [523.25, 659.25, 783.99, 1046.5, 1318.51, 1567.98] // C major pentatonic, C5 up

function loadMuted() {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

class SoundEngine {
  private ctx: AudioContext | null = null
  private master!: GainNode
  private dry!: GainNode
  private wet!: GainNode
  private noiseBuf!: AudioBuffer
  private listeners = new Set<() => void>()
  muted = loadMuted()

  // ---------- setup ----------

  /** Created lazily on the first sound, which always follows a user gesture */
  private init(): AudioContext | null {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume()
      return this.ctx
    }
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AC) return null
    const ctx = new AC()

    const comp = ctx.createDynamicsCompressor()
    comp.threshold.value = -20
    comp.ratio.value = 3
    comp.attack.value = 0.003
    comp.release.value = 0.25

    this.master = ctx.createGain()
    this.master.gain.value = this.muted ? 0 : 0.8
    this.master.connect(comp).connect(ctx.destination)

    this.dry = ctx.createGain()
    this.dry.connect(this.master)

    const verb = ctx.createConvolver()
    verb.buffer = this.impulse(ctx, 2.4, 3.2)
    this.wet = ctx.createGain()
    this.wet.gain.value = 0.28
    this.wet.connect(verb).connect(this.master)

    this.noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate)
    const data = this.noiseBuf.getChannelData(0)
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1

    this.ctx = ctx
    return ctx
  }

  /** Stereo room impulse: decaying noise with a darker tail */
  private impulse(ctx: AudioContext, seconds: number, decay: number) {
    const len = Math.floor(ctx.sampleRate * seconds)
    const buf = ctx.createBuffer(2, len, ctx.sampleRate)
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch)
      let lp = 0
      for (let i = 0; i < len; i++) {
        const t = i / len
        lp += (Math.random() * 2 - 1 - lp) * (0.5 - 0.4 * t) // tail gets darker over time
        d[i] = lp * Math.pow(1 - t, decay)
      }
    }
    return buf
  }

  // ---------- voices ----------

  private tone(freq: number, at: number, o: ToneOpts = {}) {
    const ctx = this.ctx!
    const { type = 'sine', attack = 0.004, decay = 0.3, gain = 0.15, glide, send = 0.3, detune = 0 } = o
    const osc = ctx.createOscillator()
    osc.type = type
    osc.frequency.setValueAtTime(freq, at)
    if (glide) osc.frequency.exponentialRampToValueAtTime(glide, at + attack + decay)
    osc.detune.value = detune
    const g = ctx.createGain()
    g.gain.setValueAtTime(0, at)
    g.gain.linearRampToValueAtTime(gain, at + attack)
    g.gain.exponentialRampToValueAtTime(0.0001, at + attack + decay)
    osc.connect(g)
    g.connect(this.dry)
    if (send > 0) {
      const s = ctx.createGain()
      s.gain.value = send
      g.connect(s).connect(this.wet)
    }
    osc.start(at)
    osc.stop(at + attack + decay + 0.05)
  }

  /** Bell: fundamental plus inharmonic partials, like a small struck metal bar */
  private bell(freq: number, at: number, gain = 0.08, decay = 0.9, send = 0.45) {
    this.tone(freq, at, { gain, decay, send })
    this.tone(freq * 2.76, at, { gain: gain * 0.35, decay: decay * 0.45, send })
    this.tone(freq * 5.4, at, { gain: gain * 0.12, decay: decay * 0.2, send })
  }

  private noise(at: number, o: NoiseOpts) {
    const ctx = this.ctx!
    const { dur, filter = 'bandpass', from, to, q = 1, gain = 0.15, attack = 0.003, send = 0.15 } = o
    const src = ctx.createBufferSource()
    src.buffer = this.noiseBuf
    src.loop = true
    const f = ctx.createBiquadFilter()
    f.type = filter
    f.Q.value = q
    f.frequency.setValueAtTime(from, at)
    if (to) f.frequency.exponentialRampToValueAtTime(to, at + dur)
    const g = ctx.createGain()
    g.gain.setValueAtTime(0, at)
    g.gain.linearRampToValueAtTime(gain, at + attack)
    g.gain.exponentialRampToValueAtTime(0.0001, at + Math.max(attack + 0.005, dur))
    src.connect(f).connect(g)
    g.connect(this.dry)
    if (send > 0) {
      const s = ctx.createGain()
      s.gain.value = send
      g.connect(s).connect(this.wet)
    }
    src.start(at, Math.random() * 0.5)
    src.stop(at + dur + 0.05)
  }

  /** Runs a cue only when audio is available and not muted */
  private play(cue: (now: number) => void) {
    if (this.muted) return
    const ctx = this.init()
    if (!ctx) return
    cue(ctx.currentTime + 0.01)
  }

  // ---------- interface cues ----------

  /** Small control change: segmented control, stepper, disclosure */
  tap() {
    this.play((t) => {
      this.noise(t, { dur: 0.012, filter: 'highpass', from: 3500, gain: 0.07, send: 0 })
      this.tone(1760, t, { decay: 0.03, gain: 0.02, send: 0 })
    })
  }

  /** Switching tier: a soft pluck that rises with the tier */
  select(tierIndex: number) {
    this.play((t) => {
      const f = [392, 440, 523.25, 587.33, 659.25][tierIndex] ?? 440
      this.noise(t, { dur: 0.01, filter: 'highpass', from: 3000, gain: 0.05, send: 0 })
      this.tone(f, t, { type: 'triangle', decay: 0.22, gain: 0.07, send: 0.2 })
      this.tone(f * 2, t + 0.005, { decay: 0.12, gain: 0.025, send: 0.2 })
    })
  }

  connect() {
    this.play((t) => {
      ;[523.25, 659.25, 783.99].forEach((f, i) => this.tone(f, t + i * 0.07, { decay: 0.5, gain: 0.06, send: 0.35 }))
    })
  }

  /** Purchase confirmed */
  buy() {
    this.play((t) => {
      this.bell(783.99, t, 0.07, 0.7)
      this.bell(1174.66, t + 0.09, 0.06, 0.9)
    })
  }

  sell() {
    this.play((t) => {
      this.bell(987.77, t, 0.06, 0.5)
      this.bell(1318.51, t + 0.07, 0.06, 0.7)
      this.noise(t, { dur: 0.04, filter: 'highpass', from: 6000, gain: 0.03 })
    })
  }

  /** Item stored: a low, soft tuck */
  keep() {
    this.play((t) => {
      this.tone(392, t, { type: 'triangle', glide: 262, decay: 0.24, gain: 0.08, send: 0.2 })
      this.noise(t, { dur: 0.03, filter: 'lowpass', from: 900, gain: 0.08, send: 0 })
    })
  }

  error() {
    this.play((t) => {
      this.tone(311.13, t, { type: 'triangle', decay: 0.16, gain: 0.08, send: 0.1 })
      this.tone(233.08, t + 0.13, { type: 'triangle', decay: 0.24, gain: 0.08, send: 0.1 })
    })
  }

  /** Sheet presentation: a quiet air movement up (open) or down (close) */
  sheet(open: boolean) {
    this.play((t) => {
      this.noise(t, { dur: 0.24, filter: 'bandpass', from: open ? 450 : 1400, to: open ? 1400 : 450, q: 0.8, gain: 0.035, attack: 0.06, send: 0.1 })
    })
  }

  // ---------- case opening ----------

  /** Spring latch releasing: bright metal snap over a short body thunk; brighter on higher tiers */
  private latch(at: number, tier: number) {
    this.noise(at, { dur: 0.022, filter: 'bandpass', from: 2200 + tier * 450, q: 2.5, gain: 0.32, send: 0.12 })
    this.tone(150 - tier * 6, at, { type: 'sine', glide: 85, decay: 0.07, gain: 0.22, send: 0.05 })
    this.noise(at + 0.038, { dur: 0.012, filter: 'bandpass', from: 3200 + tier * 400, q: 3, gain: 0.1, send: 0.1 })
  }

  /**
   * Mechanical sequence matched to the 3D timeline (CaseStage): two latches snap open,
   * the purge valve vents, then the lid swings up with a low air movement. Crystal tiers
   * add a faint glassy shimmer as the light inside comes up.
   */
  open(durationMs: number, tier: number) {
    this.play((t) => {
      const s = durationMs / 1000
      this.latch(t + 0.13 * s, tier)
      this.latch(t + 0.24 * s, tier)
      // valve vent
      this.noise(t + 0.3 * s, { dur: 0.5, filter: 'bandpass', from: 7000, to: 2600, q: 0.7, gain: 0.05, attack: 0.02, send: 0.2 })
      // lid swing: air swell and a low hinge creak
      const lid = t + 0.36 * s
      const swing = 0.52 * s
      this.noise(lid, { dur: swing, filter: 'lowpass', from: 220, to: 1100, q: 0.6, gain: 0.07, attack: swing * 0.45, send: 0.3 })
      this.tone(74, lid, { type: 'triangle', glide: 58, attack: 0.08, decay: swing, gain: 0.035, send: 0.1 })
      if (tier >= 3) {
        ;[2093, 2637.02, 3135.96, 4186.01].forEach((f, i) => this.tone(f, lid + swing * 0.55 + i * 0.06, { decay: 1.1, gain: 0.014, send: 0.7 }))
      }
    })
  }

  /** Reveal chime: more notes and a warmer pad for rarer items (0 Common … 4 Legendary) */
  reveal(rarity: number) {
    this.play((t) => {
      const notes = PENTATONIC.slice(0, rarity + 2)
      notes.forEach((f, i) => this.bell(f, t + i * 0.085, 0.06 + rarity * 0.006, 1.1 + rarity * 0.25))
      if (rarity >= 3) {
        // sustained pad, slightly detuned for width
        ;[261.63, 329.63, 392].forEach((f) => {
          this.tone(f, t + 0.1, { attack: 0.35, decay: 2.4, gain: 0.03, send: 0.6, detune: -6 })
          this.tone(f, t + 0.1, { attack: 0.35, decay: 2.4, gain: 0.03, send: 0.6, detune: 6 })
        })
      }
      if (rarity === 4) {
        ;[2093, 2637.02, 3135.96, 4186.01, 5274.04].forEach((f, i) => this.tone(f, t + 0.45 + i * 0.07, { decay: 1.4, gain: 0.016, send: 0.8 }))
      }
    })
  }

  // ---------- mute ----------

  setMuted(muted: boolean) {
    this.muted = muted
    try {
      localStorage.setItem(STORAGE_KEY, muted ? '1' : '0')
    } catch {
      // storage unavailable: preference lasts for this session only
    }
    if (this.ctx) this.master.gain.setTargetAtTime(muted ? 0 : 0.8, this.ctx.currentTime, 0.05)
    this.listeners.forEach((l) => l())
  }

  subscribe = (l: () => void) => {
    this.listeners.add(l)
    return () => void this.listeners.delete(l)
  }
}

export const sound = new SoundEngine()

export const RARITY_INDEX: Record<string, number> = { Common: 0, Uncommon: 1, Rare: 2, Epic: 3, Legendary: 4 }
