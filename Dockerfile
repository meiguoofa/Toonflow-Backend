FROM node:20-bookworm-slim

WORKDIR /app

# 国内网络可选:使用 npm 镜像加速
RUN npm config set registry https://registry.npmmirror.com/

# 先装依赖(含 devDeps,因为 migrate/seed/启动都用 ts-node 直接跑 .ts)
COPY package.json ./
RUN npm install --no-audit --no-fund && npm cache clean --force

COPY . .

ENV NODE_ENV=production
ENV PORT=4000

EXPOSE 4000

# 默认:先跑 migration(幂等),再用 ts-node 启动服务
CMD ["sh", "-c", "npm run migrate && npx ts-node --transpile-only src/index.ts"]
