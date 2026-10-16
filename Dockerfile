FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json ./
# npm install, not ci: the lockfile is written on macOS and sharp needs its linux binary
RUN npm install --include=dev --no-audit --no-fund
COPY . .
RUN npx vite build && npm prune --omit=dev
ENV NODE_ENV=production DATA_DIR=/data PORT=8080
EXPOSE 8080
CMD ["node", "server/index.js"]
