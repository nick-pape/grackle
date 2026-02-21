FROM node:22-slim

WORKDIR /app

# Install the sidecar
COPY packages/common/dist ./node_modules/@grackle/common/dist
COPY packages/common/package.json ./node_modules/@grackle/common/package.json
COPY packages/sidecar/dist ./dist
COPY packages/sidecar/package.json ./package.json

RUN npm install --omit=dev

EXPOSE 7433

CMD ["node", "dist/index.js"]
