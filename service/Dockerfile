FROM node:24-alpine AS build
WORKDIR /app
COPY package*.json ./
COPY service/package.json service/package.json
COPY client/package.json client/package.json
RUN npm ci
COPY service service
RUN npm run build -w service

FROM node:24-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY package*.json ./
COPY service/package.json service/package.json
COPY client/package.json client/package.json
RUN npm ci --omit=dev --workspace service && npm cache clean --force
COPY --from=build /app/service/dist service/dist
COPY --from=build /app/service/src/db/migrations service/src/db/migrations
USER node
WORKDIR /app/service
EXPOSE 3000
CMD ["node","dist/index.js"]
