# 쿸 서버판 (Vercel)

- `index.html` : 앱 화면 (https로 열면 서버에 저장, 파일로 열면 예전처럼 브라우저에만 저장)
- `api/` : 버셀 서버 함수 (파티, 초대, 취향 카드, 설문, 유입·인터뷰 기록, 운영자 보기, AI 대리 호출)

## 버셀 환경변수
| 이름 | 필수 | 설명 |
|---|---|---|
| KV_REST_API_URL / KV_REST_API_TOKEN (또는 UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN) | 필수 | Upstash Redis 연결. Storage에서 연결하면 자동으로 들어간다 |
| OPS_KEY | 권장 | 설정 → 운영자용에서 서버 기록을 볼 때 쓰는 비밀번호 |
| GROQ_API_KEY | 선택 | 넣으면 시연 모드가 아니라 실제 AI가 한 상을 추천한다 |

환경변수를 바꾼 뒤에는 다시 배포해야 적용된다.

## 확인
배포 주소 뒤에 `/api/config` 를 붙여 열면 `{"ai":…,"storage":true}` 가 보여야 한다. storage가 false면 저장소가 연결되지 않은 것.

## 유입 경로·핵심 행동 기록
- 채널 링크: `/?src=instagram` · `friend`(지인) · `kakao`(카카오 오픈챗) · `threads` · `naver_cafe` · `naver_blog`. 값이 없으면 직접 방문, 모르는 값은 기타.
- 서버가 직접 기록: 파티 생성(`/api/party` POST), 카드 제출(`/api/card`, 새 카드만), 메뉴 추천(`/api/party` PUT, 파티당 첫 추천).
- 브라우저가 보냄(`/api/track`): 방문(세션당 1번), 초대 링크 전달(파티당 1번, 서버가 중복 제거), 배달앱 이동, 인터뷰 신청.
- 파티에 딸린 행동은 호스트가 들어온 채널로 묶인다. 사람 수는 익명 방문자 ID(`x-visitor`, 브라우저별 무작위 16자리)로 중복 없이 센다.
- 보기: `/#/ops` 에서 OPS_KEY 입력 → 채널별 퍼널표, CSV 내려받기. 저장 위치는 Redis `events` 목록(최근 5만 건).
