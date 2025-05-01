FROM node:20

WORKDIR /app
COPY . .

RUN npm install -g pnpm && pnpm install --frozen-lockfile
RUN pnpm run build

EXPOSE 3001
CMD ["pnpm", "preview", "--port", "3001", "--host"]
