#!/bin/bash
# Download static ffmpeg binary for Linux x64
# Used during npm postinstall on Railway/production

set -e

FFMPEG_DIR="$(dirname "$0")/../bin"
FFMPEG_PATH="$FFMPEG_DIR/ffmpeg"

# Skip if already installed or if running on a system that has ffmpeg
if [ -f "$FFMPEG_PATH" ]; then
  echo "ffmpeg already installed at $FFMPEG_PATH"
  exit 0
fi

if command -v ffmpeg &> /dev/null; then
  echo "System ffmpeg found, skipping download"
  exit 0
fi

echo "Downloading static ffmpeg binary..."
mkdir -p "$FFMPEG_DIR"

# Download from johnvansickle's static builds (widely used, reliable)
curl -L -o /tmp/ffmpeg-release.tar.xz \
  "https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz" 2>/dev/null || {
  echo "Primary download failed, trying backup..."
  curl -L -o /tmp/ffmpeg-release.tar.xz \
    "https://johnvansickle.com/ffmpeg/builds/ffmpeg-git-amd64-static.tar.xz" 2>/dev/null || {
    echo "WARNING: Could not download ffmpeg. Clip feature will be disabled."
    exit 0
  }
}

# Extract just the ffmpeg binary
cd /tmp
tar xf ffmpeg-release.tar.xz
cp /tmp/ffmpeg-*-static/ffmpeg "$FFMPEG_PATH"
chmod +x "$FFMPEG_PATH"
rm -rf /tmp/ffmpeg-*

echo "ffmpeg installed successfully at $FFMPEG_PATH"
