# The production image: Node.js 26 LTS (Debian slim, glibc, so sharp's prebuilt binary matches), dependencies without
# dev dependencies, production mode, and the app as the image's unprivileged node user. The database is created and
# seeded on the first start, which needs no dev dependency. One volume holds all data: /app/storage.
FROM node:26-slim

WORKDIR /app
ENV NODE_ENV=production APP_HOST=0.0.0.0 DATA_DIR=/app/storage

# .npmrc: engine-strict and ignore-scripts (sharp installs its prebuilt linux-x64 package without a build step)
COPY package.json package-lock.json .npmrc ./
RUN npm ci --omit=dev && npm cache clean --force

# The app, its views, shared/ (the client modules, definitions and seed) and public/ (the built CSS)
COPY app.js server.js config.js db.js seed.js auth.js pages.js surveyjs-integration.json settings.env ./
COPY routes ./routes
COPY relay ./relay
COPY integration ./integration
COPY demo ./demo
COPY views ./views
COPY shared ./shared
COPY public ./public
RUN mkdir -p /app/storage && chown node:node /app/storage

USER node
EXPOSE 8000
VOLUME ["/app/storage"]
# node, not npm start: npm doesn't pass SIGTERM on, so `docker stop` would wait and kill
CMD ["node", "--env-file=settings.env", "server.js"]
