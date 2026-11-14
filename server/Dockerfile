# build จากโฟลเดอร์หลักของโปรเจกต์ (docker-compose.yml ตั้ง context: . ไว้แล้ว)
FROM node:22-alpine

WORKDIR /app/server

COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev

COPY server/server.js ./
COPY public/ /app/public/

ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "server.js"]
