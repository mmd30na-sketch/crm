# Carla CRM — production image for later Chabokan move.
# Listens on 0.0.0.0:3000 (Chabokan reverse proxy default).
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
RUN addgroup -S crm && adduser -S crm -G crm
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && mkdir -p uploads StudentFiles dist
COPY --from=build /app/dist ./dist
COPY --from=build /app/index.html ./index.html
RUN chown -R crm:crm /app
USER crm
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/server.cjs"]
