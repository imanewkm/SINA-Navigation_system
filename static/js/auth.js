/**
 * SINA auth.js — voice-guided login & register
 * Shared by login.html (SINA_PAGE='login') and register.html (SINA_PAGE='register')
 *
 * State machine:
 *   login:    IDLE → ASK_USERNAME → CAPTURE_USERNAME → ASK_PIN → CAPTURE_PIN → SUBMITTING
 *   register: IDLE → ASK_USERNAME → CAPTURE_USERNAME → ASK_PIN → CAPTURE_PIN → SUBMITTING
 */
(function () {
  'use strict';

  /* ── Config from template ────────────────────────────────────────────────────
   * const/let in a <script> tag are global but NOT window properties in Chrome.
   * Access them by name with a typeof guard instead of window.SINA_*          */
  const LANG = (typeof SINA_LANG !== 'undefined' ? SINA_LANG : null) || 'fr';
  const UI   = (typeof SINA_UI   !== 'undefined' ? SINA_UI   : null) || {};
  const PAGE = (typeof SINA_PAGE !== 'undefined' ? SINA_PAGE : null) || 'login';

  /* ── Recognition locale map ──────────────────────────────────────────────── */
  const REC_LANG = { fr: 'fr-FR', en: 'en-US', ar: 'ar-MA' };

  /* ── Word lists ──────────────────────────────────────────────────────────── */
  const WORDS = {
    help:     { fr: ['aide','aidez','aider','help'],            en: ['help','assist'],              ar: ['مساعدة','ساعدني'] },
    login:    { fr: ['connexion','connecter','login'],          en: ['login','sign in','signin'],   ar: ['دخول','تسجيل الدخول','ادخل'] },
    register: { fr: ['inscription','inscrire','register'],     en: ['register','sign up','signup'], ar: ['تسجيل','سجل','إنشاء'] },
    yes:      { fr: ['oui','yes','confirmer','correct','ok'],   en: ['yes','correct','confirm','ok'],ar: ['نعم','أيوه','صح','تمام'] },
    no:       { fr: ['non','no','annuler'],                     en: ['no','cancel','wrong'],         ar: ['لا','خطأ','الغ'] },
  };

  /* ── Digit word map ──────────────────────────────────────────────────────── */
  const DIGIT_MAP = {
    fr: { 'zéro':0,'zero':0,'un':1,'une':1,'deux':2,'trois':3,'quatre':4,
          'cinq':5,'six':6,'sept':7,'huit':8,'neuf':9 },
    en: { 'zero':0,'one':1,'two':2,'three':3,'four':4,
          'five':5,'six':6,'seven':7,'eight':8,'nine':9 },
    ar: { 'صفر':0,'واحد':1,'اثنين':2,'اثنان':2,'ثلاثة':3,'أربعة':4,
          'خمسة':5,'ستة':6,'سبعة':7,'ثمانية':8,'تسعة':9 },
  };

  /* ── DOM ─────────────────────────────────────────────────────────────────── */
  const orbC      = document.getElementById('orbContainer');
  const micBtn    = document.getElementById('micBtn');
  const statusTxt = document.getElementById('statusText');
  const txUser    = document.getElementById('transcriptUser');
  const txResp    = document.getElementById('transcriptResponse');
  const aPanel    = document.getElementById('assistedPanel');
  const aUsername = document.getElementById('assistedUsername');
  const aEmail    = document.getElementById('assistedEmail');   // null on login page
  const aPin      = document.getElementById('assistedPin');
  const aReadback = document.getElementById('assistedReadback');
  const codeBox   = document.getElementById('familyCodeBox');   // null on login page
  const codeVal   = document.getElementById('familyCodeValue'); // null on login page

  /* ── Browser compatibility check ────────────────────────────────────────── */
  const HAS_RECOGNITION = !!(window.SpeechRecognition || window.webkitSpeechRecognition);
  const HAS_SYNTHESIS   = !!window.speechSynthesis;

  /* ── State ───────────────────────────────────────────────────────────────── */
  let state      = 'IDLE';
  let rec        = null;
  let failCount  = 0;
  let captUser   = '';
  let captPin    = '';
  let audioCtx   = null;

  /* ── Audio ───────────────────────────────────────────────────────────────── */
  function tone(freq, dur, vol) {
    try {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = audioCtx.createOscillator();
      const g   = audioCtx.createGain();
      osc.connect(g); g.connect(audioCtx.destination);
      osc.frequency.value = freq;
      g.gain.setValueAtTime(0, audioCtx.currentTime);
      g.gain.linearRampToValueAtTime(vol || 0.12, audioCtx.currentTime + 0.01);
      g.gain.linearRampToValueAtTime(0, audioCtx.currentTime + dur);
      osc.start(); osc.stop(audioCtx.currentTime + dur + 0.02);
    } catch(_) {}
  }

  /* ── TTS ─────────────────────────────────────────────────────────────────── */
  const TTS_LANG = { fr: 'fr-FR', en: 'en-US', ar: 'ar-SA' };

  function speak(text, onEnd) {
    console.log('[SINA] speak():', text);
    if (!HAS_SYNTHESIS) {
      console.warn('[SINA] speechSynthesis not available');
      setVisual('idle');
      if (onEnd) onEnd();
      return;
    }
    window.speechSynthesis.cancel();
    setVisual('responding');
    statusTxt.textContent = text;
    txResp.textContent    = text;

    const utt  = new SpeechSynthesisUtterance(text);
    utt.lang   = TTS_LANG[LANG] || 'fr-FR';
    utt.rate   = LANG === 'ar' ? 0.85 : 0.9;

    const voices = window.speechSynthesis.getVoices();
    console.log('[SINA] voices available:', voices.length);
    const voice  = voices.find(v => v.lang.startsWith(LANG === 'ar' ? 'ar' : LANG));
    if (voice) { utt.voice = voice; console.log('[SINA] voice selected:', voice.name); }
    else        { console.warn('[SINA] no matching voice — using browser default'); }

    let done = false;
    const proceed = () => {
      if (done) return;
      done = true;
      console.log('[SINA] speak() done, next →', onEnd ? 'callback' : 'nothing');
      setVisual('idle');
      if (onEnd) onEnd();
    };
    utt.onend   = () => { console.log('[SINA] utterance ended normally'); proceed(); };
    utt.onerror = (e) => { console.warn('[SINA] utterance error:', e.error); proceed(); };
    // Safety-net timeout — onend fires reliably so this rarely triggers.
    // Must be longer than the longest expected utterance so it doesn't
    // fire while TTS is still speaking (which would start the mic too early).
    setTimeout(proceed, Math.max(15000, text.length * 90));

    window.speechSynthesis.speak(utt);
    console.log('[SINA] speechSynthesis.speak() called, pending:', window.speechSynthesis.pending);
  }

  /* ── Visual state ────────────────────────────────────────────────────────── */
  function setVisual(s) {
    orbC.classList.remove('listening', 'responding');
    micBtn.classList.remove('active');
    const iconMic  = micBtn.querySelector('.icon-mic');
    const iconStop = micBtn.querySelector('.icon-stop');
    if (s === 'listening') {
      orbC.classList.add('listening');
      micBtn.classList.add('active');
      if (iconMic)  iconMic.style.display  = 'none';
      if (iconStop) iconStop.style.display = '';
    } else if (s === 'responding') {
      orbC.classList.add('responding');
      if (iconMic)  iconMic.style.display  = '';
      if (iconStop) iconStop.style.display = 'none';
    } else {
      if (iconMic)  iconMic.style.display  = '';
      if (iconStop) iconStop.style.display = 'none';
    }
  }

  /* ── Helpers ─────────────────────────────────────────────────────────────── */
  function matches(text, key) {
    return (WORDS[key]?.[LANG] || []).some(w => text.includes(w));
  }

  function extractPin(text) {
    const map    = DIGIT_MAP[LANG] || DIGIT_MAP.fr;
    const words  = text.toLowerCase().trim().split(/\s+/);
    const digits = words.map(w => map[w] !== undefined ? String(map[w]) : null)
                        .filter(Boolean).join('');
    if (digits.length >= 4) return digits;
    const raw = text.replace(/\D/g, '');
    return raw.length >= 4 ? raw : (digits || raw);
  }

  /* ── Recognition (via Whisper backend — works offline) ───────────────────── */
  function stopRec() {
    if (window.SINARecorder) SINARecorder.stop();
    setVisual('idle');
  }

  function listen(onResult) {
    stopRec();
    state = 'LISTENING';

    const listeningMsg = LANG === 'fr' ? 'Je vous écoute…'
                       : LANG === 'en' ? 'Listening…'
                       :                  'أستمع…';
    statusTxt.textContent = listeningMsg;
    setVisual('listening');

    SINARecorder.listen(
      LANG,
      /* onResult */ (text) => {
        txUser.textContent = text;
        console.log('[SINA] heard:', text);
        if (matches(text, 'help')) { showAssisted(); return; }
        onResult(text);
      },
      /* onError  */ (err) => {
        console.warn('[SINA] recorder error:', err);

        if (err === 'not-allowed') {
          const msg = LANG === 'fr' ? 'Microphone refusé. Autorisez-le dans les paramètres du navigateur.'
                    : LANG === 'en' ? 'Microphone blocked. Allow it in browser settings.'
                    :                  'الميكروفون محظور. اسمح به في إعدادات المتصفح.';
          speak(msg); setVisual('idle'); return;
        }

        if (err === 'not-installed') {
          const msg = LANG === 'fr' ? 'Le service vocal est indisponible. Redémarrez l\'application.'
                    : LANG === 'en' ? 'Speech service unavailable. Please restart the app.'
                    :                  'خدمة الصوت غير متاحة. أعد تشغيل التطبيق.';
          speak(msg); setVisual('idle'); return;   // do NOT retry
        }

        if (err === 'too-short') {
          // Too brief — restart silently, no penalty
          setTimeout(() => listen(onResult), 300); return;
        }

        // 'empty', 'server-error', 'fetch-error' all count toward the failure limit
        failCount++;
        console.warn('[SINA] fail count:', failCount);
        if (failCount >= 5) { showAssisted(); return; }
        setTimeout(() => listen(onResult), 600);
      }
    );
  }

  /* ── State machine (username-only, no PIN) ───────────────────────────────── */
  function start() {
    console.log('[SINA] start() called, state:', state, 'page:', PAGE, 'lang:', LANG);
    if (state !== 'IDLE') { console.log('[SINA] already running — ignoring'); return; }
    tone(600, 0.2, 0.12);

    if (PAGE === 'login') {
      speak(UI.welcome, () => {
        state = 'CHOOSE_ACTION';
        listen((text) => {
          if (matches(text, 'register')) {
            window.location.href = '/register?lang=' + LANG;
          } else {
            askUsername();
          }
        });
      });
    } else {
      speak(UI.reg_say_username, () => {
        state = 'CAPTURE_USERNAME';
        listenForUsername();
      });
    }
  }

  function askUsername() {
    speak(UI.say_username, () => {
      state = 'CAPTURE_USERNAME';
      listenForUsername();
    });
  }

  function listenForUsername() {
    listen((text) => {
      const username = text.trim().replace(/\s+/g, '').toLowerCase();
      if (!username) { askUsername(); return; }
      captUser = username;
      confirmUsername(username);
    });
  }

  // Read back the captured name and ask for confirmation before submitting
  function confirmUsername(username) {
    const msg = LANG === 'fr' ? `J'ai entendu : ${username}. Est-ce correct ? Dites oui pour confirmer ou non pour recommencer.`
              : LANG === 'en' ? `I heard: ${username}. Is that correct? Say yes to confirm or no to try again.`
              :                  `سمعت: ${username}. هل هذا صحيح؟ قل نعم للتأكيد أو لا للمحاولة مرة أخرى.`;
    speak(msg, () => {
      state = 'CONFIRM_USERNAME';
      // Pause after TTS so mic doesn't capture audio residue
      setTimeout(() => listen((response) => {
        if (matches(response, 'yes')) {
          submit(username);
        } else {
          askUsername();
        }
      }), 800);
    });
  }

  function submit(username) {
    state = 'SUBMITTING';
    stopRec();

    const url  = PAGE === 'register' ? '/api/register' : '/api/login';
    const body = PAGE === 'register'
      ? { username, language: LANG }
      : { username };

    fetch(url, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    })
    .then(r => r.json())
    .then(data => {
      if (data.ok) {
        if (PAGE === 'register' && data.family_code) {
          showFamilyCode(data.family_code, data.message, data.redirect);
        } else {
          speak(data.message, () => { window.location.href = data.redirect; });
        }
      } else {
        failCount++;
        if (failCount >= 3) {
          speak(UI.login_fail_assisted, () => showAssisted());
        } else {
          speak(data.message, () => { state = 'IDLE'; askUsername(); });
        }
      }
    })
    .catch((err) => {
      console.error('[SINA] fetch error:', err);
      speak(UI.network_error || 'Erreur de connexion. Veuillez réessayer.', () => { state = 'IDLE'; askUsername(); });
    });
  }

  /* ── Show family code after registration ────────────────────────────────── */
  function showFamilyCode(code, msg, redirect) {
    if (codeBox && codeVal) {
      codeBox.style.display = 'block';
      codeVal.textContent   = code;
    }
    // Speak code letter by letter for VI user
    const letters = code.split('').join(', ');
    const fullMsg = msg + ' ' + letters;
    speak(fullMsg, () => {
      setTimeout(() => { window.location.href = redirect; }, 3000);
    });
  }

  /* ── Assisted mode ───────────────────────────────────────────────────────── */
  function showAssisted() {
    stopRec();
    state = 'ASSISTED';
    aPanel.style.display = 'block';
    tone(440, 0.3, 0.1);
    speak(UI.assisted_visible || 'Le formulaire est visible.');
  }

  window.hideAssisted = function () {
    aPanel.style.display = 'none';
    failCount = 0;
    state     = 'IDLE';
    start();
  };

  window.submitAssisted = function () {
    const username = (aUsername?.value || '').trim().toLowerCase();
    const email    = (aEmail?.value   || '').trim();
    if (!username) return;

    const readMsg = (UI.read_back || 'Nom d\'utilisateur : {}.')
      .replace('{}', username);

    aReadback.style.display = 'block';
    aReadback.textContent   = readMsg;

    speak(readMsg, () => {
      state = 'READBACK';
      // Small pause after TTS ends so the mic doesn't capture audio reverb
      setTimeout(() => listen((text) => {
        if (matches(text, 'yes')) {
          aPanel.style.display = 'none';
          const body = PAGE === 'register'
            ? { username, email: email || null, language: LANG }
            : { username };
          fetch(PAGE === 'register' ? '/api/register' : '/api/login', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify(body),
          })
          .then(r => r.json())
          .then(data => {
            if (data.ok) {
              if (PAGE === 'register' && data.family_code) {
                showFamilyCode(data.family_code, data.message, data.redirect);
              } else {
                speak(data.message, () => { window.location.href = data.redirect; });
              }
            } else {
              speak(data.message, () => { showAssisted(); });
            }
          });
        } else {
          // Rejected — clear and re-show form
          if (aUsername) aUsername.value = '';
          if (aEmail)    aEmail.value    = '';
          if (aPin)      aPin.value      = '';
          aReadback.style.display = 'none';
          speak(UI.assisted_visible || '');
        }
      }), 800);  // 800 ms pause after TTS before mic opens
    });
  };

  /* ── Language switch ─────────────────────────────────────────────────────── */
  window.switchLang = function (lang) {
    fetch('/api/set-language', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ lang }),
    }).then(() => {
      window.location.href = '/' + PAGE + '?lang=' + lang;
    });
  };

  /* ── Tap-to-start overlay ────────────────────────────────────────────────── */
  // A full-screen overlay lets the user start with any tap anywhere.
  // That single tap is our user gesture — audio unlocks and we go hands-free immediately.
  function showStartOverlay() {
    if (!HAS_RECOGNITION) {
      statusTxt.textContent =
        LANG === 'fr' ? 'Utilisez Chrome ou Edge pour la reconnaissance vocale.' :
        LANG === 'en' ? 'Please use Chrome or Edge for voice recognition.' :
                        'استخدم Chrome أو Edge للتعرف على الصوت.';
      return;
    }

    const label =
      LANG === 'fr' ? 'Appuyez n\'importe où pour démarrer SINA' :
      LANG === 'en' ? 'Tap anywhere to start SINA' :
                      'انقر في أي مكان لبدء سينا';

    const o = document.createElement('div');
    o.id        = 'sinaOverlay';
    o.tabIndex  = 0;
    o.setAttribute('role', 'button');
    o.setAttribute('aria-label', label);
    o.style.cssText = [
      'position:fixed;inset:0;z-index:9999',
      'display:flex;flex-direction:column;align-items:center;justify-content:center',
      'background:rgba(10,6,18,0.96);cursor:pointer',
      'font-family:Outfit,sans-serif',
    ].join(';');
    o.innerHTML = `
      <style>@keyframes orbPulse{0%,100%{transform:scale(1);opacity:.8}50%{transform:scale(1.12);opacity:1}}</style>
      <div style="text-align:center;color:#f0eaff;padding:40px;user-select:none">
        <div style="font-size:72px;margin-bottom:24px;animation:orbPulse 2s ease-in-out infinite">🎙️</div>
        <div style="font-size:26px;font-weight:600;letter-spacing:.04em;margin-bottom:14px">SINA</div>
        <div style="font-size:15px;color:rgba(240,234,255,0.6);line-height:1.6">${label}</div>
      </div>`;

    document.body.appendChild(o);

    // Preload voices while waiting — they'll be ready when user taps
    if (HAS_SYNTHESIS) {
      window.speechSynthesis.onvoiceschanged = () => window.speechSynthesis.getVoices();
      window.speechSynthesis.getVoices();
    }

    const activate = () => {
      console.log('[SINA] overlay tapped — activating');
      o.remove();
      if (audioCtx) audioCtx.resume().catch(() => {});
      waitForWhisper(() => start());
    };

    // Poll /api/whisper-status until ready, speaking a wait message on first check
    function waitForWhisper(onReady, attempts) {
      attempts = attempts || 0;
      fetch('/api/whisper-status')
        .then(r => r.json())
        .then(d => {
          if (d.ready) { onReady(); return; }
          if (attempts === 0) {
            // First poll: tell the user to wait (TTS works even before Whisper loads)
            const msg = LANG === 'fr' ? 'Activation de la reconnaissance vocale, veuillez patienter quelques secondes.'
                      : LANG === 'en' ? 'Activating voice recognition, please wait a few seconds.'
                      :                  'جارٍ تفعيل التعرف على الصوت، يرجى الانتظار لحظة.';
            speak(msg);
          } else {
            // Subsequent polls: just update the status text
            statusTxt.textContent = attempts % 2 === 0 ? '⏳ …' : '⏳';
          }
          setTimeout(() => waitForWhisper(onReady, attempts + 1), 2000);
        })
        .catch(() => onReady()); // if status check fails just proceed
    }
    o.addEventListener('click',   activate, { once: true });
    o.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') activate(); }, { once: true });
  }

  /* ── Mic button — secondary toggle after first activation ───────────────── */
  micBtn.addEventListener('click', () => {
    // If overlay is still showing, activate it; otherwise restart flow
    const overlay = document.getElementById('sinaOverlay');
    if (overlay) { overlay.click(); return; }
    if (state === 'IDLE') start();
  });
  document.getElementById('mainOrb')?.addEventListener('click', () => micBtn.click());

  showStartOverlay();

})();
