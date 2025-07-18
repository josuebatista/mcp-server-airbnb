# Multi-stage build for production optimization
FROM node:lts-alpine AS builder

WORKDIR /app

# Copy package files and install all dependencies
COPY package*.json ./
RUN npm ci --ignore-scripts

# Copy source code and build
COPY . .
RUN npm run build

# Production stage
FROM node:lts-alpine AS production

# Set environment variables
ENV NODE_ENV=production
ENV PORT=3000
ENV MCP_MODE=http

# Create app directory and non-root user
WORKDIR /app
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

# Copy package files and install production dependencies
COPY package*.json ./
RUN npm ci --only=production --ignore-scripts && \
    npm cache clean --force

# Copy built application from builder stage
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./package.json

# Set ownership and permissions
RUN chown -R nodejs:nodejs /app
USER nodejs

# Expose the HTTP port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD node -e "const http = require('http'); \
    const req = http.request({hostname: 'localhost', port: 3000, path: '/health', method: 'GET'}, (res) => { \
      if (res.statusCode === 200) { console.log('OK'); process.exit(0); } \
      else { console.log('FAIL'); process.exit(1); } \
    }); \
    req.on('error', () => { console.log('ERROR'); process.exit(1); }); \
    req.end();"

# Start the server in HTTP mode
CMD ["node", "dist/index.js", "--http"]
