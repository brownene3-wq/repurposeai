FROM node:20-slim

# Install ffmpeg, python3, and yt-dlp (for video clipping)
# Force latest yt-dlp to keep up with YouTube API changes
RUN apt-get update && \
    apt-get install -y --no-install-recommends ffmpeg python3 python3-pip curl fonts-liberation git && \
    pip3 install --break-system-packages --upgrade yt-dlp bgutil-ytdlp-pot-provider && \
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
RUN npm ci --omit=dev

# Copy app source
COPY . .

# Start PO token provider in background, verify plugin, then start the app
CMD pip3 install --break-system-packages --upgrade yt-dlp bgutil-ytdlp-pot-provider 2>/dev/null; \
    node /opt/pot-provider/server/build/main.js & \
    sleep 2 && \
    echo "=== yt-dlp plugin check ===" && \
    yt-dlp --list-extractors 2>&1 | grep -i "pot\|bgutil" || echo "No POT plugin found in extractors" && \
    yt-dlp -v --skip-download --js-runtimes node --extractor-args "youtube:player_client=web_creator" --extractor-args "youtubepot-bgutilhttp:base_url=http://127.0.0.1:4416" "https://www.youtube.com/watch?v=jNQXAC9IVRw" 2>&1 | tail -30 || echo "Plugin test done" && \
    echo "=== Starting server ===" && \
    node server.js
