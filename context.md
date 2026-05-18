# 아이온2 레기온 디스코드 봇 — Context

> 본 문서는 **아이온2(AION 2) 레기온(길드) 운영 디스코드 봇**의 소스코드 분석을 바탕으로 작성된 운영/개발 컨텍스트 문서입니다.
> 신규 개발자 온보딩, 실서비스 배포 점검, 운영 인계 시 참고용으로 사용합니다.

---

## 1. 프로젝트 개요

- **목적**: 아이온2 게임 레기온(길드) 운영 보조 — 빌드 정보 공유와 정기/일회성 일정의 자동 알림(텍스트 + 음성 TTS).
- **사용자**: 디스코드 서버에 초대된 레기온 멤버. 등록/삭제는 본인 또는 서버 관리자(`Administrator` 권한) 한정.
- **배포 형태**: 단일 Node.js 프로세스(상시 구동). 데이터는 로컬 SQLite 파일에 저장.
- **언어/지역화**: UI·명령어 전부 한국어. 시간대는 KST(`Asia/Seoul`) 고정.

## 2. 기술 스택

| 분류 | 항목 | 비고 |
|---|---|---|
| Runtime | Node.js **>= 18** | `package.json#engines` 강제 |
| 모듈 시스템 | CommonJS | `"type": "commonjs"` |
| Discord | `discord.js` v14 | 슬래시 명령어 기반 |
| 음성 | `@discordjs/voice`, `@discordjs/opus`, `libsodium-wrappers`, `ffmpeg-static` | TTS 재생용 |
| TTS | `google-tts-api` | 한국어(`lang: 'ko'`) MP3 합성 |
| DB | `better-sqlite3` | 동기식, 단일 파일(`aion_bot.db`) |
| 시간 | `date-fns`, `date-fns-tz` | KST 변환 |
| 스케줄러 | `node-cron` | 1분 주기 |
| 설정 | `dotenv` | `.env` 로딩 |

## 3. 폴더 구조

```
discord_aion_bot/
├── aion_bot.db            # 런타임 생성 SQLite 파일 (gitignore)
├── package.json
├── README.md
└── src/
    ├── index.js               # 봇 진입점 (클라이언트 생성, 이벤트 라우팅)
    ├── deploy-commands.js     # 슬래시 명령어 Discord API 등록 스크립트
    ├── database.js            # SQLite 초기화 + 마이그레이션
    ├── commands/
    │   ├── build.js           # /빌드등록 /빌드검색 /빌드목록 /빌드삭제
    │   ├── schedule.js        # /일정등록 /일정목록 /오늘일정 /일정삭제
    │   ├── tts.js             # /tts테스트 (운영 진단용)
    │   ├── dice.js            # /주사위 (1~N 랜덤)
    │   ├── calendar.js        # /달력 (월간 ASCII 달력)
    │   └── inventory.js       # /장비생성 /장비목록 /장비삭제 /강화 /돌파
    ├── data/
    │   └── enhanceData.js     # 아이온강화.xlsx 추출 데이터 + 룩업 헬퍼
    ├── services/
    │   └── scheduleChecker.js # node-cron 1분 폴러 → 알림 발송
    └── utils/
        ├── dateUtils.js       # KST ↔ UTC 변환, 월간 범위, 유효성 검사
        └── ttsPlayer.js       # 음성 채널 입장 → TTS 재생 → 퇴장
```

## 4. 아키텍처 한눈에 보기

```
            ┌─────────────────────────────┐
Discord ───►│  index.js (Events.Interaction)│
            └────┬─────────┬──────────┬────┘
                 ▼         ▼          ▼
            build.js  schedule.js  tts.js     ─── 슬래시 명령어 핸들러
                 │         │          │
                 └────┬────┴──────────┘
                      ▼
                  database.js (SQLite, WAL)
                      ▲
                      │ 1분마다 폴링
            ┌─────────┴─────────────┐
            │  scheduleChecker.js   │ node-cron '* * * * *'
            │ - 60/30/10/3분 전 체크 │
            │ - 텍스트 알림 + TTS    │
            └─────────┬─────────────┘
                      ▼
                  ttsPlayer.js
                  (voice join → mp3 → leave)
```

## 5. 데이터 모델 (SQLite)

DB 파일: `<프로젝트루트>/aion_bot.db` (WAL 모드, foreign_keys ON).
초기화 위치: [src/database.js](src/database.js).

### 5.1 `builds` — 빌드 공유

| 컬럼 | 타입 | 설명 |
|---|---|---|
| id | INTEGER PK AUTOINC | 빌드 ID |
| guild_id | TEXT NOT NULL | 디스코드 서버 ID (서버별 격리) |
| job_name | TEXT NOT NULL | 직업명 (예: 수호성) |
| build_name | TEXT NOT NULL | 빌드명 (예: 탱킹70딜30) |
| description | TEXT | 설명 |
| stats | TEXT | 주요 스탯 |
| skills | TEXT | 스킬/특성 |
| author_id | TEXT NOT NULL | 작성자 Discord User ID |
| created_at / updated_at | TEXT | `datetime('now','localtime')` 기본값 |

### 5.2 `inventory` — 강화/돌파 시뮬레이터 장비

| 컬럼 | 타입 | 설명 |
|---|---|---|
| id | INTEGER PK | 장비 ID |
| guild_id | TEXT | 서버 ID (서버별 격리) |
| user_id | TEXT | 소유자 Discord User ID |
| item_name | TEXT | 사용자 지정 이름 (최대 30자) |
| item_type | TEXT | `'영웅'` \| `'전념의룬'` |
| enhance_level | INTEGER | 현재 강화 등급 (기본 1) |
| breakthrough_level | INTEGER | 현재 돌파 등급 (기본 0, 전념의룬은 미사용) |
| enhance_fail_streak | INTEGER | 영웅 강화 연속 실패 횟수 (보정 누적용) |
| breakthrough_fail_streak | INTEGER | 영웅 돌파 연속 실패 횟수 |
| destroyed | INTEGER 0/1 | 1이면 더 이상 강화/돌파 불가 |
| destroyed_reason | TEXT | 파괴 사유 (예: `"강화 5 → 6 실패"`) |
| total_kinah_used | INTEGER | 누적 소모 키나 |
| total_enhance_stones_used | INTEGER | 누적 소모 강화석 |
| total_breakthrough_stones_used | INTEGER | 누적 소모 돌파석 |
| created_at / updated_at | TEXT | 타임스탬프 |

> 강화/돌파 확률·비용 데이터는 DB가 아니라 [src/data/enhanceData.js](src/data/enhanceData.js) 에 하드코딩 (엑셀 원본은 사용자 데스크톱). 데이터 수정 시 이 파일 직접 편집.

### 5.3 `schedules` — 레기온 일정

| 컬럼 | 타입 | 설명 |
|---|---|---|
| id | INTEGER PK AUTOINC | 일정 ID |
| guild_id | TEXT NOT NULL | 서버 ID |
| title | TEXT NOT NULL | 일정 제목 |
| scheduled_at | TEXT NOT NULL | **UTC ISO 문자열** (KST 입력을 변환 저장) |
| description | TEXT | 설명 |
| channel_id | TEXT NOT NULL | 텍스트 알림 채널 |
| role_id | TEXT | 멘션할 역할 (선택) |
| voice_channel_id | TEXT | TTS 재생용 음성 채널 (선택, 마이그레이션으로 추가) |
| notify_60 / 30 / 10 / 3 | INTEGER 0/1 | 알림 사용 여부 (3분은 마이그레이션으로 추가) |
| notified_60 / 30 / 10 / 3 | INTEGER 0/1 | **이미 발송했는지** — 중복 발송 방지 플래그 |
| author_id | TEXT NOT NULL | 등록자 |
| created_at / updated_at | TEXT | 타임스탬프 |

> **마이그레이션 방식**: [src/database.js:69-76](src/database.js:69) — `ALTER TABLE ... ADD COLUMN` 을 try/catch 로 감싸 멱등 적용. 새 컬럼을 추가할 때 같은 패턴 유지.

> **중요**: `scheduled_at` 은 항상 UTC ISO. 비교/표시는 `dateUtils` 의 `parseKST` / `formatKST` 를 통해야 한다. 직접 문자열 비교 금지.

## 6. 슬래시 명령어 명세

라우팅: `index.js` 의 `InteractionCreate` 이벤트에서 각 핸들러를 순차 시도. 핸들러는 자신이 처리할 명령어이면 `true` 를 반환 (체인 오브 리스폰서빌리티).

순서: build → schedule → tts → dice → calendar → inventory.

### 6.1 빌드 (`commands/build.js`)
| 명령어 | 옵션 | 동작 | 응답 형태 |
|---|---|---|---|
| `/빌드등록` | 직업명*, 빌드명*, 설명, 주요스탯, 스킬설명 | INSERT | Embed (공개) |
| `/빌드검색` | 키워드* | `job_name/build_name/description LIKE %키워드%`, 최신 10건 | Embed × N (공개) |
| `/빌드목록` | — | 최신 20건 요약 리스트 | Embed (공개) |
| `/빌드삭제` | 빌드id* | 본인 or 관리자만 | ephemeral |

### 6.2 일정 (`commands/schedule.js`)
| 명령어 | 옵션 | 동작 |
|---|---|---|
| `/일정등록` | 제목*, 날짜*(`YYYY-MM-DD` 또는 `오늘`), 시간*(`HH:mm`), 알림채널*, 설명, 멘션역할, 60/30/10/3분전알림(boolean), 음성채널 | INSERT 후 Embed로 확인. 알림 1개 이상 필수, 과거 시간 거부. |
| `/일정목록` | — | `scheduled_at > now` 오름차순, 최대 15건 조회 (Embed 10개 노출) |
| `/오늘일정` | — | KST 오늘 00:00\~23:59 범위 |
| `/일정삭제` | 일정id* | 본인 or 관리자만 |

> 입력 검증: `isValidDate` (`YYYY-MM-DD` 정규식 + parseISO), `isValidTime` (`HH:mm` 정규식). KST 입력 → `fromZonedTime` 으로 UTC 변환 저장.

### 6.3 TTS 진단 (`commands/tts.js`)
| 명령어 | 옵션 | 동작 |
|---|---|---|
| `/tts테스트` | 텍스트, 음성채널 (모두 옵션) | 봇 권한(ViewChannel/Connect/Speak) 점검 후 `playTTSInChannel` 호출. 운영 중 TTS 무음 문제 진단용. |

### 6.4 주사위 (`commands/dice.js`)
| 명령어 | 옵션 | 동작 |
|---|---|---|
| `/주사위 최대값:N` | 최대값* (정수 2~1,000,000) | 1 ~ N 사이의 정수 랜덤 출력. `Math.floor(Math.random()*N)+1`. 공개 응답. |

### 6.5 달력 (`commands/calendar.js`)
| 명령어 | 옵션 | 동작 |
|---|---|---|
| `/달력` | 연도(2024~2099), 월(1~12) — 모두 옵션, 기본은 현재 KST | 월간 ASCII 달력을 Embed 코드 블록으로 출력. 일정 있는 날은 `[N]` 표시. 하단에 해당 월 일정 목록(최대 15건) 표시. |

> 렌더링: `renderAsciiCalendar(year, month, markedDays)` — 각 셀 4글자 폭(` NN ` 또는 `[NN]`). 한글 요일 헤더는 ` 일 ` 처럼 양옆 공백으로 4글자 폭 맞춤. Discord 모노스페이스에서 한글이 2칸을 차지하므로 폭 보정이 필요하다.

### 6.6 강화 시뮬레이터 (`commands/inventory.js`)
| 명령어 | 옵션 | 동작 |
|---|---|---|
| `/장비생성` | 종류*(`영웅`\|`전념의룬`), 이름*(<=30자) | 강화 1강 / 돌파 0 상태로 새 장비 INSERT. 비용 없음. |
| `/장비목록` | — | 본인 장비 최대 30개 + 사용자 전체 누적 사용량을 ASCII 트리 형태로 ephemeral 출력. |
| `/장비삭제` | 장비id* | 본인 소유 장비만 DELETE. 파괴된 장비도 삭제 가능. |
| `/강화` | 장비id* | 현재 강화 레벨에 맞는 확률·비용을 적용, 결과를 Embed로 공개. 영웅 강화는 실패 시 보정 누적, 전념의룬은 실패 시 즉시 파괴. |
| `/돌파` | 장비id* | 영웅 + 강화 20강 도달 장비만. 실패 시 보정 누적 (파괴 X). |

#### 강화/돌파 규칙 (`src/data/enhanceData.js`)

| 종류 | 최대 레벨 | 룩업 방식 | 실패 처리 |
|---|---|---|---|
| 영웅 강화 | 1 → 20 | `HERO_ENHANCE[current_level - 1]` (현재 레벨 기준) | 보정 누적, 재시도 가능 |
| 영웅 돌파 | 0 → 5 | `HERO_BREAKTHROUGH[current_level]` (0-indexed) | 보정 누적, 재시도 가능 |
| 전념의룬 강화 | 1 → 10 | `RUNE_ENHANCE[current_level - 1]` | **즉시 파괴** (단일 실패 → destroyed=1) |

- **보정 적용 공식**: `effective_prob = min(100, base_prob + fail_streak * fail_boost)`
  - 영웅 강화 보정: `fail_boost = 5`(%포인트) — 11강 이상에서만 의미 있음 (1~10강은 100%)
  - 영웅 돌파 보정: `fail_boost = 0.05, 0.04, 0.03, 0.02, 0.01` (각 단계별)
  - 성공 시 해당 트랙의 fail_streak 리셋. 영웅 강화 성공 → `enhance_fail_streak = 0`.
- **20강 도달 후 흐름**: `/강화` 거부 (만렙) → `/돌파 장비id:N` 으로 돌파 단계 진입.
- **전념의룬 확률**: 엑셀 N열이 비어있어 사용자 직접 지정값을 코드에 하드코딩. 1~10강 순서대로 `100, 80, 66, 50, 33, 25, 20, 15, 12, 10` (%).
- **유실 가능한 row**: 영웅 강화 row 20(20→21용), 전념의룬 row 10(10→11용)은 최대치 정의상 미사용.

#### UI 출력 디자인
- `/장비목록` 은 ephemeral(본인만 봄). 트리 형태로 한 장비당 4~5줄. 한글 폭 문제 회피 위해 박스 정렬 대신 들여쓰기 사용.
- `/강화` `/돌파` 응답은 공개. 색상: 성공=초록/노랑, 실패=빨강, 만렙 도달 시 별도 안내 필드 추가.

## 7. 알림 엔진 동작 흐름

핵심 파일: [src/services/scheduleChecker.js](src/services/scheduleChecker.js).

1. 봇 `ready` 시 `startScheduleChecker(client)` 호출. `node-cron` 으로 **매 분 정각**(`* * * * *`, timezone=`Asia/Seoul`) 실행.
2. 분기별 윈도우 매칭:
   - `targetMs = now + minutes*60s` (minutes ∈ {60, 30, 10, 3})
   - `scheduled_at` 이 `[targetMs ± 30s]` 범위에 들어오고 `notify_X=1` AND `notified_X=0` 인 행을 조회.
3. 각 행에 대해:
   - **텍스트 알림**: `channel_id` 로 mention + Embed 전송. 색상은 임박할수록 빨강.
   - **TTS 알림**: `voice_channel_id` 가 있으면 `playTTSInChannel(채널, "{제목} 일정이 {N}분 후 시작됩니다")`.
   - 두 경로는 독립적(텍스트 실패해도 TTS 시도).
4. 성공 시 `notified_X = 1` UPDATE → **중복 발송 방지**.

> **윈도우 ±30초**의 의미: cron 이 매 분 정각에 돌아도 약간의 드리프트가 있으므로, 알림 시점 전후 30초 안에 들어오는 일정을 잡는다. 그래서 사용자가 `21:00:30` 같은 어색한 시간을 등록해도 작동.

> **재시작 시나리오**: 봇이 알림 시각을 놓친 채 재시작되면 윈도우 밖이 되어 해당 알림은 **영구 누락**된다. 보강이 필요하면 "윈도우 안에 안 들어와도 `scheduled_at <= now + minutes*60s` 인 미발송 건은 따라잡기 발송" 같은 로직을 검토.

## 8. TTS 재생 흐름 (운영 핵심)

핵심 파일: [src/utils/ttsPlayer.js](src/utils/ttsPlayer.js).

```
playTTSInChannel(voiceChannel, text)
  1) 봇 권한 확인 (ViewChannel / Connect / Speak)
  2) 기존 voice connection 재사용 또는 새로 join (selfDeaf:false)
  3) entersState(Ready, 30s)  ← UDP 핸드셰이크 끝날 때까지 반드시 대기
                                 (이걸 빼면 무음 버그가 재발함)
  4) server-mute / suppress 상태 경고
  5) google-tts-api 로 MP3 base64 다운로드 → os.tmpdir() 에 임시 파일
     (buffer < 500 bytes 면 다운로드 실패 가능성 경고)
  6) createAudioResource → player.play
  7) Idle / AutoPaused 진입까지 최대 60초 대기
  8) finally: 임시 파일 삭제 + connection.destroy()
```

**과거 사고/교훈 (커밋 268f522 의 의미)**:
- `Ready` 상태 대기 없이 패킷을 보내면 무음. → 현재 코드에 `entersState(... Ready, 30_000)` 명시되어 있음. **제거 금지**.
- ffmpeg 경로를 `prism-media` 가 찾도록 `process.env.FFMPEG_PATH = require('ffmpeg-static')` 를 파일 최상단에서 등록. 모듈 로드 순서가 중요.

## 9. 환경 변수

`.env` 파일에 작성. `.env.example` 은 현재 저장소에 없으므로 첫 배포 시 신규 작성 필요.

| 변수 | 필수 | 용도 |
|---|---|---|
| `DISCORD_TOKEN` | ✅ (봇 실행, 명령어 배포) | Discord Bot Token |
| `CLIENT_ID` | ✅ (명령어 배포 시) | Application ID |
| `GUILD_ID` | 선택 | 있으면 해당 길드에만 즉시 등록(개발), 없으면 글로벌 등록(반영 최대 1시간). |

`index.js` 는 `DISCORD_TOKEN` 만 검증; `deploy-commands.js` 는 `DISCORD_TOKEN`+`CLIENT_ID` 를 검증.

## 10. Discord 권한·인텐트

- **Gateway Intents (코드)**: `Guilds`, `GuildVoiceStates`
  - **`MessageContent` / `GuildMembers` 인텐트는 사용하지 않음**. README의 활성화 안내(Privileged Gateway Intents)는 현재 코드 기준으로는 **불필요**. 향후 메시지 내용 사용 기능이 추가될 경우에만 켜기.
- **봇 채널 권한**:
  - 텍스트 채널: `Send Messages`, `Embed Links`, `Mention Everyone`(역할 멘션용)
  - 음성 채널: `View Channel`, `Connect`, `Speak`
  - 음성 채널에서 봇이 server-mute / suppress 되어 있으면 TTS 무음 — 운영자에게 사전 안내 필요.

## 11. 배포·운영

### 11.1 최초 배포 절차
1. `npm install`
2. `.env` 작성 (위 표 참조)
3. `npm run deploy` — 슬래시 명령어를 Discord 에 등록 (글로벌이면 반영 최대 1시간)
4. `npm start` — 봇 실행
5. 디스코드 OAuth URL 로 봇을 서버에 초대 (`bot` + `applications.commands` scope)

### 11.2 명령어 갱신
- `src/commands/*.js` 의 `SlashCommandBuilder` 정의를 수정한 뒤 `npm run deploy` 재실행해야 클라이언트 UI에 반영됨. (런타임 핸들러 코드만 바꿨다면 deploy 불필요)

### 11.2.1 Docker 배포

```bash
# 0) 호스트에 .env 작성 (DISCORD_TOKEN, CLIENT_ID, 선택 GUILD_ID)
# 1) (최초 1회 또는 명령어 정의 변경 시) 슬래시 명령어 등록
docker compose run --rm aion-bot node src/deploy-commands.js

# 2) 봇 데몬 기동
docker compose up -d

# 3) 로그
docker compose logs -f aion-bot

# 4) 업데이트 후 재기동
git pull
docker compose build
docker compose up -d
```

- **DB 영속화**: 호스트의 `./data` ↔ 컨테이너 `/app/data` 마운트, 컨테이너 내 `DB_PATH=/app/data/aion_bot.db`. WAL 파일(`-shm`, `-wal`) 함께 보관.
- **타임존**: 컨테이너 `TZ=Asia/Seoul` 고정 (cron 알림과 KST 일치).
- **로그 회전**: json-file 드라이버, 10MB × 5 파일.
- **시그널 처리**: tini PID1 → `docker stop` 시 SIGTERM 전달, 봇 깨끗하게 종료.
- **이미지 빌드**: multi-stage (Node 20-slim). better-sqlite3 / opus 네이티브 빌드는 builder 단계에서 처리, 런타임 이미지는 슬림.
- **외부 포트 없음**: Discord 봇은 outbound only.

### 11.3 프로세스 운영
- 상시 구동 필요 → `pm2` / `systemd` / Docker 컨테이너 등으로 관리 권장 (현 저장소엔 프로세스 매니저 설정 없음).
- 로그는 stdout/stderr 로만 출력 → 외부 로깅 수집기(파일 로테이션, journald, Loki 등) 연결 권장.
- SQLite 파일(`aion_bot.db`) **백업 정책 필요**. WAL 파일까지 함께 백업하거나 `.backup` 명령 사용. 빌드/일정 데이터가 단일 파일에 집중.

### 11.4 알려진 제약·주의사항
| 항목 | 내용 |
|---|---|
| 단일 인스턴스 가정 | 동일 DB를 여러 인스턴스가 동시에 폴링하면 알림이 중복 발송될 수 있음. **이중화 금지** 또는 락 도입 필요. |
| 재시작 시 누락 알림 | §7 참고. 윈도우 밖이면 발송 안 됨. |
| 시간대 | KST 고정. 다른 시간대 멤버는 명령어 입력 시 KST로 환산해야 함. |
| TTS 외부 의존 | `google-tts-api` 는 비공식 wrapper. 구글 정책 변경 시 갑작스러운 실패 가능 → 무음 시 `/tts테스트` 로 즉시 진단. |
| ephemeral 응답 표기 | 일부 핸들러는 `ephemeral: true`, TTS는 `MessageFlags.Ephemeral` 사용. discord.js v14 신/구 API 혼재. 신규 코드는 `MessageFlags.Ephemeral` 권장. |
| 다국어 | 명령어 이름이 한글(`/빌드등록` 등). 다국어 운영을 검토한다면 `setNameLocalizations` 추가 검토. |
| 빌드 검색 페이징 없음 | `LIKE` 검색 결과 10건 컷, 페이지네이션 미구현. |
| 일정 수정 기능 없음 | 삭제 후 재등록 방식. |

## 12. 코드 컨벤션·관습

- 파일 최상단 `'use strict';`.
- 한글 콘솔 로그 prefix: `[봇 시작]`, `[명령어]`, `[DB]`, `[scheduleChecker]`, `[TTS]`, `[빌드등록]` 등. 새 로그도 동일 패턴 사용.
- 사용자 응답 컨벤션:
  - 성공: ✅ + Embed
  - 실패: ❌ + 한 줄 안내 (사용자 책임은 구체적인 형식 안내, 시스템 오류는 일반화된 메시지)
  - 권한 거절: ⛔
- DB 접근은 `getDb()` (`src/database.js`) 를 통해서만. 새 테이블 추가 시 `initDatabase()` 안에 `CREATE TABLE IF NOT EXISTS` + (필요 시) `migrations` 배열에 ALTER 문 추가.

## 12.5. 강화 시뮬레이터 주의사항

- **랜덤 소스**: `Math.random()` 사용. 통계적 분포는 OK지만 암호학적 보안 의미 없음. 사용자가 결과를 신뢰하지 않으면 `crypto.randomInt` 로 교체 검토.
- **경제 시스템 부재**: 시뮬레이션 전용이라 키나/강화석 잔액 체크 없이 무한 사용. 진짜 경제 도입하려면 `wallet` 테이블 추가.
- **확률 데이터 변경**: 엑셀이 갱신되면 `src/data/enhanceData.js` 를 손으로 동기화해야 함. 자동 임포터 없음.
- **다중 동시 시도**: 동일 장비 두 명령어 동시 입력 시 race condition 가능 (SQLite 트랜잭션 없이 SELECT → UPDATE). 같은 사람이 같은 장비를 다중 강화하는 시나리오는 슬래시 명령어 응답 대기 동안 차단되므로 실서비스 영향은 거의 없을 것으로 추정.
- **확률 정확도 표기**: Embed 의 `적용 확률` 은 `toFixed(2)` 로 표시. 영웅 돌파 보정 0.05 같은 소수는 표시상 의도와 맞는지 검증 필요.

## 13. 향후 개선 후보 (Backlog 참고)

- **재시작 후 누락 알림 따라잡기**: `notified_X=0 AND scheduled_at <= now + minutes*60s` 미발송 건 후처리.
- **알림 시점 사용자 정의**: 현재 60/30/10/3분 고정. enum 옵션 → 정수 분 입력으로 일반화.
- **다중 길드 운영 시 통계**: `guild_id` 별 집계/대시보드.
- **DB 백업 자동화**: 하루 1회 `aion_bot.db` → 별도 경로 복사 + 보관 정책.
- **`.env.example` 추가**: 신규 배포자 온보딩용.
- **테스트 코드**: `dateUtils`, `scheduleChecker` 윈도우 매칭 로직은 단위 테스트 가치가 큼. 현재 테스트 0개.
- **헬스체크 엔드포인트/명령**: 봇/DB/cron 상태를 한 번에 확인하는 `/상태` 슬래시 명령.

## 14. 빠른 트러블슈팅 가이드

| 증상 | 우선 확인 |
|---|---|
| 슬래시 명령어가 안 보임 | `npm run deploy` 실행 여부, `GUILD_ID` 설정, 글로벌 등록 반영 지연(최대 1시간) |
| 알림이 안 옴 | 봇 프로세스 살아있나, `notify_X=1` 인가, 대상 시각이 윈도우 밖으로 빠졌나, `channel_id` 채널이 삭제되지 않았나 |
| TTS 무음 | `/tts테스트` 실행 → 권한 누락 / server-mute / `Ready` 진입 실패 / 오디오 버퍼 < 500B 메시지 확인 |
| `ALTER TABLE ... duplicate column` | 정상. 마이그레이션 멱등 처리. |
| `unhandledRejection` 로그만 출력 | 프로세스는 살아 있음. 원인 추적 후 try/catch 보강. |

---

**최종 업데이트 기준 커밋**: `78d72c7` (의존성/코드/스크립트 정리)
**검토 권장 시점**: 디스코드 라이브러리 메이저 업데이트, TTS provider 정책 변경, 알림 누락 사고 발생 시.
