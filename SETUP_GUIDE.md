# SINA Setup Guide for Testing

This guide will help you set up SINA (Mobility Assistance System) on your machine for testing and development.

## Prerequisites

Before starting, ensure you have:
- Python 3.8 or higher installed
- Git installed
- A working webcam
- A microphone
- At least 2GB free disk space (for models)
- Modern web browser (Chrome, Firefox, Edge)

## Step 1: Clone the Repository

```bash
git clone https://github.com/imanewkm/SINA-Navigation_system.git
cd SINA-Navigation_system
```

## Step 2: Create Virtual Environment

Create an isolated Python environment for this project:

### Windows (PowerShell)
```powershell
python -m venv venv
.\venv\Scripts\Activate.ps1
```

### Windows (Command Prompt)
```cmd
python -m venv venv
venv\Scripts\activate.bat
```

### macOS/Linux
```bash
python3 -m venv venv
source venv/bin/activate
```

After activation, your terminal should show `(venv)` at the beginning of the line.

## Step 3: Install Dependencies

```bash
pip install --upgrade pip
pip install flask==3.0.0
pip install flask-cors==4.0.0
pip install opencv-python==4.8.0.76
pip install ultralytics==8.0.0
pip install faster-whisper==0.10.0
pip install soundfile==0.12.1
pip install numpy==1.24.3
pip install torch==2.0.0
```

Or use this one-liner:
```bash
pip install flask==3.0.0 flask-cors==4.0.0 opencv-python==4.8.0.76 ultralytics==8.0.0 faster-whisper==0.10.0 soundfile==0.12.1 numpy==1.24.3 torch==2.0.0
```

## Step 4: Download YOLO Model

The project requires YOLOv8 nano model for object detection. Download it:

```bash
python -c "from ultralytics import YOLO; YOLO('yolov8n.pt')"
```

This will download the model (~42MB) and save it as `yolov8n.pt` in the project root.

Verify it downloaded:
- Check if `yolov8n.pt` file exists in your project directory

## Step 5: Run the Application

Start the Flask backend:

```bash
python app.py
```

You should see output like:
```
[OK] YOLO loaded: yolov8n.pt (80 classes)
[OK] Faster-Whisper ready
 * Running on http://0.0.0.0:5000
```

## Step 6: Access the Web Interface

Open your browser and go to:
```
http://localhost:5000
```

You should see the SINA interface with the purple gradient background and microphone button.

## Testing the Features

### Basic Setup Test
1. Click anywhere on the screen to activate (establishes user gesture for audio)
2. Click the microphone button and say "Bonjour" (Hello)
3. Wait for the app to respond - you should hear "Bonjour, je suis SINA..."

### Camera Detection Test
1. Say "ouvre caméra" (open camera)
2. You should hear "Caméra activée" (Camera activated)
3. Move in front of the camera
4. The app should announce detected objects like "Personne très proche" (Person very close)

### Voice Commands Test
Try these commands:
- "Quel volume" - Check volume level
- "Volume plus" - Increase volume
- "Où suis-je" - Check location
- "Aide" - Get help with available commands
- "Au secours" - Trigger emergency alert (SOS)

### Family Dashboard
Open a second browser tab:
```
http://localhost:5000/family
```

This shows real-time location tracking and alerts (will update when you trigger SOS).

## Troubleshooting

### Issue: "No YOLO model found"
**Solution:** Make sure you ran the download command in Step 4. Check that `yolov8n.pt` exists in the project root.

### Issue: "Camera not found"
**Solution:**
- Check browser permissions: Settings > Privacy > Camera
- Make sure no other application is using the camera
- Try restarting the browser
- Verify the camera works with other apps first

### Issue: "Microphone blocked"
**Solution:**
- Check browser permissions: Settings > Privacy > Microphone
- Grant permission to the browser
- Ensure no other app is monopolizing the microphone

### Issue: "Port 5000 already in use"
**Solution:**
- Find the process using port 5000:
  - Windows: `netstat -ano | findstr :5000`
  - macOS/Linux: `lsof -ti:5000`
- Kill the process or use a different port by editing app.py (change `port=5000` to `port=5001`)

### Issue: "Voice recognition not working"
**Solution:**
- First run downloads the Whisper model (~140MB) - wait for message "Faster-Whisper ready"
- Ensure microphone is working (test in system settings)
- Speak clearly in your chosen language
- Use exact command keywords from the guide

### Issue: "Slow voice response (5+ seconds)"
**Solution:**
- This is normal on first use while Whisper model loads
- Subsequent uses will be faster (1-2 seconds)
- Slower computers may take longer
- YOLO detection also uses CPU - close other applications if needed

## File Structure

```
SINA-Navigation_system/
├── app.py                 # Flask backend
├── README.md             # Feature documentation
├── SETUP_GUIDE.md        # This file
├── yolov8n.pt           # YOLO model (downloaded)
├── templates/            # HTML templates
│   ├── assistant.html    # Main UI
│   ├── family.html       # Family dashboard
│   └── ...
└── static/               # CSS, JavaScript
    ├── css/
    │   └── main.css
    └── js/
        ├── assistant.js  # Main app logic
        ├── recorder.js   # Audio recording
        └── ...
```

## System Information Used in Testing

The following configuration was used during development and testing:

- Python 3.12
- Flask 3.0.0
- OpenCV 4.8.0
- YOLOv8n (nano model)
- Faster-Whisper base model
- Windows 11 with webcam and microphone
- Chrome browser

## Performance Notes

- First YOLO detection: ~2-3 seconds (model initialization)
- Subsequent detections: ~0.5-1 second
- First voice recognition: ~10 seconds (Whisper model downloads ~140MB on first run)
- Subsequent voice: ~1-2 seconds
- Detection throttling: 2 seconds between announcements (prevents spam)

## Next Steps

1. Test all voice commands from the guide
2. Try moving objects in front of camera to trigger detections
3. Test SOS alert and family dashboard
4. Verify all features work in your language preference
5. Check browser console (F12) for any errors

## Support

If you encounter issues:
1. Check the troubleshooting section above
2. Open browser developer console (F12) and check for error messages
3. Check Flask terminal for backend errors
4. Verify all dependencies installed correctly: `pip list`
5. Ensure YOLO model file exists: `yolov8n.pt` in project root

## Language Settings

SINA supports three languages:
- French (FR) - default
- English (EN)
- Arabic (AR)

Change language by saying:
- "Français" / "French" / "فرنسية"
- "Anglais" / "English" / "إنجليزية"
- "Arabe" / "Arabic" / "عربية"

---

Last Updated: June 5, 2026
SINA Version: 1.0 (MVP with Tier 1 Independence Features)
