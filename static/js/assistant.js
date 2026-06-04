/**
 * SINA assistant.js — no authentication, fully self-contained
 *
 * Flow:
 *   Tap overlay → Whisper ready? → greet → continuous listen loop
 *   Voice commands: open camera | close camera | SOS | change language
 *   SSE /events → YOLO detections spoken aloud with distance + direction
 *   GPS → POST /api/location every 15 s
 */
(function () {
  'use strict';

  // ── Language (persisted in localStorage) ─────────────────────────────────
  // Use typeof instead of window.X — const in <script> is global but not a window prop
  const _UI_ALL  = (typeof SINA_UI_ALL !== 'undefined' ? SINA_UI_ALL : {});
  const LANGS    = ['fr', 'en', 'ar'];
  let curLang    = localStorage.getItem('sina_lang') || 'fr';
  let curDir     = curLang === 'ar' ? 'rtl' : 'ltr';
  let UI         = _UI_ALL[curLang] || {};

  // TTS locale map
  const TTS_LANG = { fr: 'fr-FR', en: 'en-US', ar: 'ar-SA' };

  // ── Voice command keywords ─────────────────────────────────────────────────
  const CMDS = {
    camera_on:  { fr:['ouvre','ouvrir','caméra','camera','détecter','activer'],
                  en:['open','start','camera','detect'],
                  ar:['افتح','شغل','كاميرا','كشف'] },
    camera_off: { fr:['ferme','arrête','stop','désactiver'],
                  en:['close','stop','off'],
                  ar:['أغلق','أوقف','وقف'] },
    sos:        { fr:['aide','secours','danger','sos','urgence','maman'],
                  en:['help','sos','danger','emergency'],
                  ar:['مساعدة','نجدة','خطر','sos','ساعدني'] },
    what_see:   { fr:['vois','voit','regarde','décris','description'],
                  en:['see','see','what','describe','description'],
                  ar:['أرى','ترى','انظر','اوصف','وصف'] },
    settings:   { fr:['paramètres','paramètre','parametre','réglages','réglage','réglage'],
                  en:['settings','settings','preferences','parameters'],
                  ar:['إعدادات','تفضيلات','خيارات'] },
    lang_fr:    { fr:['français'],    en:['french'],  ar:['فرنسية','فرنسي'] },
    lang_en:    { fr:['anglais'],     en:['english'], ar:['إنجليزية','إنجليزي'] },
    lang_ar:    { fr:['arabe'],       en:['arabic'],  ar:['عربية','عربي'] },
    volume_up:  { fr:['volume','plus','augmente','fort'],
                  en:['volume','up','louder'],
                  ar:['مستوى','أعلى','أكثر'] },
    volume_down:{ fr:['baisse','moins','silence','baisser'],
                  en:['down','lower','softer','quiet'],
                  ar:['أخفض','أقل','هادئ'] },
    volume_ask: { fr:['quel','volume','combien','mon volume'],
                  en:['volume','what','how','loud'],
                  ar:['حجم','كم','أي'] },
    gps_on:     { fr:['gps','localisation','activer','partage'],
                  en:['gps','location','enable','sharing'],
                  ar:['جي بي إس','موقع','تشغيل','مشاركة'] },
    gps_off:    { fr:['arrête','gps','désactiver','localisation'],
                  en:['stop','gps','disable','location'],
                  ar:['أوقف','جي بي إس','تعطيل','موقع'] },
    where_am_i: { fr:['où','suis','localisation','position'],
                  en:['where','location','position'],
                  ar:['أين','موقع','موضع'] },
    status:     { fr:['status','état','comment','ça va','état du système'],
                  en:['status','state','how','system'],
                  ar:['الحالة','النظام','كيف'] },
    help:       { fr:['aide','commandes','quoi','pouvez'],
                  en:['help','commands','what','can'],
                  ar:['مساعدة','أوامر','ماذا'] },
  };

  // ── DOM refs ───────────────────────────────────────────────────────────────
  const orbC       = document.getElementById('orbContainer');
  const micBtn     = document.getElementById('micBtn');
  const statusTxt  = document.getElementById('statusText');
  const txUser     = document.getElementById('transcriptUser');
  const txResp     = document.getElementById('transcriptResponse');
  const camSection = document.getElementById('cameraSection');
  const camFeed    = document.getElementById('cameraFeed');
  const detBanner  = document.getElementById('detectionBanner');
  const detTxt     = document.getElementById('detectionText');

  // ── State ──────────────────────────────────────────────────────────────────
  const STATES = { IDLE: 'idle', LISTENING: 'listening', RESPONDING: 'responding' };
  let curState   = STATES.IDLE;
  let cameraOn   = false;
  let detHideT   = null;
  let audioCtx   = null;
  let lastScene  = {};  // Store current detections for "what do you see" query
  let listenFailCount = 0;  // Track consecutive listen failures
  let listenFailTimeout = null;  // Backoff timeout
  let ttsPlaying = false;  // Prevent mic input while speaker audio plays (built-in mic interference)
  let cameraStartTimeout = null;  // Camera startup timeout handler
  let sosActive = false;  // Pause detections during SOS
  let sosResumeT = null;  // Timer to resume detections after SOS

  // ── Audio ──────────────────────────────────────────────────────────────────
  function tone(f1, f2, dur, vol) {
    try {
      // Respect sound effects setting
      if (!getSetting('soundEffects', true)) return;

      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = audioCtx.createOscillator(), g = audioCtx.createGain();
      osc.connect(g); g.connect(audioCtx.destination);
      osc.frequency.setValueAtTime(f1, audioCtx.currentTime);
      osc.frequency.linearRampToValueAtTime(f2, audioCtx.currentTime + dur);
      g.gain.setValueAtTime(0, audioCtx.currentTime);
      // Apply stored volume to tone volume
      const masterVol = parseFloat(getSetting('volume', 1));
      const toneVol = (vol || 0.12) * masterVol;
      g.gain.linearRampToValueAtTime(toneVol, audioCtx.currentTime + 0.01);
      g.gain.linearRampToValueAtTime(0, audioCtx.currentTime + dur);
      osc.start(); osc.stop(audioCtx.currentTime + dur + 0.02);
    } catch(_) {}
  }

  const sfx = {
    activate:  () => { tone(400, 900, 0.25, 0.14); setTimeout(() => tone(900, 1100, 0.14, 0.10), 220); },
    stop:      () => tone(780, 420, 0.2, 0.11),
    alert:     () => [0, 160, 320].forEach(d => setTimeout(() => tone(880, 880, 0.12, 0.18), d)),
    detection: () => tone(620, 780, 0.15, 0.09),
    ready:     () => { tone(520, 680, 0.15, 0.08); },  // "Listening ready" chime
  };

  // ── TTS ────────────────────────────────────────────────────────────────────
  function getSetting(key, defaultVal) {
    const val = localStorage.getItem('sina_' + key);
    if (val === null) return defaultVal;
    if (defaultVal === true || defaultVal === false) return val === 'true';
    return val;
  }

  function speak(text, onEnd) {
    if (!text) { if (onEnd) onEnd(); return; }
    console.log('[SINA] speak() called with:', text);
    window.speechSynthesis.cancel();
    ttsPlaying = true;  // Mute mic during TTS (built-in mic picks up speaker audio)
    setState(STATES.RESPONDING);
    statusTxt.textContent = text;
    console.log('[SINA] setState to RESPONDING, about to call speechSynthesis.speak()');

    const utt  = new SpeechSynthesisUtterance(text);
    utt.lang   = TTS_LANG[curLang] || 'fr-FR';
    utt.rate   = parseFloat(getSetting('speechRate', curLang === 'ar' ? 0.85 : 0.95));
    utt.pitch  = 1.0;
    utt.volume = parseFloat(getSetting('volume', 1));

    const voices = window.speechSynthesis.getVoices();
    const voice  = voices.find(v => v.lang.startsWith(curLang === 'ar' ? 'ar' : curLang));
    if (voice) utt.voice = voice;

    let done = false;
    const proceed = () => {
      if (done) return; done = true;
      ttsPlaying = false;  // TTS done, allow mic input again
      if (onEnd) { onEnd(); return; }
      if (curState !== STATES.IDLE) {
        setState(STATES.LISTENING);
        setTimeout(startListening, 800);  // gap so mic doesn't capture echo
      }
    };
    utt.onend  = proceed;
    utt.onerror = proceed;
    setTimeout(proceed, Math.max(15000, text.length * 90));
    window.speechSynthesis.speak(utt);
  }

  // ── Visual state ───────────────────────────────────────────────────────────
  function setState(s) {
    const prevState = curState;
    curState = s;
    orbC.classList.remove('listening', 'responding');
    micBtn.classList.remove('active');
    const iconMic  = micBtn.querySelector('.icon-mic');
    const iconStop = micBtn.querySelector('.icon-stop');

    const labels = {
      [STATES.IDLE]:      { fr: 'Appuyez pour parler',    en: 'Tap to speak',        ar: 'اضغط للتحدث' },
      [STATES.LISTENING]: { fr: 'J\'écoute…',             en: 'Listening…',           ar: 'أستمع…' },
      [STATES.RESPONDING]:{ fr: 'SINA parle…',            en: 'SINA speaking…',       ar: 'سينا تتحدث…' },
    };
    statusTxt.textContent = (labels[s] || {})[curLang] || '';

    if (s === STATES.LISTENING) {
      orbC.classList.add('listening'); micBtn.classList.add('active');
      if (iconMic) iconMic.style.display = 'none';
      if (iconStop) iconStop.style.display = '';
      // Play "ready" beep when resuming listening after SINA spoke (not on initial activate)
      if (prevState === STATES.RESPONDING) {
        setTimeout(sfx.ready, 200);  // Wait 200ms so TTS audio finishes first
      }
    } else {
      if (iconMic) iconMic.style.display = '';
      if (iconStop) iconStop.style.display = 'none';
    }
    if (s === STATES.RESPONDING) orbC.classList.add('responding');
  }

  // ── Command matching ───────────────────────────────────────────────────────
  function cmd(text, key) {
    return (CMDS[key]?.[curLang] || []).some(w => text.includes(w));
  }

  // ── Handle transcribed command ─────────────────────────────────────────────
  function handle(text) {
    txUser.textContent = text;
    console.log('[SINA] command:', text);

    // Give voice feedback: read back what was heard
    if (text) {
      const heardMsg = curLang === 'fr' ? `Vous avez dit : ${text}` :
                       curLang === 'en' ? `I heard: ${text}` :
                                          `سمعت: ${text}`;
      statusTxt.textContent = heardMsg;
    }

    if (cmd(text, 'sos'))        { triggerSOS();        return; }
    if (cmd(text, 'camera_on'))  { startCamera();       return; }
    if (cmd(text, 'camera_off')) { stopCamera();        return; }
    if (cmd(text, 'what_see'))   { describeScene();     return; }
    if (cmd(text, 'settings'))   { openSettings();      return; }
    // Language switching commands
    if (cmd(text, 'lang_fr'))    { window.setLang('fr', 'ltr'); return; }
    if (cmd(text, 'lang_en'))    { window.setLang('en', 'ltr'); return; }
    if (cmd(text, 'lang_ar'))    { window.setLang('ar', 'rtl'); return; }
    // Volume commands
    if (cmd(text, 'volume_up'))   { adjustVolume(0.1);  return; }
    if (cmd(text, 'volume_down')) { adjustVolume(-0.1); return; }
    if (cmd(text, 'volume_ask'))  { announceVolume();   return; }
    // GPS commands
    if (cmd(text, 'gps_on'))      { setGPSState(true);  return; }
    if (cmd(text, 'gps_off'))     { setGPSState(false); return; }
    if (cmd(text, 'where_am_i'))  { announceLocation(); return; }
    // Status commands
    if (cmd(text, 'status'))      { announceStatus();   return; }
    if (cmd(text, 'help'))        { announceHelp();     return; }

    // Unknown command — give a hint, NEVER echo back what was said
    speakThenListen(UI.not_found ||
      (curLang === 'fr' ? 'Je n\'ai pas compris. Dites ouvre caméra, stop, danger, ou décris ce que tu vois.' :
       curLang === 'en' ? 'I did not understand. Say open camera, stop, danger, or what do you see.' :
                          'لم أفهم. قل افتح الكاميرا، أغلق، خطر، أو ما الذي تراه.'));
  }

  // ── Settings command handlers ──────────────────────────────────────────────
  function adjustVolume(delta) {
    let vol = parseFloat(getSetting('volume', 1));
    vol = Math.max(0, Math.min(1, vol + delta));
    localStorage.setItem('sina_volume', vol.toString());
    const pct = Math.round(vol * 100);
    const msg = curLang === 'fr' ? `Volume à ${pct} pour cent` :
                curLang === 'en' ? `Volume at ${pct} percent` :
                                   `مستوى الصوت في ${pct} في المئة`;
    sfx.ready();
    speakThenListen(msg);
  }

  function announceVolume() {
    const vol = Math.round(parseFloat(getSetting('volume', 1)) * 100);
    const msg = curLang === 'fr' ? `Volume à ${vol} pour cent` :
                curLang === 'en' ? `Volume at ${vol} percent` :
                                   `مستوى الصوت في ${vol} في المئة`;
    speakThenListen(msg);
  }

  function setGPSState(enabled) {
    localStorage.setItem('sina_gps_enabled', enabled.toString());
    if (enabled) {
      sfx.detection();
      sendGPS();
      const msg = curLang === 'fr' ? 'Partage de localisation activé. Votre famille peut voir votre position.' :
                  curLang === 'en' ? 'Location sharing enabled. Your family can see your position.' :
                                     'مشاركة الموقع مفعّلة. يمكن لعائلتك أن ترى موقعك.';
      speakThenListen(msg);
    } else {
      sfx.stop();
      const msg = curLang === 'fr' ? 'Partage de localisation désactivé.' :
                  curLang === 'en' ? 'Location sharing disabled.' :
                                     'مشاركة الموقع معطّلة.';
      speakThenListen(msg);
    }
  }

  function announceLocation() {
    fetch('/api/status?lang=' + curLang)
      .then(r => r.json())
      .then(d => {
        if (d.gps_lat && d.gps_lng) {
          const msg = curLang === 'fr' ? `Latitude ${d.gps_lat.toFixed(4)}, longitude ${d.gps_lng.toFixed(4)}` :
                      curLang === 'en' ? `Latitude ${d.gps_lat.toFixed(4)}, longitude ${d.gps_lng.toFixed(4)}` :
                                         `خط العرض ${d.gps_lat.toFixed(4)}, خط الطول ${d.gps_lng.toFixed(4)}`;
          speakThenListen(msg);
        } else {
          const msg = curLang === 'fr' ? 'Localisation indisponible' :
                      curLang === 'en' ? 'Location not available' :
                                         'الموقع غير متاح';
          speakThenListen(msg);
        }
      })
      .catch(() => {
        const msg = curLang === 'fr' ? 'Erreur en récupérant la localisation' :
                    curLang === 'en' ? 'Error retrieving location' :
                                       'خطأ في استرجاع الموقع';
        speakThenListen(msg);
      });
  }

  function announceStatus() {
    fetch('/api/status?lang=' + curLang)
      .then(r => r.json())
      .then(d => speakThenListen(d.status_message))
      .catch(() => speakThenListen(
        curLang === 'fr' ? 'Impossible de récupérer l\'état du système' :
        curLang === 'en' ? 'Could not retrieve system status' :
                           'لا يمكن استرجاع حالة النظام'
      ));
  }

  function announceHelp() {
    const help = curLang === 'fr' ?
      'Dites ouvre caméra pour détecter les obstacles. Dites qu\'est-ce que tu vois pour décrire la scène. ' +
      'Dites volume haut ou bas pour ajuster. Dites où suis-je pour connaître votre position. ' +
      'Dites danger pour alerter votre famille. Dites paramètres pour les réglages.' :
      curLang === 'en' ?
      'Say open camera to detect obstacles. Say what do you see to describe the scene. ' +
      'Say volume up or down to adjust. Say where am I to know your location. ' +
      'Say danger to alert your family. Say settings for preferences.' :
      'قل افتح الكاميرا للكشف عن العوائق. قل ما الذي تراه لوصف المشهد. ' +
      'قل مستوى الصوت أعلى أو أخفض للتعديل. قل أين أنا معرفة موقعك. ' +
      'قل خطر لتنبيه عائلتك. قل إعدادات للتفضيلات.';
    speakThenListen(help);
  }

  // ── speakThenListen — always restart listening after speaking ─────────────
  function speakThenListen(text) {
    speak(text, () => setTimeout(startListening, 600));
  }

  // ── Continuous listen loop ─────────────────────────────────────────────────
  function startListening() {
    if (curState === STATES.IDLE || ttsPlaying) return;  // Don't listen while TTS audio plays (mic interference)
    console.log('[SINA] startListening() called, state:', curState);

    // Check Whisper status first
    fetch('/api/whisper-status')
      .then(r => r.json())
      .then(d => {
        if (!d.ready) {
          console.log('[SINA] Whisper still loading...');
          // Announce loading and wait longer before retrying
          const loadingMsg = curLang === 'fr' ? 'Modèle de voix en cours de chargement. Un instant...' :
                             curLang === 'en' ? 'Voice model loading. One moment...' :
                                               'تحميل نموذج الصوت. لحظة واحدة...';
          statusTxt.textContent = loadingMsg;
          setTimeout(startListening, 2000);  // Retry in 2 seconds
          return;
        }

        // Whisper is ready, start recording
        sfx.activate();  // Play tone when recording starts
        statusTxt.textContent = curLang === 'fr' ? 'Enregistrement...' :
                                curLang === 'en' ? 'Recording...' : 'تسجيل...';

        SINARecorder.listen(
          curLang,
          (text) => {
            listenFailCount = 0;  // Reset on successful listen
            console.log('[SINA] User said:', text);
            sfx.detection();  // Play tone when transcription succeeds
            handle(text);
            // speak() will restart listening after responding
            // for SOS / camera commands that don't call speak(), restart manually
          },
          (err) => {
        console.warn('[SINA] recorder error:', err, 'fail count:', listenFailCount);

        // Microphone permission denied
        if (err === 'not-allowed') {
          speak(curLang === 'fr' ? 'Microphone refusé.' :
                curLang === 'en' ? 'Microphone blocked.' : 'الميكروفون محظور.');
          listenFailCount = 0;
          return;
        }

        // Network/server error - use exponential backoff
        if (err === 'fetch-error' || err === 'server-error') {
          listenFailCount++;
          console.warn('[SINA] Listen failed', listenFailCount, 'times. Exponential backoff active.');

          // After 3 failures, notify user
          if (listenFailCount === 3) {
            console.error('[SINA] Server unavailable - is Flask app running? Check: python app.py');
            speak(curLang === 'fr' ? 'Le serveur est indisponible. Vérifiez que l\'application est en cours d\'exécution.' :
                  curLang === 'en' ? 'Server unavailable. Check that the application is running.' :
                                     'الخادم غير متاح. تحقق من تشغيل التطبيق.');
            return;
          }

          // Exponential backoff: 1s, 2s, 4s, 8s, 16s max
          const delayMs = Math.min(1000 * Math.pow(2, listenFailCount - 1), 16000);
          console.log(`[SINA] Retrying in ${delayMs}ms (attempt ${listenFailCount})`);

          if (curState !== STATES.IDLE) {
            clearTimeout(listenFailTimeout);
            listenFailTimeout = setTimeout(startListening, delayMs);
          }
          return;
        }

        // Other errors - quick retry (too-short, empty, etc)
        if (err === 'too-short' || err === 'empty') {
          listenFailCount = 0;  // Reset on these harmless errors
          sfx.stop();  // Play error tone
          const msg = curLang === 'fr' ? 'Je n\'ai pas bien entendu. Essayez à nouveau.' :
                      curLang === 'en' ? 'I didn\'t catch that. Try again.' :
                                         'لم أسمع جيداً. حاول مرة أخرى.';
          statusTxt.textContent = msg;
          if (curState !== STATES.IDLE) {
            setTimeout(startListening, 1500);
          }
          return;
        }

        // Unknown error - reset and retry slowly
        listenFailCount = 0;
        if (curState !== STATES.IDLE) {
          console.log('[SINA] Unknown listen error, retrying...');
          setTimeout(startListening, 1000);
        }
      }
        );
      })
      .catch(err => {
        console.warn('[SINA] Whisper status check failed:', err);
        // If we can't check status, try anyway
        SINARecorder.listen(curLang, (text) => {
          listenFailCount = 0;
          console.log('[SINA] User said:', text);
          handle(text);
        }, (err) => {
          if (err === 'too-short' || err === 'empty') {
            listenFailCount = 0;
            if (curState !== STATES.IDLE) {
              setTimeout(startListening, 300);
            }
            return;
          }
          listenFailCount++;
          if (curState !== STATES.IDLE) {
            setTimeout(startListening, 1000);
          }
        });
      });
  }

  function stopListening() {
    SINARecorder.stop();
    window.speechSynthesis.cancel();
    clearTimeout(listenFailTimeout);  // Clear any pending retries
    listenFailCount = 0;  // Reset fail counter
    setState(STATES.IDLE);
    txUser.textContent = '';
    txResp.textContent = '';
  }

  // ── Camera ─────────────────────────────────────────────────────────────────
  function setCameraState(on) {
    cameraOn = on;
    const btn = document.getElementById('btnCamera');
    if (btn) {
      btn.style.background = on ? 'rgba(232,121,249,.25)' : '';
      btn.style.borderColor= on ? 'rgba(232,121,249,.6)'  : '';
      btn.title = on
        ? (curLang==='fr'?'Stop caméra':curLang==='en'?'Stop camera':'أوقف الكاميرا')
        : (curLang==='fr'?'Ouvrir caméra':curLang==='en'?'Open camera':'افتح الكاميرا');
    }
    if (on) { camFeed.src = '/video-feed'; camSection.style.display = 'block'; }
    else    { camSection.style.display = 'none'; camFeed.src = ''; }
  }

  function startCamera() {
    console.log('[SINA] Starting camera...');

    // Clear any existing timeout
    if (cameraStartTimeout) clearTimeout(cameraStartTimeout);

    // Set 5-second timeout for camera startup
    cameraStartTimeout = setTimeout(() => {
      console.warn('[SINA] Camera startup timeout - no response in 5 seconds');
      const timeoutMsg = curLang === 'fr' ? 'La caméra ne répond pas. Vérifiez qu\'elle est connectée.' :
                         curLang === 'en' ? 'Camera not responding. Check it\'s connected.' :
                                           'الكاميرا لا تستجيب. تأكد من توصيلها.';
      speak(timeoutMsg, startListening);
      setCameraState(false);
    }, 5000);

    fetch(`/start-camera?lang=${curLang}`)
      .then(r => {
        console.log('[SINA] Camera response:', r.status);
        return r.json();
      })
      .then(d => {
        console.log('[SINA] Camera response:', d);
        clearTimeout(cameraStartTimeout);  // Clear timeout on response
        cameraStartTimeout = null;
        if (d.ok) {
          console.log('[SINA] Camera started successfully');
          setCameraState(true);
        } else {
          console.warn('[SINA] Camera failed to start');
          setCameraState(false);
        }
        speakThenListen(d.message);
      })
      .catch(err => {
        console.error('[SINA] Camera error:', err);
        clearTimeout(cameraStartTimeout);
        cameraStartTimeout = null;
        speakThenListen(UI.camera_error);
        setCameraState(false);
      });
  }

  function stopCamera() {
    console.log('[SINA] Stopping camera...');
    fetch(`/stop-camera?lang=${curLang}`)
      .then(r => {
        console.log('[SINA] Stop response:', r.status);
        return r.json();
      })
      .then(d => {
        console.log('[SINA] Camera stopped:', d);
        setCameraState(false);
        speakThenListen(d.message);
      })
      .catch(err => {
        console.error('[SINA] Stop error:', err);
        setCameraState(false);
        setTimeout(startListening, 400);
      });
  }

  window.toggleCamera = function () { cameraOn ? stopCamera() : startCamera(); };

  // ── Describe current scene ─────────────────────────────────────────────────
  function describeScene() {
    if (!cameraOn) {
      speakThenListen(
        curLang === 'fr' ? 'Ouvre la caméra pour que je puisse voir.' :
        curLang === 'en' ? 'Open the camera so I can see.' :
                          'افتح الكاميرا حتى أتمكن من الرؤية.'
      );
      return;
    }
    if (!lastScene.label) {
      speakThenListen(
        curLang === 'fr' ? 'Je ne vois rien en ce moment. C\'est clair devant vous.' :
        curLang === 'en' ? 'I don\'t see anything right now. It\'s clear ahead.' :
                          'لا أرى شيئاً الآن. الطريق خالي أمامك.'
      );
      return;
    }
    const description = lastScene[curLang] || lastScene.label;
    speakThenListen(description);
  }

  // ── Detection SSE ──────────────────────────────────────────────────────────
  let sseRetryCount = 0;
  let detectionQueue = [];  // Queue to prevent interrupting TTS
  let isSpeakingDetection = false;  // Track if currently announcing detection

  function announceNextDetection() {
    // Skip announcements if SOS is active (user needs quiet)
    if (sosActive) {
      detectionQueue = [];  // Clear queue during SOS
      isSpeakingDetection = false;
      return;
    }

    if (detectionQueue.length === 0) {
      isSpeakingDetection = false;
      return;
    }
    isSpeakingDetection = true;
    const data = detectionQueue.shift();
    const text = data[curLang] || data.label;
    console.log('[SINA] Announcing queued detection:', text);
    sfx.detection();
    detTxt.textContent = text;
    detBanner.style.display = 'block';
    clearTimeout(detHideT);
    detHideT = setTimeout(() => { detBanner.style.display = 'none'; }, 6000);
    // Speak and announce next detection when done (don't interrupt)
    speak(text, () => {
      setTimeout(announceNextDetection, 500);  // 500ms gap before next announcement
    });
  }

  function connectSSE() {
    console.log('[SINA] Connecting to SSE stream at /events');
    const es = new EventSource('/events');

    es.onopen = () => {
      console.log('[SINA] SSE connection opened successfully');
    };

    es.onmessage = (e) => {
      const data = JSON.parse(e.data);
      console.log('[SINA] SSE message received:', data.type, data);

      // Handle camera startup feedback
      if (data.type === 'camera_starting') {
        console.log('[SINA] Camera starting...');
        sfx.ready();  // Play ready chime
        return;
      }

      if (data.type === 'camera_ready') {
        console.log('[SINA] Camera ready - first frame received');
        sfx.detection();  // Play detection tone to indicate success
        return;
      }

      // Handle regular detections
      if (data.type !== 'detection') return;
      console.log('[SINA] Detection received:', data.label, data.distance, data.position);
      lastScene = {
        label: data.label,
        distance: data.distance,
        position: data.position,
        fr: data.fr,
        en: data.en,
        ar: data.ar
      };
      // Queue detection instead of speaking immediately
      detectionQueue.push(data);
      // Start announcement if not already announcing
      if (!isSpeakingDetection) {
        announceNextDetection();
      }
      sseRetryCount = 0;  // Reset retry count on successful message
    };
    es.onerror = () => {
      es.close();
      sseRetryCount++;
      const delay = Math.min(1000 * Math.pow(2, sseRetryCount), 30000);  // Exponential backoff, max 30s
      setTimeout(connectSSE, delay);
    };
  }

  // Cleanup on page unload
  window.addEventListener('beforeunload', () => {
    if (window.sseConnection) window.sseConnection.close();
  });

  // ── GPS (triggered on SOS only) ────────────────────────────────────────────
  let lastGpsWarning = 0;  // Prevent spam of same warning

  function sendGPS() {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      pos => fetch('/api/location', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      }).catch(() => {}),
      () => {}
    );
  }

  // Monitor GPS health - alert if location sharing becomes stale
  function monitorGPS() {
    fetch('/api/status?lang=' + curLang)
      .then(r => r.json())
      .then(d => {
        if (d.gps_enabled && d.gps_stale) {
          const now = Date.now();
          // Only warn every 30 seconds to avoid spam
          if (now - lastGpsWarning > 30000) {
            lastGpsWarning = now;
            console.warn('[SINA] GPS data stale (>30s old)');
            const staleMsg = curLang === 'fr' ? 'Localisation indisponible. Vérifiez vos paramètres GPS.' :
                             curLang === 'en' ? 'Location data stale. Check your GPS settings.' :
                                               'بيانات الموقع قديمة. تحقق من إعدادات GPS.';
            statusTxt.textContent = staleMsg;
            // Try to get fresh GPS
            sendGPS();
          }
        }
      })
      .catch(err => console.warn('[SINA] GPS health check failed:', err));
  }

  // Start GPS monitoring (every 15 seconds)
  setInterval(monitorGPS, 15000);

  // ── SOS ────────────────────────────────────────────────────────────────────
  window.triggerSOS = function () {
    // Activate SOS mode: pause detections for 10 seconds
    sosActive = true;
    clearTimeout(sosResumeT);
    sosResumeT = setTimeout(() => {
      sosActive = false;
      console.log('[SINA] SOS mode deactivated, resuming detections');
    }, 10000);

    // Play alert tone
    sfx.alert();

    // Get and send location
    sendGPS();

    // Create alert message for family
    const alertMsg = curLang === 'fr' ? 'Besoin d\'aide urgente' :
                     curLang === 'en' ? 'Urgent help needed' : 'بحاجة إلى مساعدة عاجلة';
    fetch('/api/alert', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: alertMsg }),
    }).catch(() => {});

    // Announce confirmation to user
    const confirmMsg = curLang === 'fr' ?
      'Alerte envoyée à votre famille. De l\'aide est en route. Restez calme. Après 30 secondes, je vérifierai si vous avez toujours besoin d\'aide.' :
      curLang === 'en' ?
      'Alert sent to your family. Help is coming. Stay calm. I will check in after 30 seconds.' :
      'تم إرسال التنبيه لعائلتك. المساعدة في الطريق. ابقَ هادئاً. سأتحقق بعد 30 ثانية.';

    speak(confirmMsg, () => {
      // After 30 seconds, check in if SOS is still active
      setTimeout(() => {
        if (sosActive) {
          const checkMsg = curLang === 'fr' ?
            'Ça va mieux? Vous pouvez dire oui ou appeler à nouveau à l\'aide.' :
            curLang === 'en' ?
            'Are you okay? You can say yes or call for help again.' :
            'هل أنت بخير؟ يمكنك قول نعم أو استدعاء المساعدة مرة أخرى.';
          speak(checkMsg, startListening);
        }
      }, 30000);

      // Restart listening (will automatically restart after confirmation message)
      setTimeout(startListening, 1000);
    });
  };

  // ── Language ───────────────────────────────────────────────────────────────
  window.setLang = function (lang, dir) {
    curLang = lang;
    curDir  = dir || 'ltr';
    UI      = _UI_ALL[lang] || {};
    localStorage.setItem('sina_lang', lang);
    document.getElementById('htmlRoot').setAttribute('lang', lang);
    document.getElementById('htmlRoot').setAttribute('dir',  curDir);
    speakThenListen(UI.welcome);
  };

  // ── Family map ─────────────────────────────────────────────────────────────
  window.openFamily = function () {
    window.open('/family', '_blank');
  };

  // ── Settings ────────────────────────────────────────────────────────────────
  window.openSettings = function () {
    const msg = curLang === 'fr' ? 'Ouverture des paramètres...' :
                curLang === 'en' ? 'Opening settings...' :
                                   'جارٍ فتح الإعدادات...';
    speak(msg, () => {
      stopListening();
      window.location.href = '/settings';
    });
  };

  // ── Mic button ─────────────────────────────────────────────────────────────
  micBtn.addEventListener('click', () => {
    const overlay = document.getElementById('sinaOverlay');
    if (overlay) { overlay.click(); return; }
    if (curState === STATES.IDLE) {
      sfx.activate();
      setState(STATES.LISTENING);
      setTimeout(startListening, 300);
    } else {
      sfx.stop();
      stopListening();
    }
  });
  document.getElementById('mainOrb')?.addEventListener('click', () => micBtn.click());

  // ── Tap-to-start overlay ───────────────────────────────────────────────────
  function showOverlay() {
    const label = curLang === 'fr' ? 'Appuyez n\'importe où pour activer SINA' :
                  curLang === 'en' ? 'Tap anywhere to activate SINA' :
                                     'انقر في أي مكان لتفعيل سينا';
    const activationPrompt = curLang === 'fr' ? 'Appuyez n\'importe où pour activer votre assistant vocal.' :
                             curLang === 'en' ? 'Tap anywhere to activate your voice assistant.' :
                                                'انقر في أي مكان لتفعيل مساعدك الصوتي.';
    const o = document.createElement('div');
    o.id = 'sinaOverlay';
    o.tabIndex = 0;
    o.setAttribute('role', 'button');
    o.setAttribute('aria-label', label);
    o.style.cssText = 'position:fixed;inset:0;z-index:9999;display:flex;flex-direction:column;align-items:center;justify-content:center;background:rgba(10,6,18,0.97);cursor:pointer;font-family:Outfit,sans-serif;';
    o.innerHTML = `
      <style>@keyframes op{0%,100%{transform:scale(1);opacity:.8}50%{transform:scale(1.12);opacity:1}}</style>
      <div style="text-align:center;color:#f0eaff;padding:40px;user-select:none">
        <div style="font-size:72px;margin-bottom:24px;animation:op 2s ease-in-out infinite">🎙️</div>
        <div style="font-size:26px;font-weight:600;letter-spacing:.04em;margin-bottom:14px">SINA</div>
        <div style="font-size:15px;color:rgba(240,234,255,0.6);line-height:1.6">${label}</div>
      </div>`;
    document.body.appendChild(o);

    if (window.speechSynthesis) {
      window.speechSynthesis.onvoiceschanged = () => window.speechSynthesis.getVoices();
      window.speechSynthesis.getVoices();
    }

    // Play activation instruction when overlay appears
    const activationUtt = new SpeechSynthesisUtterance(activationPrompt);
    activationUtt.lang = TTS_LANG[curLang] || 'fr-FR';
    activationUtt.rate = curLang === 'ar' ? 0.85 : 0.95;
    window.speechSynthesis.speak(activationUtt);

    const activate = () => {
      o.remove();
      window.speechSynthesis.cancel();  // Stop activation prompt if still playing
      if (audioCtx) audioCtx.resume().catch(() => {});
      waitForWhisper(() => {
        curState = STATES.LISTENING;   // set before speak so it restarts after
        speak(UI.welcome, () => {
          setState(STATES.LISTENING);
          setTimeout(startListening, 600);
        });
      });
    };
    o.addEventListener('click',   activate, { once: true });
    o.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') activate(); }, { once: true });
  }

  function waitForWhisper(onReady, attempts) {
    attempts = attempts || 0;
    fetch('/api/whisper-status')
      .then(r => r.json())
      .then(d => {
        if (d.ready) { onReady(); return; }
        if (attempts === 0) {
          const msg = curLang === 'fr' ? 'Activation de la reconnaissance vocale, patientez quelques secondes.'
                    : curLang === 'en' ? 'Activating voice recognition, please wait.'
                    :                    'جارٍ تفعيل التعرف على الصوت.';
          // Pass an empty onEnd so speak() does NOT auto-restart listening
          speak(msg, () => {});
        } else {
          statusTxt.textContent = '⏳ …';
        }
        setTimeout(() => waitForWhisper(onReady, attempts + 1), 2000);
      })
      .catch(() => onReady());
  }

  // ── Boot ───────────────────────────────────────────────────────────────────
  // Apply stored language on page load
  if (curLang !== 'fr') {
    document.getElementById('htmlRoot').setAttribute('lang', curLang);
    document.getElementById('htmlRoot').setAttribute('dir',  curDir);
    UI = _UI_ALL[curLang] || {};
  }

  connectSSE();
  setState(STATES.IDLE);
  showOverlay();

})();
