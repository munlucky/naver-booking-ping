rmflrh # Naver Booking Ping

네이버 예약 오픈 감지 시스템 - 특정 가게 URL의 예약 버튼 활성화 상태 변화(CLOSED → OPEN)를 감지하여 ntfy로 스마트폰 푸시 알림을 발송합니다.

## 기능

- **Playwright 기반 감지** - 모바일 네이버 플레이스 페이지에서 예약 버튼 감지
- **다층 감지 규칙** - Rule A(링크), Rule B(버튼)로 정확도 향상
- **10초 ±30% 지터** - 빠른 감지 + 트래픽 최소화
- **ntfy 푸시 알림** - iOS/Android 앱으로 알림 수신
- **JSON 상태 저장** - 네이티브 의존성 없이 Windows에서 바로 실행
- **매일 7시 Heartbeat** - 시스템 정상 작동 확인 알림
- **PM2 백그라운드 실행** - 터미널 종료 후에도 계속 실행

## 감지 규칙

| Rule | 설명 |
|------|------|
| A | 예약 관련 링크 (`href*="/booking"`) |
| B | "예약" 텍스트 버튼 (`a[role="button"]:has-text("예약")`) |

## 설치

### 1. 의존성 설치

```bash
pnpm install
```

### 2. Playwright 브라우저 설치

```bash
npx playwright install chromium
```

### 3. 빌드

```bash
pnpm build
```

## 설정

### 1. 설정 파일 생성

```bash
copy config\config.example.yaml config\config.yaml
```

### 2. ntfy 토픽 설정

`config/config.yaml`에서 `topic` 값을 랜덤한 문자열로 변경하세요:

```yaml
ntfy:
  topic: "naver-booking-ping-abc123xyz"
```

### 3. ntfy 앱 설치 및 구독

1. iOS/Android에서 [ntfy 앱](https://ntfy.sh/) 설치
2. 앱에서 토픽 구독: 설정한 토픽 이름

### 4. 타겟 URL 설정

```yaml
targets:
  - name: "대추밭백한의원"
    urlInput: "https://m.place.naver.com/hospital/13258169/home?entry=pll"
    enabled: true
    policy: "AB"  # Rule A, B 사용
```

### 설정 옵션

| 항목 | 기본값 | 설명 |
|------|--------|------|
| `baseIntervalMs` | 10000 (10초) | 체크 주기 |
| `jitterRatio` | 0.3 (±30%) | 지터 비율 |
| `heartbeatTopic` | - | Heartbeat 알림 토픽 (선택) |

## 실행

### 1. PM2 백그라운드 실행 (권장)

```bash
# PM2 시작 (백그라운드 실행)
pnpm run pm2:start

# PM2 중지
pnpm run pm2:stop

# PM2 재시작
pnpm run pm2:restart

# PM2 로그 확인
pnpm run pm2:logs

# PM2 상태 확인
pnpm run pm2:status
```

### 2. 일반 실행

```bash
# 시작 (터미널 종료 시 같이 종료됨)
pnpm start

# 테스트 알림 전송
pnpm start -- --test
```

## 알림 종류

| 알림 | 내용 | 발송 조건 |
|------|------|----------|
| 예약 버튼 활성화 | `[가게명] 예약 버튼 활성화` | CLOSED → OPEN 변화 시 |
| 정상 작동 중 | `Naver Booking Ping - 정상 작동 중` | 매일 7시 1회 |

## 디렉토리 구조

```
naver-booking-ping/
├── src/
│   ├── core/                # 체커, 알림, 스케줄러, 상태관리
│   ├── infrastructure/       # Playwright 브라우저
│   ├── config/              # 설정 로드
│   ├── utils/               # 로거
│   └── types/               # 타입 정의
├── config/
│   ├── config.example.yaml  # 설정 샘플
│   └── config.yaml          # 실제 설정
├── data/                    # 상태 저장소 (JSON)
├── logs/                    # 로그 파일
└── dist/                    # 빌드 결과
```

## 동작 방식

```
[매 10초 ±30%]
   ↓
[Playwright로 페이지 접속]
   ↓
[Rule A/B로 예약 버튼 확인]
   ↓
[CLOSED → OPEN 변화 시]
   ↓
[ntfy 알림 발송]
   ↓
[스마트폰에서 알림 수신]
```

## 주의사항

- **상태 유지 중**: OPEN 상태가 계속되면 중복 알림 없음
- **CLOSED 복귀**: OPEN → CLOSED 변화 감지 시 다시 OPEN되면 알림
- **트래픽 최소화**: 지터로 네이버 서버 부하 방지
- **고정 간격**: 항상 10초 ±30% 간격으로 체크 (백오프 없음)

## 라이선스

MIT
