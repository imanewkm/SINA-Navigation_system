"""
SINA Phase 2 — Fine-tuning YOLOv8n on the COCO mobility dataset
================================================================
Run from PFE_SINA/:
    python scripts/train.py

Prerequisites:
    python dataset/download_coco.py   (must complete first)

What this does:
    - Starts from yolov8n.pt (pre-trained on all 80 COCO classes)
    - Fine-tunes only on our 11 mobility classes
    - Freezes the backbone (layers 0-9) for the first pass so the
      head adapts quickly without forgetting pre-trained features
    - Results saved to runs/detect/sina_mobility/
    - app.py auto-loads best.pt from that folder on next restart
"""

import os
from pathlib import Path
from ultralytics import YOLO

BASE      = Path(__file__).parent.parent          # PFE_SINA/
DATA_YAML = BASE / 'dataset' / 'data.yaml'
MODEL_PT  = BASE / 'yolov8n.pt'
RESULTS   = BASE / 'runs' / 'detect' / 'sina_mobility'

# ── Sanity checks ──────────────────────────────────────────────────────────────
if not DATA_YAML.exists():
    raise FileNotFoundError(
        f'data.yaml not found at {DATA_YAML}\n'
        'Run  python dataset/download_coco.py  first.'
    )

train_dir = BASE / 'dataset' / 'images' / 'train'
if not train_dir.exists() or not any(train_dir.iterdir()):
    raise FileNotFoundError(
        f'No training images found in {train_dir}\n'
        'Run  python dataset/download_coco.py  first.'
    )

n_train = sum(1 for _ in train_dir.iterdir())
print(f'\n{"="*60}')
print('  SINA — YOLOv8 Fine-Tuning')
print(f'{"="*60}')
print(f'  Base model    : {MODEL_PT.name}')
print(f'  Dataset       : {DATA_YAML}')
print(f'  Training imgs : {n_train}')
print(f'  Output        : {RESULTS}')
print()

# ── Load model ─────────────────────────────────────────────────────────────────
model = YOLO(str(MODEL_PT))

# ── Train ──────────────────────────────────────────────────────────────────────
results = model.train(
    data       = str(DATA_YAML),
    epochs     = 50,
    imgsz      = 640,
    batch      = 16,          # reduce to 8 if you get CUDA out-of-memory
    name       = 'sina_mobility',
    project    = str(BASE / 'runs' / 'detect'),
    exist_ok   = True,        # overwrite previous sina_mobility run

    # Fine-tuning settings
    freeze     = 10,          # freeze backbone (layers 0-9), train head only
    lr0        = 0.001,       # lower LR for fine-tuning (default 0.01)
    lrf        = 0.1,         # final LR = lr0 * lrf
    warmup_epochs = 3,
    patience   = 15,          # early stopping if no improvement for 15 epochs
    optimizer  = 'AdamW',

    # Data augmentation — keep modest to preserve pre-trained features
    hsv_h      = 0.015,
    hsv_s      = 0.7,
    hsv_v      = 0.4,
    flipud     = 0.0,
    fliplr     = 0.5,
    mosaic     = 1.0,

    # Logging
    verbose    = True,
    save       = True,
    save_period= 10,          # save checkpoint every 10 epochs
    val        = True,
)

# ── Report ─────────────────────────────────────────────────────────────────────
best = BASE / 'runs' / 'detect' / 'sina_mobility' / 'weights' / 'best.pt'
print(f'\n{"="*60}')
print('  Training complete!')
print(f'{"="*60}')
if best.exists():
    print(f'  Best model : {best}')
    print('  Restart app.py — it will auto-load the fine-tuned model.')
else:
    print('  ⚠  best.pt not found — check the runs/ directory.')
print()
