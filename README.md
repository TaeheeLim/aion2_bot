# 아이온2 레기온 운영 디스코드 봇

아이온2 레기온(길드) 운영을 위한 디스코드 봇입니다.  
빌드 공유 및 레기온 일정 알림 기능을 슬래시 명령어로 제공합니다.

## 기능

### 빌드 공유
| 명령어 | 설명 |
|--------|------|
| `/빌드등록` | 직업별 빌드 정보 등록 |
| `/빌드검색` | 직업명 또는 키워드로 빌드 검색 |
| `/빌드목록` | 등록된 빌드 목록 조회 (최신순) |
| `/빌드삭제` | 본인 또는 관리자가 빌드 삭제 |

### 레기온 일정 알림
| 명령어 | 설명 |
|--------|------|
| `/일정등록` | 레기온 일정 등록 및 알림 설정 |
| `/일정목록` | 앞으로 예정된 일정 목록 조회 |
| `/오늘일정` | 오늘 예정된 일정만 조회 |
| `/일정삭제` | 본인 또는 관리자가 일정 삭제 |

## 설치 및 실행

### 1. 의존성 설치
```bash
npm install
```

### 2. 환경변수 설정
```bash
cp .env.example .env
# .env 파일을 열어 DISCORD_TOKEN, CLIENT_ID, GUILD_ID 입력
```

### 3. 슬래시 명령어 등록 (최초 1회 또는 명령어 변경 시)
```bash
npm run deploy
```

### 4. 봇 실행
```bash
npm start

# 개발 중 (파일 변경 시 자동 재시작)
npm run dev
```

## Discord Developer Portal 설정

1. https://discord.com/developers/applications 접속
2. New Application 생성
3. Bot 탭 → Token 복사 → `.env`의 `DISCORD_TOKEN`에 입력
4. General Information → Application ID 복사 → `CLIENT_ID`에 입력
5. Bot 탭 → Privileged Gateway Intents → **Server Members Intent**, **Message Content Intent** 활성화
6. OAuth2 → URL Generator → `bot` + `applications.commands` 체크
7. Bot Permissions: `Send Messages`, `Embed Links`, `Read Message History`, `Mention Everyone` 체크
8. 생성된 URL로 봇을 서버에 초대

## 기술 스택

- **Runtime**: Node.js 18+
- **Discord**: discord.js v14
- **Database**: better-sqlite3 (SQLite)
- **Scheduler**: node-cron
- **Time**: date-fns + date-fns-tz (KST 기준)
- **Config**: dotenv

## 폴더 구조

```
src/
├── index.js              # 봇 메인 진입점
├── deploy-commands.js    # 슬래시 명령어 등록 스크립트
├── database.js           # SQLite DB 초기화 및 연결
├── commands/
│   ├── build.js          # 빌드 관련 명령어
│   └── schedule.js       # 일정 관련 명령어
├── services/
│   └── scheduleChecker.js # 주기적 일정 알림 체크
└── utils/
    └── dateUtils.js      # 날짜/시간 유틸 (KST)
```
