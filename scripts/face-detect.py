#!/usr/bin/env python3
"""
Face detection script for AI Reframe.
Analyzes a video and outputs face position data as JSON.
Uses OpenCV's Haar Cascade for fast, reliable face detection.
"""
import sys
import json
import cv2
import os

def detect_faces(video_path, sample_interval=0.5):
    """
    Detect faces in video at regular intervals.
    Returns list of {time, faces: [{x, y, w, h}]} entries.
    """
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        print(json.dumps({"error": "Cannot open video"}))
        sys.exit(1)

    fps = cap.get(cv2.CAP_PROP_FPS) or 30
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    duration = total_frames / fps if fps > 0 else 0

    # Load face cascade
    cascade_path = os.path.join(cv2.data.haarcascades, 'haarcascade_frontalface_default.xml')
    face_cascade = cv2.CascadeClassifier(cascade_path)

    # Also load profile face for better detection
    profile_path = os.path.join(cv2.data.haarcascades, 'haarcascade_profileface.xml')
    profile_cascade = cv2.CascadeClassifier(profile_path)

    results = []
    frame_interval = int(fps * sample_interval)
    if frame_interval < 1:
        frame_interval = 1

    frame_idx = 0
    while True:
        ret, frame = cap.read()
        if not ret:
            break

        if frame_idx % frame_interval == 0:
            timestamp = frame_idx / fps

            # Convert to grayscale for detection
            gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
            gray = cv2.equalizeHist(gray)

            # Detect frontal faces
            faces = face_cascade.detectMultiScale(
                gray,
                scaleFactor=1.1,
                minNeighbors=5,
                minSize=(int(width * 0.05), int(height * 0.05)),
                flags=cv2.CASCADE_SCALE_IMAGE
            )

            # If no frontal faces, try profile
            if len(faces) == 0:
                faces = profile_cascade.detectMultiScale(
                    gray,
                    scaleFactor=1.1,
                    minNeighbors=5,
                    minSize=(int(width * 0.05), int(height * 0.05)),
                    flags=cv2.CASCADE_SCALE_IMAGE
                )

            face_list = []
            for (fx, fy, fw, fh) in faces:
                face_list.append({
                    "x": int(fx),
                    "y": int(fy),
                    "w": int(fw),
                    "h": int(fh),
                    # Center of face as percentage of frame
                    "cx": round((fx + fw / 2) / width, 4),
                    "cy": round((fy + fh / 2) / height, 4)
                })

            results.append({
                "time": round(timestamp, 3),
                "frame": frame_idx,
                "faces": face_list
            })

        frame_idx += 1

    cap.release()

    output = {
        "width": width,
        "height": height,
        "fps": round(fps, 2),
        "duration": round(duration, 2),
        "total_samples": len(results),
        "samples": results
    }

    print(json.dumps(output))

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Usage: face-detect.py <video_path> [sample_interval]"}))
        sys.exit(1)

    video_path = sys.argv[1]
    interval = float(sys.argv[2]) if len(sys.argv) > 2 else 0.5

    detect_faces(video_path, interval)
