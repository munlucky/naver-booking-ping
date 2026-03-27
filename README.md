# Naver Booking Ping

네이버 예약 오픈 감지와 항공권 최저가 추적을 함께 처리하는 Playwright 기반 모니터링 시스템입니다. 각 타겟은 동일한 스케줄러, 상태 저장, ntfy 알림 파이프라인을 공유합니다.

## 기능

- **Playwright 기반 감지** - 웹페이지를 직접 열고 상태를 확인
- **이중 모니터 타입** - `naver-booking`, `flight-price`를 동일한 루프에서 처리
- **다층 감지 규칙** - 네이버 예약 Rule A/B/C, 항공권 가격 probe 작업 단위 지원
- **10초 ±30% 지터** - 빠른 감지 + 트래픽 최소화
- **ntfy 푸시 알림** - iOS/Android 앱으로 알림 수신
- **JSON 상태 저장** - 네이티브 의존성 없이 Windows에서 바로 실행
- **매일 7시 Heartbeat** - 시스템 정상 작동 확인 알림
- **PM2 백그라운드 실행** - 터미널 종료 후에도 계속 실행

## 모니터 규칙

### Naver Booking

| Rule | 설명 |
|------|------|
| A | 예약 관련 링크 (`href*="/booking"`) |
| B | "예약" 텍스트 버튼 (`a[role="button"]:has-text("예약")`) |
| C | 활성 시간 슬롯 텍스트 (`09:30` 같은 시간 패턴) |

### Flight Price

- 지정한 항공권 검색 페이지에서 가격 관련 selector probe를 먼저 시도합니다.
- selector probe 실패 시 body text probe로 visible price 후보를 다시 수집합니다.
- 현재 감지 가격이 지금까지 기록한 최저가보다 낮을 때만 ntfy 알림을 보냅니다.
- 이 probe 체인은 이후 공급자별 worker를 더 추가하는 TOBE 확장 지점입니다.

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

### 4. 타겟 설정

#### 네이버 예약 감지

```yaml
targets:
  - kind: "naver-booking"
    name: "대추밭백한의원"
    urlInput: "https://m.place.naver.com/hospital/13258169/home?entry=pll"
    enabled: true
    policy: "AB"
```

#### 항공권 최저가 감지

```yaml
targets:
  - kind: "flight-price"
    name: "시드니 직항 대한항공/아시아나"
    enabled: true
    provider: "skyscanner"
    priceQuery:
      origin: "ICN"
      destination: "SYD"
      departureDate: "2026-12-17"
      returnDate: "2026-12-26"
      adults: 2
      children: 0
      cabinClass: "economy"
      directOnly: true
      airlines: ["KE", "OZ"]
      currency: "KRW"
```

`flight-price`는 `urlInput`을 직접 넣지 않으면 Skyscanner 검색 URL을 자동 생성합니다.

### 설정 옵션

| 항목 | 기본값 | 설명 |
|------|--------|------|
| `baseIntervalMs` | 10000 (10초) | 체크 주기 |
| `jitterRatio` | 0.3 (±30%) | 지터 비율 |
| `heartbeatTopic` | - | Heartbeat 알림 토픽 (선택) |
| `targets[].kind` | `naver-booking` | 모니터 타입 |
| `targets[].priceQuery` | - | 항공권 검색 조건 |

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

# Skyscanner 세션 수동 부트스트랩
pnpm run bootstrap:flight-session
```

## 알림 종류

| 알림 | 내용 | 발송 조건 |
|------|------|----------|
| 예약 버튼 활성화 | `[가게명] 예약 버튼 활성화` | CLOSED → OPEN 변화 시 |
| 항공권 최저가 갱신 | `[타겟명] 최저가 갱신 ₩...` | 기존 기록보다 더 낮은 가격 감지 시 |
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
[타겟 kind별 체커 실행]
   ↓
[조건 충족 시 알림 판단]
   ↓
[ntfy 알림 발송]
   ↓
[스마트폰에서 알림 수신]
```

## 주의사항

- **상태 유지 중**: 같은 상태/같은 최저가에는 중복 알림 없음
- **CLOSED 복귀**: OPEN → CLOSED 변화 감지 시 다시 OPEN되면 알림
- **항공권 최저가**: 더 낮은 가격이 새로 발견될 때만 다시 알림
- **Skyscanner 차단**: `--bootstrap-flight-session`으로 한 번 직접 챌린지를 통과해 저장된 세션을 재사용할 수 있음
- **트래픽 최소화**: 지터로 네이버 서버 부하 방지
- **고정 간격**: 항상 10초 ±30% 간격으로 체크 (백오프 없음)

## 라이선스

MIT
