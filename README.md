# marathon-seat-watcher

CJ 마라톤 신청 가능 여부를 주기적으로 확인하는 Playwright 스크립트.

## 1) 설치
```bash
npm install
npx playwright install chromium
```

## 2) 환경변수
`.env` 파일 생성:
```env
RACE_URL=https://race.cjsports.or.kr/03/
APPLICANT_NAME=홍길동
BIRTH_YYYYMMDD=19900101
```

## 3) 수동 실행
```bash
npm run check
```

결과 예시:
```json
{"ok":true,"available":false,"detail":"..."}
```

## 4) 자동 실행(매시 정각)
OpenClaw cron에서 아래 커맨드를 주기 실행:
```bash
cd /Users/jtchoi/clawd/projects/marathon-seat-watcher && npm run check
```

`available=true`면 알림 전송하도록 상위 워크플로우(에이전트/크론)에서 처리.

---
주의: 사이트 DOM/버튼 텍스트가 바뀌면 selector 수정 필요.
