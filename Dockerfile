# Use a minimal Node runtime
FROM node:18-alpine

# Create app directory
WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci --only=production

# Copy source
COPY . .

# Environment and port expected by Fly
ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

# Run the WebSocket server (HTTP server on same port will serve /health)
CMD ["node", "server/ws-server.js"]

