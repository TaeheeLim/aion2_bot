# syntax=docker/dockerfile:1.6
# ──────────────────────────────────────────────────────────────
# 아이온2 디스코드 봇 — Dockerfile (multi-stage)
#
# 이 봇은 네이티브 모듈을 포함합니다:
#   - better-sqlite3 : SQLite 바인딩 (C++ 컴파일 필요할 수 있음)
#   - @discordjs/opus / libsodium-wrappers : 음성 인코딩
#   - ffmpeg-static  : ffmpeg 바이너리 동봉 (시스템 ffmpeg 불필요)
#
# Node 의 ABI 가 builder/runtime 단계에서 같아야 하므로 동일 베이스 이미지 사용.
# ──────────────────────────────────────────────────────────────

# ---------- 1) builder: 의존성 설치 (네이티브 컴파일 포함) ----------
FROM node:22-slim AS builder

WORKDIR /app

# better-sqlite3 / opus 빌드용 도구 (prebuilt 다운로드 실패 시 fallback)
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# package*.json 만 먼저 복사 → 캐시 최대화
COPY package.json package-lock.json ./
# npm ci 는 lock 완벽 일치를 강요해 옵셔널 transitive deps(emnapi 등) 누락 시 실패한다.
# npm install --omit=dev 는 lock 을 참고하면서도 부족분을 보완하므로 더 견고.
RUN npm install --omit=dev --no-audit --no-fund


# ---------- 2) runtime: 슬림 이미지 ----------
FROM node:22-slim AS runtime

WORKDIR /app

# tini : PID 1 시그널 처리 (Ctrl+C, docker stop 깔끔하게)
RUN apt-get update \
 && apt-get install -y --no-install-recommends tini \
 && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    TZ=Asia/Seoul \
    DB_PATH=/app/data/aion_bot.db

# builder 에서 컴파일된 node_modules 복사
COPY --from=builder /app/node_modules ./node_modules

# 소스 복사 (.dockerignore 가 불필요 파일 제외)
COPY package.json package-lock.json ./
COPY src ./src

# 데이터 디렉토리 (볼륨 마운트 포인트). 미마운트 시에도 컨테이너 내부에 존재해야 함.
RUN mkdir -p /app/data && chown -R node:node /app

USER node

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "src/index.js"]
