FROM node:20-slim

# Install ffmpeg, python3, and yt-dlp (for video clipping)
# Force latest yt-dlp to keep up with YouTube API changes
#
# Font set: libass (the ASS subtitle renderer FFmpeg uses for caption burn-in)
# resolves font families through fontconfig. If the requested family isn't
# installed it silently falls back to a default sans, which made every Caption
# Style preset look identical on export. The font set below covers the UI
# choices via aliases mapped in routes/ai-captions.js (FONT_ALIAS):
#   - fonts-liberation  -> Arial / Helvetica / Times New Roman / Courier New / Georgia
#   - fonts-dejavu      -> Verdana
#   - Anton (downloaded from Google Fonts) -> Impact (free condensed sans
#     equivalent; the AI Captions page also @import-loads Anton in the browser
#     so the live preview and the burned-in export match)
#   - fonts-noto-core   -> broad Unicode coverage for non-Latin captions
#   - fonts-freefont-ttf-> additional fallback families
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        ffmpeg python3 python3-pip curl git libgl1-mesa-glx libglib2.0-0 \
        fonts-liberation fonts-dejavu fonts-dejavu-extra fonts-noto-core fonts-freefont-ttf fontconfig && \
    mkdir -p /usr/share/fonts/truetype/anton && \
    curl -fsSL "https://github.com/google/fonts/raw/main/ofl/anton/Anton-Regular.ttf" \
         -o /usr/share/fonts/truetype/anton/Anton-Regular.ttf && \
    fc-cache -f -v && \
    fc-list | grep -i anton || echo "WARN: Anton font not registered" && \
    pip3 install --break-system-packages --upgrade yt-dlp bgutil-ytdlp-pot-provider opencv-python-headless && \
    pip3 install --break-system-packages "mediapipe==0.10.9" && \
    rm -rf /var/lib/apt/lists/*

# Configure yt-dlp defaults for YouTube anti-bot measures
RUN mkdir -p /etc/yt-dlp && \
    echo '--geo-bypass' > /etc/yt-dlp/config && \
    echo '--no-check-certificates' >> /etc/yt-dlp/config

# Install bgutil PO token provider server (generates YouTube auth tokens)
RUN git clone --single-branch --depth 1 https://github.com/Brainicism/bgutil-ytdlp-pot-provider.git /opt/pot-provider && \
    cd /opt/pot-provider/server && \
    npm ci && \
    npx tsc

WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm install --omit=dev --no-audit --no-fund

# Copy app source
COPY . .

# Start PO token provider in background, verify plugin, then start the app
# yt-dlp upgrade output is now visible in Railway logs (was 2>/dev/null which
# silently hid failed pip upgrades — and a stale yt-dlp is the #1 cause of
# YouTube downloads breaking).
CMD echo "=== Upgrading yt-dlp at boot ===" ; \
    pip3 install --break-system-packages --upgrade yt-dlp bgutil-ytdlp-pot-provider 2>&1 | tail -8 || echo "yt-dlp upgrade failed — continuing with bundled version" ; \
    yt-dlp --version 2>&1 | head -1 ; \
    node /opt/pot-provider/server/build/main.js & \
    sleep 2 && \
    echo "=== yt-dlp plugin check ===" && \
    yt-dlp --list-extractors 2>&1 | grep -i "pot\|bgutil" || echo "No POT plugin found in extractors" && \
    echo "=== Starting server ===" && \
    node server.js
