FROM node:20-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --production

COPY . .

RUN mkdir -p auth_info

EXPOSE 3002

CMD ["node", "index.js"]
