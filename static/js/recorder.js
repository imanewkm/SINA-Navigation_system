/**
 * SINA Recorder — offline speech recognition via Whisper backend
 * ===============================================================
 * Replaces Chrome's cloud SpeechRecognition with server-side Whisper.
 * Works 100% offline once the tiny model is downloaded.
 *
 * Flow: getUserMedia → capture PCM → downsample to 16 kHz → encode WAV
 *       → POST /transcribe → Whisper returns text → callback
 *
 * API:
 *   SINARecorder.listen(lang, onResult, onError)
 *   SINARecorder.stop()
 *   SINARecorder.isActive()  → boolean
 */
window.SINARecorder = (function () {
  'use strict';

  const TARGET_SR        = 16000;   // Whisper expects 16 kHz
  const SILENCE_RMS      = 0.015;   // below this → silence (faster response while still filtering noise)
  const SILENCE_DELAY_MS = 1500;    // wait 1.5 s of silence before sending (down from 3.5 for faster interaction)
  const MIN_CHUNKS       = 15;      // ignore recordings shorter than ~1.3 s
  const MAX_DURATION_MS  = 12000;   // hard cap per utterance

  let _stream    = null;
  let _ctx       = null;
  let _processor = null;
  let _samples   = [];
  let _nativeSR  = TARGET_SR;
  let _active    = false;
  let _silenceT  = null;
  let _maxT      = null;
  let _lang      = 'fr';
  let _onResult  = null;
  let _onError   = null;

  /* ── WAV encoder (16-bit PCM mono) ──────────────────────────────────────── */
  function _toWAV(float32, sr) {
    const len  = float32.length;
    const buf  = new ArrayBuffer(44 + len * 2);
    const view = new DataView(buf);
    const str  = (o, s) => { for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i)); };

    str(0, 'RIFF'); view.setUint32(4, 36 + len * 2, true);
    str(8, 'WAVE'); str(12, 'fmt ');
    view.setUint32(16, 16, true);   // chunk size
    view.setUint16(20, 1,  true);   // PCM
    view.setUint16(22, 1,  true);   // mono
    view.setUint32(24, sr, true);   // sample rate
    view.setUint32(28, sr * 2, true); // byte rate
    view.setUint16(32, 2,  true);   // block align
    view.setUint16(34, 16, true);   // bits per sample
    str(36, 'data'); view.setUint32(40, len * 2, true);

    const out = new Int16Array(buf, 44);
    for (let i = 0; i < len; i++) {
      const s = Math.max(-1, Math.min(1, float32[i]));
      out[i]  = s < 0 ? s * 32768 : s * 32767;
    }
    return new Blob([buf], { type: 'audio/wav' });
  }

  /* ── Linear downsample to TARGET_SR ─────────────────────────────────────── */
  function _downsample(buf, from) {
    if (from === TARGET_SR) return buf;
    const ratio = from / TARGET_SR;
    const out   = new Float32Array(Math.round(buf.length / ratio));
    for (let i = 0; i < out.length; i++) {
      out[i] = buf[Math.floor(i * ratio)];
    }
    return out;
  }

  /* ── RMS energy of a buffer ──────────────────────────────────────────────── */
  function _rms(buf) {
    let s = 0;
    for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i];
    return Math.sqrt(s / buf.length);
  }

  /* ── Finish: merge, encode, POST ─────────────────────────────────────────── */
  function _finish() {
    if (!_active) return;
    _active = false;
    clearTimeout(_silenceT); _silenceT = null;
    clearTimeout(_maxT);     _maxT     = null;

    const savedSR = _nativeSR;   // save before teardown

    if (_processor) { try { _processor.disconnect(); } catch(_) {} _processor = null; }
    if (_ctx)       { _ctx.close().catch(() => {}); _ctx = null; }
    if (_stream)    { _stream.getTracks().forEach(t => t.stop()); _stream = null; }

    if (_samples.length < MIN_CHUNKS) {
      console.log('[Recorder] recording too short — ignoring');
      if (_onError) _onError('too-short');
      return;
    }

    // Merge chunks
    const total  = _samples.reduce((n, c) => n + c.length, 0);
    const merged = new Float32Array(total);
    let off = 0;
    for (const c of _samples) { merged.set(c, off); off += c.length; }
    _samples = [];

    const wav = _toWAV(_downsample(merged, savedSR), TARGET_SR);

    const fd = new FormData();
    fd.append('audio', wav, 'speech.wav');
    fd.append('lang', _lang);

    console.log('[Recorder] sending', (wav.size / 1024).toFixed(1), 'KB to /transcribe');

    fetch('/transcribe', { method: 'POST', body: fd })
      .then(r => {
        if (!r.ok) {
          console.error('[Recorder] /transcribe HTTP', r.status);
          if (_onError) _onError(r.status === 503 ? 'not-installed' : 'server-error');
          return null;
        }
        return r.json();
      })
      .then(d => {
        if (!d) return;
        const text = (d.text || '').trim();
        console.log('[Recorder] ←', JSON.stringify(text));
        if (text) { if (_onResult) _onResult(text); }
        else       { if (_onError)  _onError('empty'); }
      })
      .catch(e => {
        console.error('[Recorder] fetch error:', e);
        if (_onError) _onError('fetch-error');
      });
  }

  /* ── Public: listen ──────────────────────────────────────────────────────── */
  async function listen(lang, onResult, onError) {
    if (_active) _finish();

    _lang     = lang || 'fr';
    _onResult = onResult;
    _onError  = onError;
    _samples  = [];
    _active   = true;

    try {
      _stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    } catch (e) {
      _active = false;
      console.error('[Recorder] getUserMedia:', e.name);
      if (onError) onError('not-allowed');
      return;
    }

    _ctx       = new (window.AudioContext || window.webkitAudioContext)();
    _nativeSR  = _ctx.sampleRate;
    const src  = _ctx.createMediaStreamSource(_stream);
    _processor = _ctx.createScriptProcessor(4096, 1, 1);

    // Boost microphone gain to improve quiet speech detection (1.5x amplification)
    const gain = _ctx.createGain();
    gain.gain.value = 1.5;

    // Mute output so user doesn't hear themselves
    const mute = _ctx.createGain();
    mute.gain.value = 0;
    _processor.connect(mute);
    mute.connect(_ctx.destination);

    _processor.onaudioprocess = (e) => {
      if (!_active) return;
      const chunk = new Float32Array(e.inputBuffer.getChannelData(0));
      _samples.push(chunk);

      if (_rms(chunk) < SILENCE_RMS) {
        if (!_silenceT) _silenceT = setTimeout(_finish, SILENCE_DELAY_MS);
      } else {
        clearTimeout(_silenceT); _silenceT = null;
      }
    };

    src.connect(gain);
    gain.connect(_processor);
    _maxT = setTimeout(_finish, MAX_DURATION_MS);
    console.log('[Recorder] listening, lang:', _lang, 'nativeSR:', _nativeSR);
  }

  /* ── Public: stop ────────────────────────────────────────────────────────── */
  function stop() { _finish(); }

  /* ── Public: isActive ────────────────────────────────────────────────────── */
  function isActive() { return _active; }

  return { listen, stop, isActive };
})();
