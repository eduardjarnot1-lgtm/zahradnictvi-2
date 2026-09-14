/**
 * Audio: hearing German and speaking it.
 *
 * The research brief proposed Piper for text-to-speech and Whisper for speech
 * recognition. Neither is integrable here: the app is a static page with no
 * build step and no server, and both want tens of megabytes of model weights
 * plus a process to run them in. The browser already ships equivalents, so
 * those are what this module wraps:
 *
 *   speechSynthesis      — a German voice reads the word or sentence aloud
 *   SpeechRecognition    — a de-DE transcript of what the learner just said
 *
 * Both are optional. Speech synthesis with a German voice is common but not
 * guaranteed; speech recognition is Chromium-only today and needs microphone
 * permission on top. Every entry point below therefore reports whether it is
 * actually usable, and the rest of the app asks before offering the feature —
 * nothing here may throw into a render path or leave a dead button on screen.
 */

const LANG = 'de-DE';
const VOICE_LANG_PREFIX = 'de';

let voices = [];
let voicesRequested = false;

// --- speech synthesis --------------------------------------------------------

const synth = () => (typeof window !== 'undefined' ? window.speechSynthesis : null);

function refreshVoices() {
  const engine = synth();
  if (!engine) return;
  try {
    voices = engine.getVoices() || [];
  } catch {
    voices = [];
  }
}

/**
 * Voices load asynchronously in most browsers: the first getVoices() often
 * returns an empty list and a voiceschanged event follows. Ask once, listen
 * once, and let callers re-check.
 */
export function initAudio() {
  const engine = synth();
  if (!engine || voicesRequested) return;
  voicesRequested = true;
  refreshVoices();
  if (typeof engine.addEventListener === 'function') {
    engine.addEventListener('voiceschanged', refreshVoices);
  }
}

/** The German voice we would use, or null if the browser has none. */
export function germanVoice() {
  if (!voices.length) refreshVoices();
  return voices.find((voice) => voice.lang === LANG)
    || voices.find((voice) => (voice.lang || '').toLowerCase().startsWith(VOICE_LANG_PREFIX))
    || null;
}

/**
 * Can we read German aloud?
 *
 * True as soon as the engine exists — a browser with no German voice still
 * speaks German text through its default voice, badly but audibly, and the
 * voice list is frequently empty on the first call. Callers that care about
 * quality can check germanVoice() as well.
 */
export const canSpeak = () => Boolean(synth());

/** Do we have a real German voice, rather than a fallback? */
export const hasGermanVoice = () => Boolean(germanVoice());

/**
 * Speak German text. Cancels anything already in flight so that clicking two
 * speaker buttons in a row does not queue them up.
 */
export function speak(text, { rate = 0.95 } = {}) {
  const engine = synth();
  if (!engine || !text) return false;
  try {
    engine.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = LANG;
    utterance.rate = rate;
    const voice = germanVoice();
    if (voice) utterance.voice = voice;
    engine.speak(utterance);
    return true;
  } catch {
    return false;
  }
}

export function stopSpeaking() {
  const engine = synth();
  if (engine) {
    try { engine.cancel(); } catch { /* nothing to cancel */ }
  }
}

// --- speech recognition ------------------------------------------------------

const RecognitionClass = () => (typeof window === 'undefined'
  ? null
  : window.SpeechRecognition || window.webkitSpeechRecognition || null);

/** Is a de-DE transcript available in this browser at all? */
export const canListen = () => Boolean(RecognitionClass());

/**
 * Record one utterance and resolve with what the browser heard.
 *
 * Resolves `{ ok: true, transcript, confidence }` on success and
 * `{ ok: false, reason }` otherwise — never rejects, because every caller is a
 * UI handler and a rejected promise there is just an unhandled error. `reason`
 * is the browser's own error code ('not-allowed', 'no-speech', 'network', …)
 * so the UI can say something specific.
 */
export function listenOnce({ timeoutMs = 8000 } = {}) {
  const Recognition = RecognitionClass();
  if (!Recognition) return Promise.resolve({ ok: false, reason: 'unsupported' });

  return new Promise((resolve) => {
    let settled = false;
    let recogniser;
    const done = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { recogniser.stop(); } catch { /* already stopped */ }
      resolve(value);
    };

    try {
      recogniser = new Recognition();
    } catch {
      resolve({ ok: false, reason: 'unsupported' });
      return;
    }

    recogniser.lang = LANG;
    recogniser.interimResults = false;
    recogniser.maxAlternatives = 3;
    recogniser.continuous = false;

    const timer = setTimeout(() => done({ ok: false, reason: 'timeout' }), timeoutMs);

    recogniser.onresult = (event) => {
      const result = event.results && event.results[0];
      if (!result || !result[0]) {
        done({ ok: false, reason: 'no-speech' });
        return;
      }
      done({
        ok: true,
        transcript: result[0].transcript.trim(),
        confidence: result[0].confidence,
        alternatives: Array.from(result).map((alternative) => alternative.transcript.trim()),
      });
    };
    recogniser.onerror = (event) => done({ ok: false, reason: event.error || 'error' });
    recogniser.onend = () => done({ ok: false, reason: 'no-speech' });

    try {
      recogniser.start();
    } catch {
      done({ ok: false, reason: 'error' });
    }
  });
}

/** A human sentence for a failure reason from listenOnce. */
export const listenProblem = (reason) => ({
  unsupported: 'This browser cannot listen. Chrome and Edge can.',
  'not-allowed': 'Microphone access was refused, so nothing could be recorded.',
  'service-not-allowed': 'The browser blocked its speech service for this page.',
  'no-speech': 'Nothing was heard. Try again, a little closer to the microphone.',
  network: 'The browser could not reach its speech service.',
  timeout: 'Nothing was heard in time. Try again.',
}[reason] || 'The recording did not work. Try again.');
