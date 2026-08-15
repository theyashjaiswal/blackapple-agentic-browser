FROM node:22-alpine

# Install Chromium + dependencies for Playwright
RUN apk add --no-cache \
    chromium \
    nss \
    freetype \
    harfbuzz \
    ca-certificates \
    ttf-freefont \
    udev

ENV PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium-browser
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
ENV BLACKAPPLE_HEADLESS=true

WORKDIR /app

# Copy package files
COPY packages/core/package.json packages/core/
COPY packages/api/package.json packages/api/
COPY package.json ./

# Install deps
RUN npm install --workspaces

# Copy source
COPY packages/ packages/
COPY tsconfig.base.json ./

# Build
RUN npm run build --workspaces

EXPOSE 3333

CMD ["node", "packages/api/dist/index.js"]
