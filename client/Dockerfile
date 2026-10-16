FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY service/package.json ./service/package.json
COPY client/package.json ./client/package.json
RUN npm ci --workspace client --no-audit --no-fund
COPY client/tsconfig.json ./client/tsconfig.json
COPY client/src ./client/src
RUN npm run build --workspace client

FROM node:24-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/client/dist ./dist
USER node
ENTRYPOINT ["node", "dist/index.js"]
CMD ["help"]
