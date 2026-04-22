#!/usr/bin/env python3
"""
Face detection script for AI Reframe.

Primary detector: MediaPipe Face Detection (full-range model).
Falls back to OpenCV Haar Cascades if mediapipe is unavailable so the
existing single-subject face-tracking mode keeps working even if the
Docker build regresses.

Output JSON shape is a superset of the legacy format:

  {
    "width", "height", "fps", "duration", "total_samples",
    "detector": "mediapipe" | "opencv",

    # Legacy per-frame list (used by single-subject face tracking).
    "samples": [
      {"time", "frame", "faces": [{"x","y","w","h","cx","cy","conf"}]}
    ],

    # New per-subject tracks (used by multi-subject grid mode).
    # IDs are persistent across frames via IOU-based tracking so a
    # subject keeps the same ID even when they briefly look away or
    # get temporarily occluded.
    "subjects": [
      {
        "id",
        "total_seen",        # number of samples this subject was detected in
        "first_seen", "last_seen",
        "avg_size",          # avg face width as fraction of frame width
        "thumbnail_time",    # timestamp with the largest/most-frontal detection
        "samples": [
          {"time", "cx", "cy", "w", "h"}
        ]
      }
    ]
  }

Subjects are sorted by total_seen DESC and capped at MAX_SUBJECTS.
"""

import sys
import json
import os

import cv2

MAX_SUBJECTS = 4
IOU_MATCH_THRESHOLD = 0.25
MAX_MISSING_FRAMES = 6  # drop a track if not seen for this many consecutive samples

# Try mediapipe; fall back gracefully.
try:
    import mediapipe as mp  # type: ignore
    HAS_MEDIAPIPE = True
except Exception:
    HAS_MEDIAPIPE = False


def iou(a, b):
    """IOU of two (x, y, w, h) boxes in pixel space."""
    ax1, ay1, aw, ah = a
    bx1, by1, bw, bh = b
    ax2, ay2 = ax1 + aw, ay1 + ah
    bx2, by2 = bx1 + bw, by1 + bh
    ix1, iy1 = max(ax1, bx1), max(ay1, by1)
    ix2, iy2 = min(ax2, bx2), min(ay2, by2)
    iw, ih = max(0, ix2 - ix1), max(0, iy2 - iy1)
    inter = iw * ih
    union = aw * ah + bw * bh - inter
    return inter / union if union > 0 else 0.0


class Track:
    __slots__ = ("id", "bbox", "samples", "missing", "total_seen",
                 "first_seen", "last_seen", "max_w", "thumbnail_time")

    def __init__(self, track_id, bbox, time):
        self.id = track_id
        self.bbox = bbox
        self.samples = []
        self.missing = 0
        self.total_seen = 0
        self.first_seen = time
        self.last_seen = time
        self.max_w = 0
        self.thumbnail_time = time

    def update(self, bbox, time, frame_w, frame_h):
        self.bbox = bbox
        self.missing = 0
        self.total_seen += 1
        self.last_seen = time
        x, y, w, h = bbox
        if w > self.max_w:
            self.max_w = w
            self.thumbnail_time = time
        self.samples.append({
            "time": round(time, 3),
            "cx": round((x + w / 2) / frame_w, 4),
            "cy": round((y + h / 2) / frame_h, 4),
            "w": round(w / frame_w, 4),
            "h": round(h / frame_h, 4),
        })


def match_tracks_to_detections(tracks, detections):
    """Greedy IOU matching. Returns list of (track, detection) pairs and unmatched detections."""
    pairs = []
    unmatched_dets = list(range(len(detections)))
    unmatched_tracks = list(range(len(tracks)))

    # Build all candidate (iou, track_idx, det_idx) above threshold, sort desc.
    candidates = []
    for ti, t in enumerate(tracks):
        for di, d in enumerate(detections):
            score = iou(t.bbox, d["bbox"])
            if score >= IOU_MATCH_THRESHOLD:
                candidates.append((score, ti, di))
    candidates.sort(reverse=True)

    used_t, used_d = set(), set()
    for score, ti, di in candidates:
        if ti in used_t or di in used_d:
            continue
        used_t.add(ti); used_d.add(di)
        pairs.append((tracks[ti], detections[di]))
        if ti in unmatched_tracks: unmatched_tracks.remove(ti)
        if di in unmatched_dets: unmatched_dets.remove(di)

    return pairs, unmatched_tracks, unmatched_dets


def detect_frame_mediapipe(detector, frame, width, height):
    """Run MediaPipe face detection on a BGR frame. Returns list of detections sorted by confidence DESC."""
    rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
    results = detector.process(rgb)
    detections = []
    if not results.detections:
        return detections
    for d in results.detections:
        score = float(d.score[0]) if d.score else 0.0
        rel = d.location_data.relative_bounding_box
        x = max(0, int(rel.xmin * width))
        y = max(0, int(rel.ymin * height))
        w = max(1, int(rel.width * width))
        h = max(1, int(rel.height * height))
        # Clip to frame bounds
        if x + w > width:  w = width - x
        if y + h > height: h = height - y
        if w <= 0 or h <= 0:
            continue
        detections.append({"bbox": (x, y, w, h), "conf": score})
    detections.sort(key=lambda d: d["conf"], reverse=True)
    return detections


def detect_frame_opencv(frontal, profile, frame, width, height):
    """Legacy Haar cascade detection."""
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    gray = cv2.equalizeHist(gray)
    min_size = (max(1, int(width * 0.05)), max(1, int(height * 0.05)))
    faces = frontal.detectMultiScale(gray, scaleFactor=1.1, minNeighbors=5,
                                     minSize=min_size, flags=cv2.CASCADE_SCALE_IMAGE)
    if len(faces) == 0:
        faces = profile.detectMultiScale(gray, scaleFactor=1.1, minNeighbors=5,
                                         minSize=min_size, flags=cv2.CASCADE_SCALE_IMAGE)
    return [{"bbox": (int(x), int(y), int(w), int(h)), "conf": 1.0} for (x, y, w, h) in faces]


def detect_faces(video_path, sample_interval=0.2):
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        print(json.dumps({"error": "Cannot open video"}))
        sys.exit(1)

    fps = cap.get(cv2.CAP_PROP_FPS) or 30
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    duration = total_frames / fps if fps > 0 else 0

    # Detector setup
    mp_detector = None
    cascade_frontal = None
    cascade_profile = None
    detector_name = "none"

    if HAS_MEDIAPIPE:
        try:
            mp_detector = mp.solutions.face_detection.FaceDetection(
                model_selection=1,          # full-range, works up to ~5m
                min_detection_confidence=0.5,
            )
            detector_name = "mediapipe"
        except Exception:
            mp_detector = None

    if mp_detector is None:
        cascade_path = os.path.join(cv2.data.haarcascades, 'haarcascade_frontalface_default.xml')
        profile_path = os.path.join(cv2.data.haarcascades, 'haarcascade_profileface.xml')
        cascade_frontal = cv2.CascadeClassifier(cascade_path)
        cascade_profile = cv2.CascadeClassifier(profile_path)
        detector_name = "opencv"

    legacy_samples = []
    tracks = []
    next_track_id = 0

    frame_interval = max(1, int(fps * sample_interval))
    frame_idx = 0
    while True:
        ret, frame = cap.read()
        if not ret:
            break

        if frame_idx % frame_interval == 0:
            timestamp = frame_idx / fps

            if mp_detector is not None:
                detections = detect_frame_mediapipe(mp_detector, frame, width, height)
            else:
                detections = detect_frame_opencv(cascade_frontal, cascade_profile, frame, width, height)

            # Keep only top-N by confidence (plus track-matched ones below).
            # We still try to match all detections to existing tracks first, so
            # a low-confidence detection that keeps an existing track alive
            # beats a high-confidence spurious one.

            # --- tracker update ---
            pairs, unmatched_tracks, unmatched_dets = match_tracks_to_detections(tracks, detections)
            for track, det in pairs:
                track.update(det["bbox"], timestamp, width, height)
            for ti in unmatched_tracks:
                tracks[ti].missing += 1
            # Drop stale tracks
            tracks = [t for t in tracks if t.missing <= MAX_MISSING_FRAMES]
            # Start new tracks for unmatched detections, capped at MAX_SUBJECTS active
            for di in unmatched_dets:
                active = sum(1 for t in tracks if t.missing == 0)
                if active >= MAX_SUBJECTS:
                    break
                t = Track(next_track_id, detections[di]["bbox"], timestamp)
                t.update(detections[di]["bbox"], timestamp, width, height)
                tracks.append(t)
                next_track_id += 1

            # --- legacy per-frame sample for backward compatibility ---
            face_list = []
            for d in detections:
                x, y, w, h = d["bbox"]
                face_list.append({
                    "x": int(x), "y": int(y), "w": int(w), "h": int(h),
                    "cx": round((x + w / 2) / width, 4),
                    "cy": round((y + h / 2) / height, 4),
                    "conf": round(d.get("conf", 1.0), 3),
                })
            legacy_samples.append({
                "time": round(timestamp, 3),
                "frame": frame_idx,
                "faces": face_list,
            })

        frame_idx += 1

    cap.release()
    if mp_detector is not None:
        try: mp_detector.close()
        except Exception: pass

    # Finalize subjects: keep only the ones with meaningful presence,
    # sort by total_seen DESC, cap at MAX_SUBJECTS.
    finalized = sorted(tracks, key=lambda t: t.total_seen, reverse=True)
    finalized = [t for t in finalized if t.total_seen >= 2][:MAX_SUBJECTS]

    subjects = []
    for i, t in enumerate(finalized):
        avg_w = (sum(s["w"] for s in t.samples) / len(t.samples)) if t.samples else 0
        subjects.append({
            "id": i,  # re-index for stable 0..N-1 public IDs
            "internal_id": t.id,
            "total_seen": t.total_seen,
            "first_seen": round(t.first_seen, 3),
            "last_seen": round(t.last_seen, 3),
            "avg_size": round(avg_w, 4),
            "thumbnail_time": round(t.thumbnail_time, 3),
            "samples": t.samples,
        })

    output = {
        "width": width,
        "height": height,
        "fps": round(fps, 2),
        "duration": round(duration, 2),
        "detector": detector_name,
        "total_samples": len(legacy_samples),
        "samples": legacy_samples,
        "subjects": subjects,
    }
    print(json.dumps(output))


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Usage: face-detect.py <video_path> [sample_interval]"}))
        sys.exit(1)
    video_path = sys.argv[1]
    interval = float(sys.argv[2]) if len(sys.argv) > 2 else 0.2
    detect_faces(video_path, interval)
