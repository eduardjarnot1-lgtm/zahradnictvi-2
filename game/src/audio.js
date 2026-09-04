// Everything routes through one master gain, so mute and volume are real, and a
// context suspended by an iOS interruption gets resumed instead of going silent.
// Muting is a *setting*, owned by the save's settings block. This module is
// told what to do and never writes progress itself.
export function createAudio(saveStore) {
  let ctx = null;
  let master = null;
  let muted = !(saveStore && saveStore.data.settings.sound);

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

  // A quiet two-note night drone. It is the "music" the settings toggle turns
  // off, so the toggle controls something real.
  let musicNodes = null;
  function startMusic() {
    const audio = ensure();
    if (!audio || musicNodes) return;
    const gain = audio.createGain();
    gain.gain.value = 0.014;
    gain.connect(master);
    const voices = [55, 82.5].map((freq, i) => {
      const osc = audio.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = freq;
      const lfo = audio.createOscillator();
      const lfoGain = audio.createGain();
      lfo.frequency.value = 0.05 + i * 0.03;
      lfoGain.gain.value = 1.5;
      lfo.connect(lfoGain);
      lfoGain.connect(osc.frequency);
      osc.connect(gain);
      osc.start();
      lfo.start();
      return [osc, lfo];
    });
    musicNodes = { gain, voices };
  }
  function stopMusic() {
    if (!musicNodes) return;
    for (const [osc, lfo] of musicNodes.voices) {
      try { osc.stop(); lfo.stop(); } catch (e) { /* already stopped */ }
    }
    try { musicNodes.gain.disconnect(); } catch (e) { /* already gone */ }
    musicNodes = null;
  }

  return {
    unlock: ensure,
    startMusic,
    stopMusic,
    get muted() { return muted; },
    setMuted(next) {
      muted = !!next;
      if (master) master.gain.value = muted ? 0 : 0.9;
      return muted;
    },
    toggleMute() { return this.setMuted(!muted); },

    // Louder items get a lower, uglier thump; fragile ones clink instead.
    take(noiseAmount, fragile) {
      if (fragile) {
        tone(1650, 0.05, 'triangle', 0.045);
        tone(2200, 0.06, 'triangle', 0.035, 0.04);
        tone(1400, 0.10, 'triangle', 0.025, 0.09);
        tone(150 + noiseAmount, 0.16, 'sawtooth', 0.04, 0.02);
        return;
      }
      const pitch = 760 - Math.min(28, noiseAmount) * 14;
      tone(pitch, 0.07, 'square', 0.05);
      tone(pitch * 1.35, 0.07, 'square', 0.04, 0.06);
      tone(130 + noiseAmount, 0.18, 'sawtooth', 0.035, 0.02);
    },

    // A dry knock under the foot.
    creak() {
      tone(220, 0.11, 'sawtooth', 0.05);
      tone(140, 0.20, 'sawtooth', 0.04, 0.05);
    },

    // Barely-there footfall, alternating so a walk cycle has two feet.
    step(left) {
      tone(left ? 96 : 108, 0.045, 'triangle', 0.022);
    },

    wake() {
      tone(180, 0.14, 'square', 0.07);
      tone(300, 0.12, 'square', 0.06, 0.1);
      tone(420, 0.4, 'sawtooth', 0.06, 0.2);
    },

    purchase() {
      tone(660, 0.08, 'triangle', 0.06);
      tone(880, 0.09, 'triangle', 0.06, 0.07);
      tone(1180, 0.16, 'triangle', 0.05, 0.15);
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
