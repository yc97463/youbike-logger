# =========== 第一階段：編譯 (Builder) ===========
FROM node:20-alpine AS builder

WORKDIR /app

# 1. 安裝依賴
COPY package*.json ./
RUN npm install

# 2. 複製原始碼 (包含 index.ts, tsconfig.json)
COPY . .

# 3. 編譯 TypeScript -> JavaScript (產出到 dist 資料夾)
RUN npm run build

# 4. 清除開發依賴 (縮小體積)
RUN npm prune --production

# =========== 第二階段：執行 (Runner) ===========
FROM node:20-alpine

WORKDIR /app

# 設定時區為台北 (方便你看 Log 時間)
RUN apk add --no-cache tzdata
ENV TZ=Asia/Taipei

# 1. 從 Builder 階段只複製必要的執行檔案
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./

# 2. 啟動指令：無限迴圈 (Loop)
# - 執行 node dist/index.js
# - 休息 60 秒
# - 重複
CMD ["sh", "-c", "while true; do echo '⏰ [Job] Starting fetch...'; node dist/index.js; echo '💤 [Job] Sleeping for 60s...'; sleep 60; done"]