# 아이온2 레기온 운영 디스코드 봇

아이온2 레기온(길드) 운영을 위한 디스코드 봇입니다.
빌드 공유, 일정 알림(텍스트 + 음성 TTS) + 참가신청(RSVP), 주사위, 달력,
강화/돌파 시뮬레이터 + 기대비용 계산기·몬테카를로 시뮬·명예의 전당까지
**총 20개의 슬래시 명령어**를 제공합니다.

---

## 공식 링크 / 정책

- **봇 초대하기**: `https://discord.com/oauth2/authorize?client_id=<CLIENT_ID>&permissions=3361792&scope=bot+applications.commands`
  > `<CLIENT_ID>` 는 [Discord Developer Portal](https://discord.com/developers/applications) → 본 봇의 **Application ID** 로 교체하세요.
- **이용약관**: [TERMS.md](./TERMS.md)
- **개인정보처리방침**: [PRIVACY.md](./PRIVACY.md)
- **문의 / 버그 제보**: https://github.com/TaeheeLim/aion2_bot/issues

### 권장 권한 (`permissions=3361792` 산출 내역)
| 권한 | 비트 | 용도 |
|---|---:|---|
| View Channels | 1024 | 기본 동작 |
| Send Messages | 2048 | 일정 알림 발송 |
| Embed Links | 16384 | 모든 응답이 임베드 형식 |
| Read Message History | 65536 | 상호작용 응답 안정성 |
| Mention @everyone, Here, All Roles | 131072 | `/일정등록` 의 역할 멘션 |
| Connect (Voice) | 1048576 | TTS 음성 채널 입장 |
| Speak (Voice) | 2097152 | TTS 발화 |

> 음성 알림(TTS) 을 사용하지 않을 경우 Voice 권한(`Connect`, `Speak`) 은 제거 가능합니다.
> 그 경우 권한 정수는 `3361792 - 1048576 - 2097152 = 216064`.

---

## 기능

### 🔧 빌드 공유
| 명령어 | 설명 |
|---|---|
| `/빌드등록` | 직업별 빌드 정보 등록 (직업명·빌드명·설명·주요스탯·스킬설명) |
| `/빌드검색` | 직업명 또는 키워드로 빌드 검색 (최대 10건) |
| `/빌드목록` | 등록된 빌드 목록 조회 (최신순, 최대 20건) |
| `/빌드삭제` | 본인 또는 관리자가 빌드 삭제 |

### 📅 레기온 일정 알림
| 명령어 | 설명 |
|---|---|
| `/일정등록` | 레기온 일정 등록 + 60/30/10/3분 전 자동 알림 + 음성채널 TTS 옵션 + **참가/불참/보류 버튼(RSVP)** |
| `/일정목록` | 앞으로 예정된 일정 목록 (날짜순) |
| `/오늘일정` | 오늘 예정된 일정만 (KST 기준) |
| `/일정삭제` | 본인 또는 관리자가 일정 삭제 |
| `/참여율` | 멤버별 참가 신청 기준 참여율 랭킹 (출석 통계) |
| `/달력` | 월간 ANSI 컬러 달력 + 일정 마커 + 최근 등록순 리스트 |

> 일정 알림은 매 분 cron 폴링으로 발사되며, 텍스트 임베드 + (설정 시) 음성 채널 TTS 가 함께 나갑니다. 알림 시점이 임박할수록 임베드 색상이 노랑→주황→빨강으로 변합니다.
> **RSVP**: `/일정등록` 응답과 알림 메시지에 참가/불참/보류 버튼이 붙어, 누가 올지 실시간 집계됩니다. 같은 사람이 다시 누르면 응답이 갱신됩니다. 누적 참여율은 `/참여율` 로 확인합니다.
> 종료된 지 7일 지난 일정은 자동 정리되어 DB/알림 폴링이 가벼운 상태로 유지됩니다.

### 🎲 미니 도구
| 명령어 | 설명 |
|---|---|
| `/주사위 최대값:N` | 1 ~ N 사이의 정수 랜덤 출력 (2 ≤ N ≤ 1,000,000) |
| `/tts테스트` | 봇이 음성 채널에서 TTS 가 정상 재생되는지 진단 (관리자 디버그용) |

### ⚒️ 강화/돌파 시뮬레이터 (아이온강화.xlsx 기반)
| 명령어 | 설명 |
|---|---|
| `/장비생성 종류:<영웅\|전념의룬> 이름:...` | 강화 1강 / 돌파 0 상태로 새 장비 생성 (사용자당 **최대 10개**) |
| `/장비목록` | 내 인벤토리 + 사용자 전체 누적 사용량 (ephemeral) |
| `/장비삭제 장비id:N` | 본인 소유 장비 삭제 (파괴된 장비 포함) |
| `/강화 장비id:N` | 현재 등급 기준 확률·비용 적용 후 결과 출력 |
| `/돌파 장비id:N` | 영웅 강화 20강 도달 후 돌파 시도 (영웅 전용) |

### 📈 강화 분석 도구 & 랭킹
| 명령어 | 설명 |
|---|---|
| `/강화계산 종류:<영웅\|전념의룬> 목표강화:N [목표돌파:M]` | 1강/돌파0부터 목표까지 **기대(평균) 시도·키나·재료** 계산. 영웅 보정 누적 반영. 전념의룬은 도달 확률로 안내 |
| `/강화시뮬 종류:... 목표강화:N [목표돌파:M] [횟수:T]` | 몬테카를로 시뮬(기본 1만, 최대 10만회)로 **최선/중앙값/상위5%/최악** 비용 분포 + (룬) 파괴율·도달률 |
| `/강화랭킹` | 서버 명예의 전당 — 키나왕 · 최강 장비 · 파괴왕(불운왕) · 20강/돌파5/룬10강 달성 현황 |

> `/강화계산` 은 해석적 기댓값(즉시·결정론적), `/강화시뮬` 은 실제 메커니즘을 N회 굴린 분포입니다. 두 결과의 평균은 서로 수렴합니다. 전념의룬은 실패 시 파괴되므로 기대비용 대신 **도달 확률·파괴율**을 봅니다.

**규칙 요약:**
- **영웅**: 강화 1 → 20 → 돌파 0 → 5. 실패 시 보정 누적(+5%p, 돌파는 단계별 5/4/3/2/1%p), **파괴 없음·재시도 가능**. 성공 시 보정 0으로 리셋.
- **전념의룬**: 강화 1 → 10. **실패 시 즉시 파괴**, 보정 시스템 없음.
- 적용 확률 = `min(100, 기본확률 + 실패횟수 × 보정값)`. 응답 임베드에 시도(현재 → 목표) / 적용 확률 / 결과 / 누적 보정이 모두 표시됩니다.
- 데이터 위치: [src/data/enhanceData.js](src/data/enhanceData.js) (엑셀 갱신 시 수동 동기화)

> 데이터 격리: 모든 데이터는 **서버(Guild) 단위 격리**, 장비는 **서버 × 사용자 단위 격리**. 다른 디스코드 서버끼리 데이터 누출 없음.

---

## 설치 및 실행

### 🅰️ 로컬 실행 (개발용)

#### 1. 의존성 설치
```bash
npm install
```
> Node.js **22.12.0 이상** 필요 (`@discordjs/voice` 요구사항).

#### 2. 환경변수 설정
```bash
# 프로젝트 루트에 .env 작성
DISCORD_TOKEN=your_bot_token_here
CLIENT_ID=your_application_id_here
# GUILD_ID=...   # 개발 서버에만 즉시 등록할 때만 (글로벌 등록은 비워둠)
```

#### 3. 슬래시 명령어 등록 (최초 1회 또는 명령어 변경 시)
```bash
npm run deploy
```

#### 4. 봇 실행
```bash
npm start

# 개발 중 (파일 변경 시 자동 재시작)
npm run dev
```

---

### 🅱️ Docker 배포 (운영용, 권장)

#### B-1) 서버에서 직접 빌드 — git pull → build
```bash
git clone https://github.com/TaeheeLim/aion2_bot.git && cd aion2_bot
cat > .env <<EOF
DISCORD_TOKEN=...
CLIENT_ID=...
EOF

# 슬래시 명령어 등록 (최초 1회)
docker compose run --rm aion-bot node src/deploy-commands.js

# 기동 / 업데이트
docker compose up -d --build
docker compose logs -f aion-bot
```

#### B-2) 로컬 빌드 → GHCR(GitHub Container Registry) 경유 (권장)
```bash
# 로컬: 빌드 + 푸시
echo $GHCR_PAT | docker login ghcr.io -u TaeheeLim --password-stdin
docker compose build
docker tag aion-bot:latest ghcr.io/taeheelim/aion-bot:latest
docker push ghcr.io/taeheelim/aion-bot:latest

# 서버: .env + docker-compose.prod.yml 두 파일만 있으면 됨
mkdir -p ~/aion-bot && cd ~/aion-bot
# (.env, docker-compose.prod.yml 업로드)

docker compose -f docker-compose.prod.yml run --rm aion-bot node src/deploy-commands.js
docker compose -f docker-compose.prod.yml up -d
```

> 최초 푸시 후 GitHub Packages 페이지에서 `aion-bot` 을 **Public** 으로 전환하면 서버에서 별도 로그인 없이 pull 가능.

#### 운영 명령
```bash
# 로그 추적 (실시간)
docker compose -f docker-compose.prod.yml logs -f

# 최근 200줄
docker compose -f docker-compose.prod.yml logs --tail=200

# 파일로 추출 (이슈 분석/공유용)
docker compose -f docker-compose.prod.yml logs --since 24h --no-color > debug.log

# 일시 정지 / 재기동
docker compose -f docker-compose.prod.yml stop
docker compose -f docker-compose.prod.yml start

# 업데이트 (GHCR 사용 시)
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d

# DB 백업 (named volume tar 추출)
docker run --rm \
  -v aion-bot_aion-data:/d \
  -v $(pwd):/backup \
  alpine tar czf /backup/aion-data-$(date +%F).tgz -C /d .
```

> `down` 명령 시 컨테이너가 삭제되며 그 컨테이너의 로그도 함께 사라집니다. 업데이트 전엔 `logs --no-color > file.log` 로 보존하세요.

---

## Discord Developer Portal 설정

1. https://discord.com/developers/applications 접속
2. **New Application** 생성
3. **Bot** 탭 → Token 복사 → `.env` 의 `DISCORD_TOKEN`
4. **General Information** → Application ID 복사 → `.env` 의 `CLIENT_ID`
5. **Bot** 탭 → Privileged Gateway Intents → **모두 OFF 가능** (현재 코드는 비특권 인텐트만 사용: `Guilds`, `GuildVoiceStates`)
6. **OAuth2** → URL Generator
   - **Scopes**: `bot` + `applications.commands`
   - **Bot Permissions**:
     - 텍스트 채널: `Send Messages`, `Embed Links`, `Mention Everyone`
     - 음성 채널 (TTS 사용 시): `View Channel`, `Connect`, `Speak`
7. 생성된 URL 로 봇을 서버에 초대

---

## 기술 스택

- **Runtime**: Node.js **22.12.0+** (engines 강제)
- **Discord**: discord.js v14
- **음성**: @discordjs/voice + @discordjs/opus + libsodium-wrappers + ffmpeg-static (시스템 ffmpeg 불필요)
- **TTS**: google-tts-api (Google TTS 비공식 wrapper, 한국어)
- **Database**: better-sqlite3 (SQLite, WAL 모드)
- **Scheduler**: node-cron (1분 간격, KST timezone)
- **Time**: date-fns + date-fns-tz (KST 변환·검증)
- **Config**: dotenv
- **Container**: Docker / Compose (Node 22-slim multi-stage, tini PID 1, named volume)

---

## 폴더 구조

```
discord_aion_bot/
├── aion_bot.db                 # 로컬 실행 시 SQLite 파일 (Docker 사용 시 named volume)
├── Dockerfile                  # Node 22-slim multi-stage
├── docker-compose.yml          # 개발/빌드용 (build: 포함)
├── docker-compose.prod.yml     # 서버용 (pull 만 사용, named volume)
├── .dockerignore
├── package.json
├── README.md
├── context.md                  # 운영 컨텍스트 문서 (스키마·트러블슈팅·배포 절차)
├── schema.png                  # DB 스키마 다이어그램 이미지
└── src/
    ├── index.js                # 봇 진입점 (Discord client + interaction routing)
    ├── deploy-commands.js      # 슬래시 명령어 Discord API 등록 스크립트
    ├── database.js             # SQLite 초기화 + 마이그레이션 (DB_PATH env 지원)
    ├── commands/
    │   ├── build.js            # /빌드등록 /빌드검색 /빌드목록 /빌드삭제
    │   ├── schedule.js         # /일정등록 /일정목록 /오늘일정 /일정삭제 (+ RSVP 버튼 부착)
    │   ├── tts.js              # /tts테스트
    │   ├── dice.js             # /주사위
    │   ├── calendar.js         # /달력 (ANSI 컬러 월간 달력)
    │   ├── inventory.js        # /장비생성 /장비목록 /장비삭제 /강화 /돌파
    │   ├── enhanceCalc.js      # /강화계산 /강화시뮬 (기대비용·몬테카를로)
    │   ├── ranking.js          # /강화랭킹 (명예의 전당)
    │   └── rsvp.js             # /참여율 + 참가 버튼 핸들러·헬퍼
    ├── data/
    │   └── enhanceData.js      # 강화/돌파 확률·비용 테이블 + EV/시뮬 헬퍼 (엑셀 추출)
    ├── services/
    │   └── scheduleChecker.js  # node-cron 1분 폴러 → 알림 발송 (텍스트 + TTS)
    └── utils/
        ├── dateUtils.js        # KST ↔ UTC 변환, 월간 범위, 유효성 검사
        └── ttsPlayer.js        # 음성 채널 입장 → google-tts MP3 → 재생 → 퇴장
```

---

## DB 스키마

4개 테이블 — `builds`, `schedules`, `inventory`, `schedule_rsvp`. 모든 테이블이 `guild_id` 로 서버 단위 격리.
자세한 컬럼·관계는 [schema.png](schema.png) 또는 [context.md §5](context.md) 참고.

| 테이블 | 용도 | 격리 단위 |
|---|---|---|
| `builds` | 빌드 공유 | 서버별 |
| `schedules` | 레기온 일정 + 자동 알림 | 서버별 |
| `inventory` | 강화/돌파 시뮬레이터 장비 | 서버 × 사용자별 |
| `schedule_rsvp` | 일정 참가신청(참가/불참/보류) | 일정 × 사용자별 |

> 성능 인덱스: `inventory(guild_id,user_id)`, `schedules(scheduled_at)`, `builds(guild_id,created_at)`, `schedule_rsvp(guild_id,user_id)` — 데이터 증가 시 풀스캔을 방지. 봇 기동 시 멱등 마이그레이션으로 자동 생성.

---

## 라이선스

ISC

## 저장소

https://github.com/TaeheeLim/aion2_bot

---

> 운영·트러블슈팅 가이드는 [context.md](context.md) 참고.
