// Tiny WebAudio synth for Market Quest — no assets, just oscillators.
// All methods are safe to call before unlock(); they simply do nothing.

type Note = [freq: number, at: number, dur: number]

export interface Sfx {
  unlock(): void
  setMuted(m: boolean): void
  scan(): void
  acquire(): void
  remove(): void
  orb(): void
  results(): void
  mission(): void
}

const MUTE_KEY = 'mq-muted'

export function loadMuted(): boolean {
  try { return localStorage.getItem(MUTE_KEY) === '1' } catch { return false }
}
export function saveMuted(m: boolean): void {
  try { localStorage.setItem(MUTE_KEY, m ? '1' : '0') } catch { /* ignore */ }
}

export function createSfx(initialMuted: boolean): Sfx {
  let ctx: AudioContext | null = null
  let muted = initialMuted

  const play = (notes: Note[], type: OscillatorType = 'sine', vol = 0.16) => {
    if (muted || !ctx) return
    const t0 = ctx.currentTime
    for (const [freq, at, dur] of notes) {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = type
      osc.frequency.value = freq
      gain.gain.setValueAtTime(0, t0 + at)
      gain.gain.linearRampToValueAtTime(vol, t0 + at + 0.012)
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + at + dur)
      osc.connect(gain).connect(ctx.destination)
      osc.start(t0 + at)
      osc.stop(t0 + at + dur + 0.02)
    }
  }

  return {
    unlock() {
      if (!ctx) {
        try {
          ctx = new AudioContext()
        } catch { ctx = null }
      }
      ctx?.resume().catch(() => { /* ignore */ })
    },
    setMuted(m) { muted = m },
    scan() { play([[880, 0, 0.07]], 'sine', 0.07) },
    acquire() { play([[523.25, 0, 0.12], [783.99, 0.09, 0.16]], 'triangle', 0.18) },
    remove() { play([[330, 0, 0.1], [220, 0.08, 0.14]], 'sawtooth', 0.08) },
    orb() { play([[659.25, 0, 0.1], [880, 0.08, 0.1], [1318.5, 0.16, 0.2]], 'triangle', 0.14) },
    results() { play([[523.25, 0, 0.14], [659.25, 0.12, 0.14], [783.99, 0.24, 0.14], [1046.5, 0.36, 0.3]], 'triangle', 0.16) },
    mission() { play([[587.33, 0, 0.12], [739.99, 0.1, 0.12], [880, 0.2, 0.12], [1174.7, 0.3, 0.35]], 'square', 0.09) },
  }
}
