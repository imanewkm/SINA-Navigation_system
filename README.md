# SINA — Voice-Guided Mobility Assistant

![Version](https://img.shields.io/badge/version-1.0-blue)
![Status](https://img.shields.io/badge/status-active-brightgreen)
![License](https://img.shields.io/badge/license-MIT-green)

**SINA** is a free, open-source mobility assistance application designed for visually impaired users. It provides real-time obstacle detection through voice commands, multi-language support (French, English, Arabic), and emergency alerts for family members.

---

## 🎯 Key Features

| Feature | Description | Status |
|---------|-------------|--------|
| **Voice Control** | Hands-free interaction with voice commands | ✅ Active |
| **Real-Time Detection** | YOLO-based obstacle detection with actionable guidance | ✅ Active |
| **Speech Recognition** | Whisper-based STT for multi-language support | ✅ Active |
| **Text-to-Speech** | Browser-native TTS in 3 languages | ✅ Active |
| **GPS Tracking** | Real-time location sharing with family (voice-controlled) | ✅ Active |
| **Emergency Alerts** | One-command SOS with automatic check-in | ✅ Active |
| **Multi-Language** | Full support for French, English, and Arabic | ✅ Active |
| **Family Dashboard** | Real-time map, alerts, system status, QR code sharing | ✅ Active |
| **Camera Stream** | Live MJPEG video feed with bounding boxes | ✅ Active |
| **Audio Feedback** | Confirmation tones for all operations | ✅ Active |
| **Settings via Voice** | Volume, language, sensitivity, GPS all controllable | ✅ Active |
| **System Status** | Real-time feedback on app state and errors | ✅ Active |

---

## 📋 System Requirements

### Hardware
- **Webcam**: USB-connected or built-in camera
- **Microphone**: Built-in or USB-connected audio input
- **Speaker**: For text-to-speech output
- **Optional**: GPS/Geolocation capability (browser-based)

### Software
- **Python 3.8+**
- **Modern web browser** (Chrome, Edge, Firefox)
- **Operating System**: Windows, macOS, or Linux

### Recommended
- **Headphones** for better audio clarity
- **Quiet environment** for accurate voice recognition

---

## 🚀 Installation & Setup

### 1. Clone Repository from GitHub
```bash
git clone https://github.com/imanewkm/SINA-Navigation_system.git
cd SINA-Navigation_system
```

**Or if you already have the folder:**
```bash
cd C:\Users\user\Desktop\PFE-v2
```

### 2. Create Virtual Environment
```bash
python -m venv venv
```

**Activate virtual environment:**
- **Windows PowerShell**: `.\venv\Scripts\Activate.ps1`
- **Windows CMD**: `venv\Scripts\activate.bat`
- **macOS/Linux**: `source venv/bin/activate`

### 3. Install Dependencies
```bash
pip install -r requirements.txt
```

Dependencies include:
- `flask>=3.0.0` - Web framework
- `flask-cors>=4.0.0` - Cross-origin requests
- `ultralytics>=8.0.0` - YOLO object detection
- `opencv-python>=4.8.0` - Camera & image processing
- `openai-whisper` - Speech-to-text (automatically installed via requirements)

**Note**: First-time setup will download:
- YOLO model (~80 MB)
- Whisper tiny model (~75 MB)

### 4. Run the Application
```bash
python app.py
```

Expected output:
```
✅ YOLO loaded: best.pt (11 classes)
✅ Whisper ready
 * Running on http://0.0.0.0:5000
```

### 5. Access the Web Interface
- **Assistant Interface**: `http://localhost:5000/` (main app for users)
- **Family Dashboard**: `http://localhost:5000/family` (real-time alerts & location)

---

## 🎙️ User Guide

### Starting SINA
1. Open `http://localhost:5000/` in your browser (works on mobile, tablet, desktop)
2. **Tap anywhere** on the screen to activate (establishes user gesture for audio)
3. Choose or confirm language in settings (French by default)
4. Listen for the welcome message in your selected language
5. Begin speaking commands

### Settings Panel (NEW)
Click the **settings icon** (sliders) in the bottom controls to adjust:
- **Language**: French, English, Arabic (Whisper constrains to selected language only)
- **Speech Speed**: 0.7x - 1.3x playback speed
- **Volume**: 0% - 100% for text-to-speech and effects
- **Sound Effects**: Toggle detection/alert sounds on/off
- **Detection Sensitivity**: Low, Medium, High (for YOLO confidence threshold)
- **GPS Tracking**: Enable/disable location sharing
- **Camera Auto-Start**: Auto-activate detection when opening camera

All settings saved locally — persists across sessions.

### Voice Commands

#### Camera Control
| Command (FR) | Command (EN) | Command (AR) | Function |
|---|---|---|---|
| "Ouvre la caméra" | "Open camera" | "افتح الكاميرا" | Activate obstacle detection |
| "Ferme la caméra" | "Stop camera" | "أغلق الكاميرا" | Deactivate detection |

#### Scene Description
| Command (FR) | Command (EN) | Command (AR) | Function |
|---|---|---|---|
| "Qu'est-ce que tu vois?" | "What do you see?" | "ما الذي تراه؟" | Describe current obstacles |
| "Décris ce que tu vois" | "Describe the scene" | "صف ما تراه" | Describe current obstacles |

#### Settings and Status (Voice-Controlled)
| Command (FR) | Command (EN) | Command (AR) | Function |
|---|---|---|---|
| "Quel volume" | "What's my volume" | "ما مستوى الصوت" | Check current volume level |
| "Volume plus" | "Volume up" | "أعلى مستوى" | Increase volume by 10% |
| "Volume moins" | "Volume down" | "أقل مستوى" | Decrease volume by 10% |
| "GPS activé" | "GPS on" | "تشغيل GPS" | Enable location sharing |
| "GPS désactivé" | "GPS off" | "إيقاف GPS" | Disable location sharing |
| "Où suis-je" | "Where am I" | "أين أنا" | Announce current coordinates |
| "Quel est ton statut" | "What's your status" | "ما حالتك" | Report all system status |
| "Aide" | "Help" | "مساعدة" | Explain all available commands |

#### Language Switching
| Command (FR) | Command (EN) | Command (AR) |
|---|---|---|
| "Français" | "French" | "فرنسية" |
| "Anglais" | "English" | "إنجليزية" |
| "Arabe" | "Arabic" | "عربية" |

#### Emergency
| Command (FR) | Command (EN) | Command (AR) | Function |
|---|---|---|---|
| "Au secours" | "Help" | "مساعدة" | Trigger SOS alert |
| "Danger" | "Emergency" | "خطر" | Trigger SOS alert |

### Detection Descriptions with Actionable Guidance
When obstacles are detected, you hear descriptions with safety instructions based on distance:

**Very Close (< 1m)**
- "Attention: Voiture très proche devant vous. Arrêtez-vous ou bougez."
- "Caution: Car very close ahead. Stop or move away."

**Close (1-2m)**
- "Voiture à 1 mètre devant vous. Vous pouvez marcher, restez prudent."
- "Car at 1 meter ahead. Safe to walk, stay alert."

**Medium (2-4m)**
- "Voiture à 2-4 mètres devant vous. Vous pouvez marcher librement."
- "Car at 2-4 meters ahead. You can walk freely."

**Far (>4m)**
- "Voiture au loin devant vous. Pas de danger immédiat."
- "Car far away ahead. No immediate danger."

Each message includes:
- **Object type** (person, car, bicycle, etc.)
- **Distance** with context-appropriate guidance
- **Position** (left, center, right relative to user)

### Family Dashboard
Visit `http://localhost:5000/family` to view:
- **Live map** with user's real-time GPS location (blue marker)
- **Alert log** showing all emergency alerts with timestamps
- **Location history** (last 10 GPS updates)

---

## 🏗️ Architecture

### Backend (Flask + Python)
```
PFE_SINA/
├── app.py                 # Main Flask application (port 5000)
├── requirements.txt       # Python dependencies
├── templates/             # HTML templates
│   ├── assistant.html     # Main user interface
│   ├── family.html        # Family dashboard
│   ├── login.html         # Voice-guided login (future)
│   └── register.html      # Voice-guided registration (future)
├── static/
│   └── js/
│       ├── assistant.js   # Main app logic & voice control
│       ├── auth.js        # Authentication flows
│       └── recorder.js    # Audio recording & Whisper integration
└── scripts/
    ├── train.py           # Model training utilities
    ├── detect.py          # Standalone detection script
    └── download_coco.py   # Dataset utilities
```

### Frontend (Vanilla JavaScript)
- **No external dependencies** - uses browser native APIs
- **Web Audio API** - Sound effects and TTS
- **Web Speech API / Whisper** - Voice recognition
- **EventSource (SSE)** - Real-time detection updates
- **Geolocation API** - GPS tracking

### Data Flow
```
User Voice
    ↓
Recorder.js (Record audio, feedback tones)
    ↓
/transcribe endpoint (Whisper)
    ↓
assistant.js (Parse commands, read back recognized text)
    ↓
Execute action (camera, language, SOS, settings, etc.)
    ↓
/start-camera, /api/alert, /api/status, /api/feedback-message
    ↓
YOLO detection loop (continuous)
    ↓
/events SSE stream (camera_starting, camera_ready, detection events)
    ↓
Browser TTS + Detection banner + Audio feedback tones
```

### New API Endpoints (June 5, 2026)
- `/api/status` - Returns camera, GPS, Whisper status and multilingual status message
- `/api/feedback-message` - Returns error/warning messages for various states
- `/events` - Enhanced with camera_starting and camera_ready feedback events

---

## ⚙️ Configuration

### Environment Variables (optional)
Create `.env` file in `PFE_SINA/`:
```bash
SECRET_KEY=your-secret-key
FLASK_ENV=production
```

### Supported Classes (YOLO)
The model detects 11 mobility-relevant objects:
- Person
- Bicycle
- Car
- Motorcycle
- Traffic light
- Stop sign
- Bench
- Bottle
- Chair
- Potted plant
- Dining table

---

## 🔒 Accessibility Features

### For Visually Impaired Users
✅ **No visual dependency**: All feedback is audio-based  
✅ **Voice commands**: Hands-free operation with 8+ settings commands
✅ **Audio feedback**: Confirmation tones for record start, transcription success, camera initialization
✅ **Multi-language**: Support for Arabic (RTL), French, English  
✅ **Screen reader compatible**: Semantic HTML structure  
✅ **System status feedback**: Real-time announcements of app state changes
✅ **Silent failure prevention**: Alerts if Whisper loading, GPS stale, or camera unresponsive
✅ **Settings control**: Full voice control of volume, language, sensitivity, GPS, status

### For Family Members
✅ **Real-time alerts**: SOS notifications with user location  
✅ **Location tracking**: Live GPS feed to map with sharing toggle  
✅ **Alert history**: 50 most recent alerts stored with timestamps
✅ **System status**: See if user's camera and GPS are active
✅ **QR code sharing**: Easy mobile access to family dashboard
✅ **Auto check-in**: Family notified if user triggers SOS for extended period

### Independence Features (June 5, 2026)
✅ **Audio-only management**: User controls all settings without seeing screen
✅ **Actionable descriptions**: Obstacle announcements guide user behavior
✅ **Status monitoring**: User can check system status by voice
✅ **Help system**: "Help" command explains all available commands
✅ **Emergency with confirmation**: SOS triggers automatic family check-in
✅ **No silent operations**: Every system state change announced via audio  

---

## 📅 Feature Implementation Timeline

| Feature | Implementation Date | Status |
|---------|----------------------|--------|
| Flask server setup | Feb 12, 2024 | ✅ Complete |
| YOLO integration | Feb 12, 2024 | ✅ Complete |
| Real-time detection | Feb 12, 2024 | ✅ Complete |
| Whisper STT | Feb 12, 2024 | ✅ Complete |
| Text-to-speech | Feb 12, 2024 | ✅ Complete |
| Multi-language support (FR/EN/AR) | Feb 12, 2024 | ✅ Complete |
| GPS tracking | Feb 12, 2024 | ✅ Complete |
| Family dashboard | Feb 12, 2024 | ✅ Complete |
| Emergency alerts (SOS) | Feb 12, 2024 | ✅ Complete |
| Voice-guided login | Development | 🔄 Planned |
| User authentication | Development | 🔄 Planned |
| Persistent storage | Development | 🔄 Planned |
| Bug fixes & refactoring | June 3, 2026 | ✅ Complete |
| Accessibility audit | June 3, 2026 | ✅ Complete |

---

## 🐛 Troubleshooting

### "Camera not opening"
**Solution**:
1. Check camera is connected and not in use by another app
2. Grant browser permission: Settings → Privacy → Camera
3. Try restarting the browser and server

### "Microphone blocked"
**Solution**:
1. Check browser permissions: Settings → Privacy → Microphone
2. Grant permission and refresh page
3. Ensure no other app is monopolizing microphone

### "Whisper loading takes too long"
**Solution**:
- First run downloads ~75 MB model (takes 2-5 minutes)
- Subsequent runs load from cache (instant)
- Use wired connection for faster download

### "No detections appearing"
**Solution**:
1. Ensure camera is active (tap "Ouvre la caméra")
2. Wait 2+ seconds — detection throttled to avoid spam
3. Position yourself within ~4 meters of obstacles
4. Check camera has good lighting

### "Commands not recognized"
**Solution**:
1. Speak clearly in the selected language
2. Use exact command keywords (see Voice Commands table)
3. Avoid background noise
4. Test microphone in browser's mic settings

### "Port 5000 already in use"
**Solution**:
```bash
# Windows: Find and kill process on port 5000
netstat -ano | findstr :5000
taskkill /PID <PID> /F

# macOS/Linux:
lsof -ti:5000 | xargs kill -9
```

---

## 🔧 Advanced Usage

### Training Custom Model
```bash
cd PFE_SINA
python scripts/train.py --data coco128.yaml --epochs 100
```

### Standalone Detection
```bash
python scripts/detect.py --source 0 --model best.pt
```

### Downloading Dataset
```bash
python dataset/download_coco.py
```

---

## 📝 Development Notes

### Code Quality
- **No external dependencies** for frontend (accessibility + reliability)
- **Thread-safe globals** using `threading.Lock()`
- **Input validation** on all POST endpoints
- **Error handling** for camera, microphone, and network failures

### Performance Optimizations
- **Voice Detection**: ~0.5-1 second latency (Whisper beam_size=1, language-constrained)
- **Language Constraint**: Whisper locked to configured language only (no auto-detection switching)
- **Silence Detection**: 1.5 second delay after speech ends (down from 3.5s)
- **YOLO Inference**: 320px resolution (fast, low-latency)
- **Detection Throttling**: 1 per 2 seconds (avoids speech spam)
- **JPEG Quality**: 75% (balance between size and clarity)
- **Whisper Model**: Tiny model (~39M parameters, ~75MB) + optimized parameters
- **Responsive Design**: Adapts to mobile (<768px), tablet (768-1024px), desktop (1024px+)

### Known Limitations
- **No database**: Data lost on server restart (by design, for simplicity)
- **In-memory alerts**: Maximum 50 stored; older alerts are dropped
- **Single-user**: Designed for one user per instance (not multi-user)
- **No authentication**: Trust-based system (no credentials)

### Recent Improvements

#### June 4, 2026 (Initial Session)
- Language constraint enforcement for Whisper
- Faster voice detection (1.5s silence delay, down from 2.5s)
- Settings persistence via localStorage
- Responsive mobile/tablet/desktop design
- Scene description command
- Smart obstacle grouping for multiple detections

#### June 5, 2026 (Tier 1 Independence Features)
- **Audio Feedback System**: Confirmation tones for all operations (ready chime, detection tone, record start/stop)
- **No Silent Failures**: Whisper loading alerts, GPS staleness warnings, camera timeout detection
- **Voice-Controlled Settings**: 8+ new commands for volume, GPS, language, sensitivity, status
- **Actionable Detection Guidance**: Distance-based safety instructions (stop/walk/free to walk)
- **Help System**: "Help" command explains all available voice commands
- **SOS Safety**: 10-second quiet mode, automatic check-in after 30s
- **Family Dashboard Enhancements**: QR code sharing, system status monitoring, improved alerts
- **Recording Feedback**: Audio confirmation when recording starts, transcription succeeds, or fails
- **SSE Event Enhancement**: Added camera initialization feedback events
- **Comprehensive Debugging**: Added console logging for issue tracking and verification

---

## 📖 References

- [YOLO Documentation](https://github.com/ultralytics/ultralytics)
- [OpenAI Whisper](https://github.com/openai/whisper)
- [Flask Documentation](https://flask.palletsprojects.com/)
- [Web Audio API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API)
- [Geolocation API](https://developer.mozilla.org/en-US/docs/Web/API/Geolocation_API)

---

## 📄 License

This project is released under the **MIT License**. See LICENSE file for details.

---

## 👥 Contributors

- **Project**: SINA - Mobility Assistant for Visually Impaired Users
- **Academic Institution**: Final Year University Project (PFE)
- **Maintenance**: June 2026

---

## 📞 Support

For issues, questions, or feature requests:
1. Check the **Troubleshooting** section above
2. Review browser console logs: `F12` → Console tab
3. Check server logs for backend errors

---

**Last Updated**: June 3, 2026  
**Status**: Production Ready ✅

---

## 🎯 Future Roadmap

- [ ] User authentication & profiles
- [ ] Persistent database backend
- [ ] Multi-user support
- [ ] Mobile app (Flutter/React Native)
- [ ] Offline mode
- [ ] Custom hotword detection
- [ ] Integration with smart home devices
- [ ] Better Arabic/RTL support
- [ ] Keyboard-only navigation
- [ ] Voice feedback customization
