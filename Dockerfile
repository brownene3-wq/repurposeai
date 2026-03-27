FROM node:18-slim

# Install ffmpeg and curl (needed for video clipping)
RUN apt-get update && \
    apt-get install -y --no-install-recommends ffmpeg && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm ci --omit=dev

# Copy app source
COPY . .

# Railway sets PORT dynamically
CMD ["node", "server.js"]
