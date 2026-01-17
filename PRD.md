아래는 **“네이버 예약 열림 감지 → 로컬 백엔드 실행 → ntfy로 스마트폰 푸시 알림 + 바로가기(클릭 시 예약 URL 열기)”**를 목표로 한 **최종 설계 문서**입니다.

---

# 네이버 예약 오픈 감지 + ntfy 알림 시스템 설계서 (Local Backend)

## 1. 목표

* 특정 네이버 가게 URL(예: `naver.me` 단축 포함)을 주기적으로 확인해서,

  * **예약 메뉴/버튼이 “없음 → 있음”**으로 바뀌거나
  * **예약 가능한 시간 슬롯이 생기는 순간**
* 사용자에게 **스마트폰 푸시 알림**을 보내고, 알림 클릭 시 **즉시 예약 페이지로 이동**시키는 시스템을 만든다.
* 앱/PWA 없이도 동작(로컬 PC/서버에서 백엔드 상시 실행).

---

## 2. 핵심 의사결정

### 2.1 알림 채널: ntfy

* HTTP PUT/POST로 메시지 발행하면, 사용자는 ntfy 모바일 앱(iOS/Android)에서 토픽 구독 후 푸시 수신 가능 ([ntfy][1])
* `Title`, `Priority`, `Tags` 등 헤더로 알림 메타를 붙일 수 있음 ([ntfy][2])
* 알림 클릭 시 열 URL은 `Click` 헤더로 지정 가능 ([ntfy][2])
* (옵션) 액션 버튼도 제공 가능하나, 클라이언트 지원 범위가 다를 수 있어 **기본은 Click 액션 중심** ([ntfy][2])

### 2.2 ntfy 서버 선택

* **기본안(빠른 시작): ntfy.sh 사용**

  * 설치 불필요. 다만 “가입 없는 토픽 = 사실상 비밀번호”라 토픽명은 추측 불가하게 해야 함 ([ntfy][2])
  * 남용 방지를 위한 기본 제한(예: 메시지 길이, 요청/일일 메시지 제한 등)이 존재 ([ntfy][2])
* **확장안(보안/제한 회피): self-host**

  * Docker로 서버 구동 가능 ([ntfy][3])

---

## 3. 요구사항

### 3.1 기능 요구사항 (FR)

1. URL 관리

* 하나 이상의 “대상 URL” 등록/삭제/조회
* `naver.me` 단축 URL은 접속 후 **최종 리다이렉트 URL**로 추적 저장

2. 감지 로직

* 체크 결과를 `CLOSED | OPEN | UNKNOWN(오류)` 상태로 표준화
* **상태 변화(Closed→Open)**에서만 알림 발송(중복 방지)

3. 알림 발송(ntfy)

* 알림 제목/본문/우선순위/태그 지원 ([ntfy][2])
* 클릭 시 열 링크(`Click`)에 “예약 페이지(또는 최종 URL)” 지정 ([ntfy][2])

4. 로깅/관측

* 체크 시각, 최종 URL, 판정 근거(어떤 셀렉터가 잡혔는지), 오류 스택 기록

### 3.2 비기능 요구사항 (NFR)

* 안정성: 일시적 네트워크/로딩 오류에도 자동 복구
* 트래픽/차단 리스크 최소화:

  * 고정 60초 대신 **랜덤 지터(예: 60~120초)** + 백오프
* 이식성: Windows에서도 실행 가능(사용자 환경 고려)

---

## 4. 전체 아키텍처

```
[Scheduler]
   ↓ (주기/지터)
[Checker: Playwright]
   ↓ (OPEN/CLOSED/UNKNOWN)
[State Store: SQLite or JSON]
   ↓ (Closed→Open 감지)
[Notifier: ntfy Publish]
   ↓
[User Phone: ntfy iOS/Android app 구독]
```

---

## 5. 컴포넌트 설계

### 5.1 Scheduler

* 역할: 주기 실행 + 지터 + 백오프
* 정책:

  * 정상: 90초 기준 지터(±20%)
  * 실패 연속: 2분 → 5분 → 10분 단계적 백오프

### 5.2 Checker (Playwright 기반)

* 역할: URL 접속 후 렌더링을 포함한 “실제 화면 상태” 기반 감지
* 이유: 네이버 페이지는 동적 렌더링이 많아 단순 HTML GET만으론 신뢰성이 낮음

**판정 규칙(권장, 다층)**

* Rule A (가벼움): 예약 진입 링크 존재

  * `a[href*="/booking"]` 또는 `a[href*="booking.naver.com"]`
* Rule B (보조): “예약” 텍스트 버튼 존재

  * `a[role="button"]:has-text("예약")` 또는 `button:has-text("예약")`
* Rule C (정확도↑): 시간 슬롯 존재(예: `09:30`)

  * `\b\d{1,2}:\d{2}\b` 텍스트를 가진 **disabled 아닌** 버튼/링크 존재

최종 판정:

* `OPEN` = (A 또는 B 또는 C) 중 1개라도 참
* 단, 특정 대상에서 A/B만으로 오탐이 많으면 “C 우선” 정책을 타겟별로 설정 가능

### 5.3 State Store

* 최소 스펙: `targets.json` + `state.json` (빠른 구현)
* 권장: `sqlite` (다중 타겟/로그 보존/검색에 유리)

필드 예시:

* targets: `id`, `name`, `url_input`, `url_final_last`, `check_policy(rule set)`, `enabled`
* states: `target_id`, `last_status`, `last_changed_at`, `last_open_at`
* logs: `target_id`, `checked_at`, `status`, `evidence`, `error`

### 5.4 Notifier (ntfy)

* 발송: `POST https://ntfy.sh/<topic>` (또는 self-host base-url)
* 헤더:

  * `Title`: “예약 열림 감지”
  * `Priority`: `default/high/urgent` 등 (필요 시 상향) ([ntfy][2])
  * `Tags`: `bell,calendar` 같은 태그 ([ntfy][2])
  * `Click`: 예약 페이지 URL(알림 클릭 시 브라우저로 열림) ([ntfy][2])

> ntfy는 “클릭 액션 URL”을 헤더로 지정할 수 있고, 클릭 시 브라우저/앱을 열 수 있습니다. ([ntfy][2])

---

## 6. 동작 시나리오

### 6.1 최초 설정

1. 사용자가 ntfy 앱 설치 후 토픽 구독(iOS/Android 앱 제공) ([ntfy][1])
2. 로컬 백엔드에 토픽/대상 URL 등록
3. 백엔드가 정기 체크 시작

### 6.2 “예약 열림” 감지

1. Checker가 `CLOSED` → `OPEN` 상태 변화 감지
2. Notifier가 ntfy로 푸시 발송(Click=예약 URL)
3. 사용자가 알림 클릭 → 즉시 네이버 예약 화면 이동

---

## 7. 운영/배포 계획

### 7.1 실행 형태

* 1안: 단일 프로세스 CLI (`node dist/main.js`)
* 2안: Docker로 패키징(Playwright 포함)
* 3안: Windows 서비스(또는 PM2 같은 프로세스 매니저)로 상시 실행

### 7.2 트래픽/제한 고려

* ntfy.sh는 남용 방지 제한(메시지 길이/요청/일일 메시지 등)이 있음 ([ntfy][2])
* 네이버 대상 체크는 **저빈도 + 지터 + 상태 변화 알림만**으로 최소화 권장

---

## 8. 보안 고려사항

* ntfy.sh는 가입 없이 토픽이 생성되므로 **토픽명은 “추측 불가능하게”** 구성(랜덤 스트링 권장) ([ntfy][2])
* (민감하면) self-host로 전환:

  * ntfy는 Docker로 쉽게 서버 구동 가능 ([ntfy][3])

---

## 9. 구현 범위 (MVP)

* 타겟 1개 등록 + 상태 저장 + OPEN 감지 시 ntfy 알림
* Playwright 기반 Rule A/B/C 적용
* 지터/백오프/중복 알림 방지

**MVP 완료 기준**

* “예약 메뉴가 안 보이던 상태”에서 실제로 메뉴가 나타나면,

  * 2분 이내(체크 주기에 좌우) ntfy 알림이 오고,
  * 알림 클릭 시 네이버 예약 화면으로 바로 이동

---

## 10. 확장 아이디어 (선택)

* 멀티 타겟 + 우선순위(“급한 타겟은 더 자주, 덜 급한 타겟은 덜”)
* OPEN 감지 후 **증거 스냅샷(스크린샷)** 저장
* “OPEN 유지 시간” 추적(얼마나 빨리 다시 닫히는지)
* self-host ntfy + 인증 적용

---

원하면, 이 설계서 기준으로 **리포지토리 골격(typescript + playwright + sqlite + ntfy notifier + config yaml)**까지 바로 만들어서 “그대로 실행하면 동작” 수준의 MVP 구조(디렉토리/모듈/환경변수/샘플 설정)로 내려드릴게요.

[1]: https://docs.ntfy.sh/subscribe/phone/ "From your phone - ntfy"
[2]: https://docs.ntfy.sh/publish/ "Sending messages - ntfy"
[3]: https://docs.ntfy.sh/install/ "Installation - ntfy"
