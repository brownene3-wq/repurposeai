FROM node:20-slim

# Install ffmpeg, python3, and yt-dlp (for video clipping)
RUN apt-get update && \
    apt-get install -y --no-install-recommends ffmpeg python3 python3-pip && \
    pip3 install --break-system-packages yt-dlp && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm ci --omit=dev

# Copy app source
COPY . .

# Railway sets PORT dynamically
CMD ["node", "server.js"]
