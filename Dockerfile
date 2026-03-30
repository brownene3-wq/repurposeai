FROM node:20-slim

# Install ffmpeg, python3, and yt-dlp (for video clipping)
# Force latest yt-dlp to keep up with YouTube API changes
RUN apt-get update && \
    apt-get install -y --no-install-recommends ffmpeg python3 python3-pip curl fonts-liberation && \
    pip3 install --break-system-packages --upgrade yt-dlp && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm ci --omit=dev

# Copy app source
COPY . .

# Railway sets PORT dynamically
# Update yt-dlp at startup to keep up with YouTube API changes
CMD pip3 install --break-system-packages --upgrade yt-dlp 2>/dev/null; node server.js
