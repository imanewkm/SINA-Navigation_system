"""
SINA — Standalone camera test with YOLO detection
Run from anywhere:  python PFE_SINA/scripts/detect.py
Press Q to quit.
"""
import sys
from pathlib import Path

# Resolve model path relative to this script, not the working directory
BASE      = Path(__file__).parent.parent          # PFE_SINA/
MODEL_PT  = BASE / 'yolov8n.pt'

# Prefer the fine-tuned model if it exists
FINE_TUNED = BASE / 'runs' / 'detect' / 'sina_mobility' / 'weights' / 'best.pt'
if FINE_TUNED.exists():
    MODEL_PT = FINE_TUNED

try:
    import cv2
except ImportError:
    sys.exit("❌  OpenCV not installed.  Run:  python -m pip install opencv-python --user")

try:
    from ultralytics import YOLO
except ImportError:
    sys.exit("❌  ultralytics not installed.  Run:  python -m pip install ultralytics --user")

if not MODEL_PT.exists():
    sys.exit(f"❌  Model not found: {MODEL_PT}")

print(f"✅  Loading model: {MODEL_PT.name}")
model = YOLO(str(MODEL_PT))

print("📷  Opening camera…")
cap = cv2.VideoCapture(0, cv2.CAP_DSHOW)   # CAP_DSHOW = faster init on Windows
if not cap.isOpened():
    cap = cv2.VideoCapture(0)              # fallback without DirectShow
if not cap.isOpened():
    sys.exit("❌  Cannot open camera. Check it is connected and not used by another app.")

cap.set(cv2.CAP_PROP_FRAME_WIDTH,  640)
cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)

print("✅  Camera open — press Q to quit\n")

while True:
    ret, frame = cap.read()
    if not ret:
        print("⚠  Frame read failed — camera disconnected?")
        break

    results = model(frame, imgsz=320, verbose=False)

    # Draw all detections — class filtering is handled in app.py, not here
    annotated = results[0].plot()
    cv2.imshow("SINA Detection  (Q to quit)", annotated)

    if cv2.waitKey(1) & 0xFF == ord('q'):
        break

cap.release()
cv2.destroyAllWindows()
print("Camera closed.")
