// Everything routes through one master gain, so mute and volume are real, and a
// context suspended by an iOS interruption gets resumed instead of going silent.
export function createAudio(saveStore) {
  let ctx = null;
  let master = null;
  let muted = !!(saveStore && saveStore.data.muted);

  function ensure() {
    if (!ctx) {
      const Ctor = window.AudioContext || window.webkitAudioContext;
      if (!Ctor) return null;
      try {
        ctx = new Ctor();
        master = ctx.createGain();
        master.gain.value = muted ? 0 : 0.9;
        master.connect(ctx.destination);
      } catch (e) {
        ctx = null;
        return null;
      }
    }
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return ctx;
  }

  function tone(freq, duration, type, volume, delay = 0) {
    const audio = ensure();
    if (!audio || muted) return;
    const at = audio.currentTime + delay;
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, at);
    gain.gain.setValueAtTime(volume, at);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);
    osc.connect(gain);
    gain.connect(master);
    osc.start(at);
    osc.stop(at + duration + 0.02);
  }

  // Browsers suspend audio when the tab is hidden or the OS interrupts it.
  const revive = () => { if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {}); };
  document.addEventListener('visibilitychange', () => { if (!document.hidden) revive(); });
  window.addEventListener('focus', revive);

  return {
    unlock: ensure,
    get muted() { return muted; },
    setMuted(next) {
      muted = !!next;
      if (master) master.gain.value = muted ? 0 : 0.9;
      if (saveStore) saveStore.update({ muted });
      return muted;
    },
    toggleMute() { return this.setMuted(!muted); },

    take(noiseAmount) {
      // Louder items get a lower, uglier thump.
      const pitch = 760 - Math.min(24, noiseAmount) * 14;
      tone(pitch, 0.07, 'square', 0.05);
      tone(pitch * 1.35, 0.07, 'square', 0.04, 0.06);
      tone(130 + noiseAmount, 0.18, 'sawtooth', 0.035, 0.02);
    },
    warn() { tone(110, 0.32, 'sawtooth', 0.07); },
    win() {
      tone(523, 0.1, 'triangle', 0.07);
      tone(659, 0.1, 'triangle', 0.07, 0.1);
      tone(784, 0.22, 'triangle', 0.07, 0.2);
    },
    lose() {
      tone(300, 0.2, 'sawtooth', 0.08);
      tone(200, 0.3, 'sawtooth', 0.08, 0.18);
      tone(120, 0.5, 'sawtooth', 0.08, 0.4);
    },
    ui() { tone(420, 0.05, 'triangle', 0.04); }
  };
}
