# Backend — Node + Fastify
FROM node:20-alpine

# ffmpeg: converte o áudio gravado no navegador (webm/opus) para ogg/opus (aceito pela Meta).
RUN apk add --no-cache ffmpeg

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

EXPOSE 3000
CMD ["npm", "start"]
