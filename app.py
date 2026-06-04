"""
SINA — Flask backend (no authentication)
One command to start:  python app.py
Flutter will consume the same API endpoints.
"""
import os, json, time, queue, threading, tempfile
from collections import deque
from flask import Flask, Response, jsonify, request, render_template
from flask_cors import CORS
import numpy as np

app = Flask(__name__)
CORS(app, supports_credentials=True)
app.secret_key = os.environ.get('SECRET_KEY', 'sina-dev')

# ── Optional heavy imports ─────────────────────────────────────────────────────
try:
    import cv2
    CV2_OK = True
except ImportError:
    CV2_OK = False
    print("⚠  OpenCV not found — camera disabled")

try:
    from ultralytics import YOLO as _YOLO
    YOLO_OK = True
except ImportError:
    YOLO_OK = False
    print("⚠  ultralytics not found — detection disabled")

try:
    from faster_whisper import WhisperModel as _WhisperModel
    import soundfile as _sf
    WHISPER_OK = True
except ImportError:
    WHISPER_OK = False
    print("⚠  faster-whisper / soundfile not found")

# ── Models ─────────────────────────────────────────────────────────────────────
_yolo_model    = None
_whisper_model = None
_whisper_lock  = threading.Lock()

def _load_yolo():
    global _yolo_model
    if not YOLO_OK:
        return
    base = os.path.dirname(__file__)
    for path in [
        os.path.join(base, 'runs', 'detect', 'sina_mobility', 'weights', 'best.pt'),
        os.path.join(base, 'yolov8n.pt'),
    ]:
        if os.path.exists(path):
            try:
                _yolo_model = _YOLO(path)
                n = len(_yolo_model.names)
                if n == 11:
                    global TARGET_CLASS_IDS
                    TARGET_CLASS_IDS = set(range(11))
                print(f"✅ YOLO loaded: {os.path.basename(path)} ({n} classes)")
                return
            except Exception as e:
                print(f"⚠  {path}: {e}")
    print("⚠  No YOLO model found")

def _get_whisper():
    global _whisper_model
    if _whisper_model is None:
        with _whisper_lock:
            if _whisper_model is None:
                print("🔄 Loading Faster-Whisper base model (~140 MB first run, faster + more accurate)…")
                _whisper_model = _WhisperModel("base", device="cpu", compute_type="auto")
                print("✅ Faster-Whisper ready (80-85% accuracy, ~1s per transcription)")
    return _whisper_model

# ── Detection config ───────────────────────────────────────────────────────────
# COCO indices for 11 mobility-relevant classes in yolov8n.pt
TARGET_CLASS_IDS = {0, 1, 2, 3, 9, 11, 13, 39, 56, 58, 60}

LABELS = {
    'person':        {'fr': 'Personne',     'en': 'Person',        'ar': 'شخص'},
    'bicycle':       {'fr': 'Vélo',         'en': 'Bicycle',       'ar': 'دراجة'},
    'car':           {'fr': 'Voiture',      'en': 'Car',           'ar': 'سيارة'},
    'motorcycle':    {'fr': 'Moto',         'en': 'Motorcycle',    'ar': 'دراجة نارية'},
    'traffic light': {'fr': 'Feu',          'en': 'Traffic light', 'ar': 'إشارة مرور'},
    'stop sign':     {'fr': 'Panneau stop', 'en': 'Stop sign',     'ar': 'علامة توقف'},
    'bench':         {'fr': 'Banc',         'en': 'Bench',         'ar': 'مقعد'},
    'bottle':        {'fr': 'Bouteille',    'en': 'Bottle',        'ar': 'زجاجة'},
    'chair':         {'fr': 'Chaise',       'en': 'Chair',         'ar': 'كرسي'},
    'potted plant':  {'fr': 'Plante',       'en': 'Plant',         'ar': 'نبتة'},
    'dining table':  {'fr': 'Table',        'en': 'Table',         'ar': 'طاولة'},
}

DIST_LABELS = {
    'very_close': {
        'fr': 'juste devant vous — faites attention',
        'en': 'right in front of you — caution',
        'ar': 'أمامك مباشرة — انتبه',
    },
    'close': {
        'fr': 'à environ 1 mètre',
        'en': 'about 1 meter away',
        'ar': 'على بعد متر تقريباً',
    },
    'medium': {
        'fr': 'à environ 2 à 4 mètres',
        'en': 'about 2 to 4 meters away',
        'ar': 'على بعد 2 إلى 4 أمتار',
    },
    'far': {
        'fr': 'au loin',
        'en': 'far away',
        'ar': 'بعيد',
    },
}

POS_LABELS = {
    'left':   {'fr': 'à votre gauche',  'en': 'on your left',  'ar': 'على يسارك'},
    'center': {'fr': 'devant vous',     'en': 'ahead of you',  'ar': 'أمامك'},
    'right':  {'fr': 'à votre droite', 'en': 'on your right', 'ar': 'على يمينك'},
}

UI = {
    'fr': {
        'welcome':      "Bonjour, je suis SINA, votre assistant de mobilité. "
                        "Pour détecter les obstacles, dites ouvre caméra. "
                        "Pour l'arrêter, dites stop. "
                        "En cas de danger, dites danger et j'alerterai immédiatement votre famille. "
                        "Je vous écoute.",
        'camera_on':    "Caméra activée. Je surveille les obstacles et vous préviens.",
        'camera_off':   "Caméra désactivée. Dites ouvre caméra pour reprendre.",
        'camera_error': "Impossible d'ouvrir la caméra. Vérifiez qu'elle est connectée.",
        'alert_sent':   "Alerte envoyée à votre famille. Restez calme, de l'aide est en route.",
        'not_found':    "Je n'ai pas compris. Dites ouvre caméra, stop, ou danger en cas de besoin.",
    },
    'en': {
        'welcome':      "Hello, I am SINA, your mobility assistant. "
                        "To detect obstacles, say open camera. "
                        "To stop it, say stop camera. "
                        "In case of danger, say help and I will immediately alert your family. "
                        "I am listening.",
        'camera_on':    "Camera activated. I am monitoring for obstacles.",
        'camera_off':   "Camera deactivated. Say open camera to resume.",
        'camera_error': "Could not open the camera. Please check it is connected.",
        'alert_sent':   "Alert sent to your family. Stay calm, help is on the way.",
        'not_found':    "I did not understand. Say open camera, stop camera, or help in case of danger.",
    },
    'ar': {
        'welcome':      "مرحباً، أنا سينا، مساعدك للتنقل. "
                        "للكشف عن العوائق، قل افتح الكاميرا. "
                        "لإيقافها، قل أغلق الكاميرا. "
                        "في حالة خطر، قل مساعدة وسأنبّه عائلتك فوراً. "
                        "أنا أستمع.",
        'camera_on':    "تم تشغيل الكاميرا. أراقب العوائق وسأنبهك.",
        'camera_off':   "تم إيقاف الكاميرا. قل افتح الكاميرا للمتابعة.",
        'camera_error': "تعذر فتح الكاميرا. تأكد من توصيلها.",
        'alert_sent':   "تم إرسال التنبيه لعائلتك. ابقَ هادئاً، المساعدة في الطريق.",
        'not_found':    "لم أفهم. قل افتح الكاميرا، أغلق الكاميرا، أو مساعدة في حالة خطر.",
    },
}

# ── In-memory state (no database) ─────────────────────────────────────────────
gps_state = {'lat': None, 'lng': None, 'ts': None}
alert_log = deque(maxlen=50)
_alert_id = 0
_alert_lock = threading.Lock()  # Thread-safe alert ID generation
detect_q  = queue.Queue(maxsize=30)   # web SSE queue

# ── Distance + direction helpers ───────────────────────────────────────────────
def _estimate_distance(xyxy, frame_w, frame_h):
    x1, y1, x2, y2 = xyxy
    ratio = ((x2 - x1) * (y2 - y1)) / (frame_w * frame_h)
    if ratio > 0.20: return 'very_close'
    if ratio > 0.06: return 'close'
    if ratio > 0.01: return 'medium'
    return 'far'

def _estimate_position(xyxy, frame_w):
    x_center = (xyxy[0] + xyxy[2]) / 2
    rel = x_center / frame_w
    if rel < 0.35: return 'left'
    if rel > 0.65: return 'right'
    return 'center'

def _build_spoken(label, dist_key, pos_key):
    """Build detection alert with actionable guidance."""
    out = {}
    for lang in ('fr', 'en', 'ar'):
        obj = LABELS.get(label, {}).get(lang, label)
        pos = POS_LABELS.get(pos_key, {}).get(lang, '')

        if lang == 'fr':
            if dist_key == 'very_close':
                out[lang] = f"Attention : {obj} très proche {pos}. Arrêtez-vous ou bougez."
            elif dist_key == 'close':
                out[lang] = f"{obj} à 1 mètre {pos}. Vous pouvez marcher, restez prudent."
            elif dist_key == 'medium':
                out[lang] = f"{obj} à 2-4 mètres {pos}. Vous pouvez marcher librement."
            else:  # far
                out[lang] = f"{obj} au loin {pos}. Pas de danger immédiat."
        elif lang == 'en':
            article = 'An' if obj[0] in 'aeiouAEIOU' else 'A'
            if dist_key == 'very_close':
                out[lang] = f"Caution: {article.lower()} {obj} very close {pos}. Stop or move away."
            elif dist_key == 'close':
                out[lang] = f"{article} {obj} at 1 meter {pos}. Safe to walk, stay alert."
            elif dist_key == 'medium':
                out[lang] = f"{article} {obj} at 2 to 4 meters {pos}. You can walk freely."
            else:  # far
                out[lang] = f"{article} {obj} far away {pos}. No immediate danger."
        else:  # Arabic
            if dist_key == 'very_close':
                out[lang] = f"تنبيه: {obj} قريب جداً {pos}. توقف أو تحرك بعيداً."
            elif dist_key == 'close':
                out[lang] = f"{obj} على متر واحد {pos}. آمن للمشي، بقي حذراً."
            elif dist_key == 'medium':
                out[lang] = f"{obj} على بعد 2 إلى 4 أمتار {pos}. يمكنك المشي بحرية."
            else:  # far
                out[lang] = f"{obj} بعيد {pos}. لا يوجد خطر فوري."
    return out

def _build_grouped_spoken(labels_dist_pos, dist_key, pos_key):
    """Build grouped alert for multiple obstacles at same distance/position."""
    out = {}
    for lang in ('fr', 'en', 'ar'):
        obj_list = [LABELS.get(label, {}).get(lang, label) for label, _, _ in labels_dist_pos]
        pos = POS_LABELS.get(pos_key, {}).get(lang, '')

        if lang == 'en':
            obj_str = ' and '.join(obj_list) if len(obj_list) > 1 else obj_list[0]
            article = 'An' if obj_list[0][0] in 'aeiouAEIOU' else 'A'
            if dist_key == 'very_close':
                out[lang] = f"Multiple obstacles: {obj_str} very close {pos}. Stop immediately."
            elif dist_key == 'close':
                out[lang] = f"{article} {obj_str} {pos} at 1 meter. Walk carefully."
            elif dist_key == 'medium':
                out[lang] = f"{article} {obj_str} {pos} at 2 to 4 meters. Path is clear."
            else:
                out[lang] = f"{article} {obj_str} {pos} in the distance."
        elif lang == 'fr':
            obj_str = ' et '.join(obj_list)
            if dist_key == 'very_close':
                out[lang] = f"Plusieurs obstacles: {obj_str} très proches {pos}. Arrêtez-vous immédiatement."
            elif dist_key == 'close':
                out[lang] = f"{obj_str} {pos} à 1 mètre. Marchez prudemment."
            elif dist_key == 'medium':
                out[lang] = f"{obj_str} {pos} à 2-4 mètres. Le chemin est libre."
            else:
                out[lang] = f"{obj_str} {pos} au loin."
        else:  # Arabic
            obj_str = ' و'.join(obj_list)
            if dist_key == 'very_close':
                out[lang] = f"عوائق متعددة: {obj_str} قريبة جداً {pos}. توقف فوراً."
            elif dist_key == 'close':
                out[lang] = f"{obj_str} {pos} على متر واحد. امش بحذر."
            elif dist_key == 'medium':
                out[lang] = f"{obj_str} {pos} على 2 إلى 4 أمتار. المسار واضح."
            else:
                out[lang] = f"{obj_str} {pos} في البعيد."
    return out

# ── Audio feedback helpers ────────────────────────────────────────────────────
def _build_status_message(lang='fr'):
    """Build spoken status message in requested language."""
    status_parts = []

    # Camera status
    cam_status = 'Camera on' if camera.running else 'Camera off'
    if lang == 'fr':
        status_parts.append('Caméra ' + ('activée' if camera.running else 'désactivée'))
    elif lang == 'ar':
        status_parts.append('الكاميرا ' + ('مفعّلة' if camera.running else 'معطّلة'))
    else:
        status_parts.append(cam_status)

    # GPS status
    gps_on = gps_state.get('lat') is not None
    if lang == 'fr':
        status_parts.append('Partage de localisation ' + ('activé' if gps_on else 'désactivé'))
    elif lang == 'ar':
        status_parts.append('مشاركة الموقع ' + ('مفعّلة' if gps_on else 'معطّلة'))
    else:
        status_parts.append('Location sharing ' + ('on' if gps_on else 'off'))

    # Language
    lang_names = {'fr': 'French', 'en': 'English', 'ar': 'Arabic'}
    if lang == 'fr':
        status_parts.append(f"Langue: Français")
    elif lang == 'ar':
        status_parts.append(f"اللغة: العربية")
    else:
        status_parts.append(f"Language: English")

    return '. '.join(status_parts)

def _build_error_message(error_type, lang='fr'):
    """Build error/warning messages in multilingual format."""
    errors = {
        'camera_failed': {
            'fr': 'Impossible d\'ouvrir la caméra. Vérifiez qu\'elle est connectée.',
            'en': 'Camera failed to open. Check it\'s connected.',
            'ar': 'فشل فتح الكاميرا. تأكد من توصيلها.',
        },
        'whisper_loading': {
            'fr': 'Modèle de voix en cours de chargement. Un instant...',
            'en': 'Voice model loading. One moment...',
            'ar': 'تحميل نموذج الصوت. لحظة واحدة...',
        },
        'gps_paused': {
            'fr': 'Partage de localisation en pause. Vérifiez vos paramètres GPS.',
            'en': 'Location sharing paused. Check your GPS settings.',
            'ar': 'مشاركة الموقع معلقة. تحقق من إعدادات GPS.',
        },
        'command_not_recognized': {
            'fr': 'Je n\'ai pas compris. Dites aide pour les commandes disponibles.',
            'en': 'I didn\'t understand. Say help for available commands.',
            'ar': 'لم أفهم. قل مساعدة للأوامر المتاحة.',
        },
        'recording_too_short': {
            'fr': 'Enregistrement trop court. Parlez à nouveau.',
            'en': 'Recording too short. Try again.',
            'ar': 'التسجيل قصير جداً. حاول مرة أخرى.',
        },
    }
    return errors.get(error_type, {}).get(lang, errors.get(error_type, {}).get('en', 'Unknown error'))

# ── Camera class ───────────────────────────────────────────────────────────────
class Camera:
    def __init__(self):
        self._cap       = None
        self._frame     = None
        self._running   = False
        self._lock      = threading.Lock()
        self._thread    = None
        self._first_frame_sent = False

    def start(self):
        if self._running:
            return True
        if not CV2_OK:
            print("[WARNING] OpenCV not available")
            return False
        try:
            cap = cv2.VideoCapture(0, cv2.CAP_DSHOW)
            if not cap.isOpened():
                cap = cv2.VideoCapture(0)
            if not cap.isOpened():
                print("[WARNING] Camera not found or in use")
                return False
            cap.set(cv2.CAP_PROP_FRAME_WIDTH,  640)
            cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)
            cap.set(cv2.CAP_PROP_FPS, 30)
            self._cap     = cap
            self._running = True
            self._first_frame_sent = False
            self._thread  = threading.Thread(target=self._loop, daemon=True)
            self._thread.start()

            # Send immediate feedback: camera is starting
            try:
                ev = {
                    'type': 'camera_starting',
                    'fr': 'Démarrage de la caméra',
                    'en': 'Camera starting',
                    'ar': 'تشغيل الكاميرا',
                }
                detect_q.put_nowait(ev)
            except queue.Full:
                pass

            # Wait for first frame with timeout
            time.sleep(0.5)
            if not self._first_frame_sent:
                # Check again briefly for slow cameras
                time.sleep(1)
                if not self._first_frame_sent:
                    print("[WARNING] Camera did not send first frame in 1.5s (slow camera)")

            print("[OK] Camera started")
            return True
        except Exception as e:
            print(f"[WARNING] Camera error: {e}")
            return False

    def stop(self):
        self._running = False
        time.sleep(0.2)  # Wait for thread to exit
        try:
            if self._cap:
                self._cap.release()
                self._cap = None
            with self._lock:
                self._frame = None
            self._first_frame_sent = False
            print("[OK] Camera stopped")
        except Exception as e:
            print(f"[WARNING] Error stopping camera: {e}")

    def _loop(self):
        last_scene = {}   # label → (dist_key, pos_key)
        last_t     = 0

        while self._running:
            ret, frame = self._cap.read()
            if not ret:
                time.sleep(0.05)
                continue

            # Send feedback on first successful frame capture
            if not self._first_frame_sent:
                self._first_frame_sent = True
                try:
                    ev = {
                        'type': 'camera_ready',
                        'fr': 'Caméra prête',
                        'en': 'Camera ready',
                        'ar': 'الكاميرا جاهزة',
                    }
                    detect_q.put_nowait(ev)
                except queue.Full:
                    pass

            frame_h, frame_w = frame.shape[:2]

            if _yolo_model:
                try:
                    results = _yolo_model(frame, imgsz=320, verbose=False, conf=0.5)

                    # Build current scene: keep closest instance per label
                    scene = {}
                    for r in results:
                        for box in r.boxes:
                            cls_id = int(box.cls[0])
                            if cls_id not in TARGET_CLASS_IDS:
                                continue
                            label = _yolo_model.names[cls_id]
                            xyxy  = box.xyxy[0].tolist()
                            dist  = _estimate_distance(xyxy, frame_w, frame_h)
                            pos   = _estimate_position(xyxy, frame_w)
                            # If label already seen, keep the closest occurrence
                            if label not in scene or \
                               list(DIST_LABELS).index(dist) < list(DIST_LABELS).index(scene[label][0]):
                                scene[label] = (dist, pos)

                    now = time.time()
                    # Only announce detection changes after 2-second cooldown (prevent spam from moving objects)
                    if scene != last_scene and (now - last_t) > 2.0:
                        last_t    = now
                        last_scene = scene
                        print(f"[OK] Detection change detected: {len(scene)} objects")

                        # Group detections by distance+position for announcement
                        groups = {}  # (dist, pos) → [labels]
                        for label, (dist, pos) in scene.items():
                            key = (dist, pos)
                            if key not in groups:
                                groups[key] = []
                            groups[key].append(label)

                        # If too many obstacles, announce summary
                        total_obstacles = sum(len(labels) for labels in groups.values())

                        if total_obstacles > 5:
                            # "Many obstacles X away" - announce the closest
                            for dist_val in ['very_close', 'close', 'medium', 'far']:
                                for pos_val in ['left', 'center', 'right']:
                                    if (dist_val, pos_val) in groups:
                                        # Short distance for summary
                                        if dist_val == 'very_close':
                                            dist_fr = 'juste devant'
                                            dist_en = 'right ahead'
                                            dist_ar = 'أمامك مباشرة'
                                        elif dist_val == 'close':
                                            dist_fr = '1 mètre'
                                            dist_en = '1 meter away'
                                            dist_ar = 'متر واحد'
                                        elif dist_val == 'medium':
                                            dist_fr = '2-4 mètres'
                                            dist_en = '2-4 meters away'
                                            dist_ar = '2-4 أمتار'
                                        else:
                                            dist_fr = 'au loin'
                                            dist_en = 'far away'
                                            dist_ar = 'بعيد'

                                        spoken = {
                                            'fr': f"Beaucoup d'obstacles, {dist_fr}",
                                            'en': f"Many obstacles, {dist_en}",
                                            'ar': f"عوائق كثيرة {dist_ar}"
                                        }
                                        ev = {
                                            'type': 'detection',
                                            'label': 'many',
                                            'distance': dist_val,
                                            'position': pos_val,
                                            **spoken,
                                        }
                                        try:
                                            detect_q.put_nowait(ev)
                                        except queue.Full:
                                            pass
                                        break
                                else:
                                    continue
                                break
                        else:
                            # Announce grouped detections
                            for (dist, pos), labels in groups.items():
                                if len(labels) > 1:
                                    # Multiple: "a car and person are 2m away"
                                    labels_with_dist = [(l, dist, pos) for l in labels]
                                    spoken = _build_grouped_spoken(labels_with_dist, dist, pos)
                                    ev = {
                                        'type': 'detection',
                                        'label': '+'.join(labels),
                                        'distance': dist,
                                        'position': pos,
                                        **spoken,
                                    }
                                else:
                                    # Single: "a car is 2m away"
                                    label = labels[0]
                                    spoken = _build_spoken(label, dist, pos)
                                    ev = {
                                        'type': 'detection',
                                        'label': label,
                                        'distance': dist,
                                        'position': pos,
                                        **spoken,
                                    }
                                try:
                                    detect_q.put_nowait(ev)
                                except queue.Full:
                                    pass

                    frame = results[0].plot()
                except Exception as e:
                    print(f"⚠️  YOLO error: {e}")
                    # Continue with raw frame on error

            try:
                ok, buf = cv2.imencode('.jpg', frame, [cv2.IMWRITE_JPEG_QUALITY, 75])
                if ok:
                    with self._lock:
                        self._frame = buf.tobytes()
            except Exception as e:
                print(f"⚠️  Frame encoding error: {e}")

    def get_frame(self):
        with self._lock:
            return self._frame

    @property
    def running(self):
        return self._running


camera = Camera()

# ── Routes — pages ─────────────────────────────────────────────────────────────
@app.route('/')
def index():
    return render_template('assistant.html', ui_all=json.dumps(UI))

@app.route('/family')
def family_page():
    return render_template('family.html')

@app.route('/settings')
def settings_page():
    return render_template('settings.html')

# ── Routes — camera ────────────────────────────────────────────────────────────
@app.route('/start-camera', methods=['GET', 'POST'])
def start_camera():
    lang = request.args.get('lang', 'fr')
    ok   = camera.start()
    msg  = UI[lang]['camera_on'] if ok else UI[lang]['camera_error']
    return jsonify({'ok': ok, 'message': msg})

@app.route('/stop-camera', methods=['GET', 'POST'])
def stop_camera():
    lang = request.args.get('lang', 'fr')
    camera.stop()
    return jsonify({'ok': True, 'message': UI[lang]['camera_off']})

@app.route('/video-feed')
def video_feed():
    def stream():
        while camera.running:
            frame = camera.get_frame()
            if frame:
                yield b'--frame\r\nContent-Type: image/jpeg\r\n\r\n' + frame + b'\r\n'
            time.sleep(0.04)
    return Response(stream(), mimetype='multipart/x-mixed-replace; boundary=frame')

# ── Routes — detection SSE (web client) ────────────────────────────────────────
@app.route('/events')
def detection_events():
    def stream():
        idle_count = 0
        while True:
            try:
                ev = detect_q.get(timeout=20)
                idle_count = 0
                yield f"data: {json.dumps(ev)}\n\n"
            except queue.Empty:
                idle_count += 1
                if idle_count >= 30:  # 10 minutes of no detections, close stream
                    break
                yield f"data: {json.dumps({'type': 'ping'})}\n\n"
    return Response(stream(), mimetype='text/event-stream',
                    headers={'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no'})

# ── Routes — GPS + alerts API (used by web and Flutter) ───────────────────────
@app.route('/api/location', methods=['POST'])
def update_location():
    data = request.get_json() or {}
    try:
        lat = float(data.get('lat'))
        lng = float(data.get('lng'))
        gps_state.update({'lat': lat, 'lng': lng, 'ts': time.time()})
        return jsonify({'ok': True})
    except (TypeError, ValueError, KeyError):
        return jsonify({'ok': False, 'error': 'Invalid coordinates'}), 400

@app.route('/api/location', methods=['GET'])
def get_location():
    return jsonify(gps_state)

@app.route('/api/alert', methods=['POST'])
def create_alert():
    global _alert_id
    with _alert_lock:
        _alert_id += 1
        alert_id = _alert_id
    alert_log.appendleft({
        'id':      alert_id,
        'message': (request.get_json() or {}).get('message', 'SOS'),
        'ts':      time.time(),
    })
    return jsonify({'ok': True})

@app.route('/api/alerts', methods=['GET'])
def get_alerts():
    return jsonify(list(alert_log)[:10])

# ── Routes — UI strings API (Flutter uses this too) ────────────────────────────
@app.route('/api/ui')
def get_ui():
    lang = request.args.get('lang', 'fr')
    return jsonify(UI.get(lang, UI['fr']))

# ── Routes — System status API (for audio feedback) ──────────────────────────────
@app.route('/api/status', methods=['GET'])
def get_status():
    """Return current system state for audio feedback."""
    lang = request.args.get('lang', 'fr')

    # GPS status: check if stale (>30s old)
    gps_enabled = gps_state.get('lat') is not None
    gps_stale = False
    if gps_enabled and gps_state.get('ts'):
        gps_age = time.time() - gps_state['ts']
        gps_stale = gps_age > 30

    return jsonify({
        'camera_running': camera.running,
        'gps_enabled': gps_enabled,
        'gps_stale': gps_stale,
        'gps_age_seconds': time.time() - gps_state.get('ts', time.time()) if gps_enabled else None,
        'gps_lat': gps_state.get('lat'),
        'gps_lng': gps_state.get('lng'),
        'whisper_ready': _whisper_model is not None,
        'whisper_ok': WHISPER_OK,
        'language': lang,
        'status_message': _build_status_message(lang),
    })

@app.route('/api/feedback-message', methods=['GET'])
def get_feedback_message():
    """Return feedback messages for various states."""
    lang = request.args.get('lang', 'fr')
    msg_type = request.args.get('type', 'command_not_recognized')
    return jsonify({
        'message': _build_error_message(msg_type, lang),
        'type': msg_type,
        'lang': lang,
    })

# ── Routes — family SSE ────────────────────────────────────────────────────────
@app.route('/family-events')
def family_events():
    def stream():
        last_alert_id = None
        last_gps      = None
        while True:
            if gps_state['lat'] and gps_state != last_gps:
                last_gps = dict(gps_state)
                yield f"data: {json.dumps({'type': 'gps', **last_gps})}\n\n"
            if alert_log:
                latest = alert_log[0]
                if latest['id'] != last_alert_id:
                    last_alert_id = latest['id']
                    yield f"data: {json.dumps({'type': 'alert', 'message': latest['message']})}\n\n"
            time.sleep(2)
    return Response(stream(), mimetype='text/event-stream',
                    headers={'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no'})

# ── Routes — Whisper STT (web + Flutter) ───────────────────────────────────────
@app.route('/api/whisper-status')
def whisper_status():
    return jsonify({'ready': _whisper_model is not None, 'ok': WHISPER_OK, 'version': 'faster-whisper-base-20240603'})

@app.route('/transcribe', methods=['POST'])
def transcribe():
    if not WHISPER_OK:
        return jsonify({'error': 'whisper not installed', 'text': ''}), 503
    if _whisper_model is None:
        return jsonify({'error': 'model loading', 'text': ''}), 503

    if 'audio' not in request.files:
        return jsonify({'error': 'no audio', 'text': ''}), 400

    # Get configured language (defaults to 'fr' if not provided)
    lang = request.form.get('lang', 'fr').lower()
    lang_map = {'fr': 'fr', 'en': 'en', 'ar': 'ar'}
    whisper_lang = lang_map.get(lang, 'fr')

    with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as f:
        request.files['audio'].save(f.name)
        tmp = f.name

    try:
        audio, _ = _sf.read(tmp, dtype='float32')
        if audio.ndim > 1:
            audio = audio.mean(axis=1)

        # Use configured language (constrain detection), beam_size=1 for fastest speed
        segments, info = _get_whisper().transcribe(
            tmp,
            language=whisper_lang,
            beam_size=1,
            best_of=1,
            without_timestamps=True,
        )

        # Combine all segments into single text
        text = ' '.join([seg.text for seg in segments]).strip().lower()

        # Only filter obvious gibberish, keep short words (they might be valid commands)
        if text in ('...', '..', '.', '?', '!'):
            text = ''

        print(f"[Whisper/{whisper_lang}] {text!r}")

        return jsonify({'text': text})
    except Exception as e:
        print(f"[Faster-Whisper] error: {e}")
        return jsonify({'error': str(e), 'text': ''}), 500
    finally:
        try: os.unlink(tmp)
        except: pass

# ── Startup ────────────────────────────────────────────────────────────────────
_load_yolo()
if WHISPER_OK:
    threading.Thread(target=_get_whisper, daemon=True).start()

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False, use_reloader=False, threaded=True)
