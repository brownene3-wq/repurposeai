FROM node:18-slim

# Install ffmpeg for video clipping
RUN apt-get update && apt-get install -y ffmpeg && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --production

# Copy app source
COPY . .

# Expose port
EXPOSE ${PORT:-3000}

# Start the server
CMD ["node", "server.js"]
