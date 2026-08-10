# Build: docker build -t imranrdev/cct26 .
# Push:  docker push imranrdev/cct26
#
# Usage:
#   docker run -d --name cct26 \
#     -p 3000:3000 \
#     -v ./data:/app/data \
#     -v ./.env:/app/.env \
#     imranrdev/cct26

FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm install --production

COPY . .

EXPOSE 3000

CMD ["node", "main.js"]
