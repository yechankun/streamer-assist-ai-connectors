# Streamer Assist AI Connectors

이 저장소는 Streamer Assist용 공급자 어댑터를 공급자별로 독립 버전 관리합니다. 모델 SDK나 공급자 CLI 바이너리는 포함하지 않으며, 데스크톱 앱은 선택한 어댑터 팩만 필요할 때 내려받습니다.

컴포넌트 ID는 `openai`, `anthropic`, `xai`, `google`, `deepseek`, `moonshot`입니다. 각 공급자는 `providers/<id>/`에 있으며 `manifest.json`에서 자체 시맨틱 버전을 관리합니다. 릴리스 태그 형식은 `<id>-v<version>`입니다. 한 공급자 변경에 다른 공급자의 버전을 올릴 필요가 없습니다.

## 어댑터 경계

각 어댑터는 ABI 버전 1을 구현합니다. 공급자별 API 요청 본문과 스트림 이벤트 변환, 사용량 정규화, CLI 분석 계획과 모델 검색 파싱, 할당량 매핑, 가격 스냅샷, 공식 CLI 릴리스 메타데이터를 제공합니다. HTTP 전송, 취소, 응답 크기 제한, 프로세스 실행, 경로 검증, 자격 증명 암호화와 저장은 데스크톱 앱이 담당합니다. API 키는 메모리의 함수 인수로만 전달하며 저장소에 저장하거나 모델 목록 URL에 넣지 않습니다.

모델은 선택한 공급자 API 또는 설치된 CLI에서 실행 중 조회합니다. 팩에 고정 모델 목록은 넣지 않습니다. 가격 행은 정확한 모델 ID, 출처 URL, 확인 날짜를 포함합니다. 공급자가 실제 비용을 제공하기 전까지 앱은 가격을 추정치로 표시하며, 모르는 모델의 가격은 알 수 없음으로 둡니다.

Grok npm 레시피는 네이티브 패키지의 별도 `latest` 태그 대신 루트 패키지에 지정된 Windows 선택 의존성 버전을 그대로 사용합니다. 현재 공식 아카이브에는 `grok.exe.br`가 들어 있으며, 레시피의 `executableCompression: "brotli"`를 지원하는 데스크톱이 아카이브 해시 검증 후 기존 추출 용량 제한 안에서 압축을 해제합니다. 이전 일반 실행파일도 지원하고 npm 설치 스크립트는 실행하지 않습니다. [Grok 설치 문서](https://docs.x.ai/build/overview)를 참고하세요.

## 공급자 로그인

각 팩은 `cli.profile` 메타데이터를 제공합니다. 지원하는 프로필에는 공식 환경 변수와 공급자별 앱 프로필 기준 상대 경로를 매핑하는 `env`, 처음 만들 비밀 없는 설정 파일인 `files`, 공식 근거를 가리키는 `docs` URL이 있습니다. 데스크톱은 `userData/ai/profiles/<provider-id>` 아래에 프로필을 만들고 로그인·로그아웃·모델 조회·할당량 조회·분석의 모든 자식 프로세스에 적용합니다. PC에 설치된 기존 CLI의 인증 정보는 이 프로필로 복사하지 않습니다.

| 공급자 | 공식 프로필 경로 지정 | 인증 정보 분리 |
| --- | --- | --- |
| OpenAI | `CODEX_HOME`, `CODEX_SQLITE_HOME` | 앱 프로필의 `config.toml`에서 인증 정보를 `CODEX_HOME` 안의 파일로 저장하도록 지정합니다. [인증 문서](https://learn.chatgpt.com/docs/auth), [환경 변수](https://learn.chatgpt.com/docs/config-file/environment-variables). |
| DeepSeek | 같은 Codex 변수를 별도 공급자 프로필에 적용 | 브리지의 Codex 루트와 앱에 저장한 DeepSeek API 키를 독립적으로 사용합니다. |
| Anthropic | `CLAUDE_CONFIG_DIR`, `ANTHROPIC_CONFIG_DIR` | Claude 로그인 파일과 경로별 Keychain 항목을 분리합니다. 두 번째 경로는 Console OAuth와 연합 인증 프로필 파일까지 분리합니다. [Claude 인증](https://code.claude.com/docs/en/authentication), [Anthropic 프로필 경로](https://platform.claude.com/docs/en/manage-claude/wif-reference). |
| xAI | `GROK_HOME` | Grok의 `auth.json`과 설정·상태를 이 경로에서 관리합니다. [설정](https://docs.x.ai/build/settings), [공식 파일 경로](https://github.com/xai-org/grok-build/blob/main/crates/codegen/xai-grok-pager/docs/user-guide/14-headless-mode.md). |
| Moonshot | `KIMI_CODE_HOME`, 이전 버전의 `KIMI_SHARE_DIR` | 네이티브 Kimi Code와 이전 Python CLI에 각각 공식 루트를 지정해 OAuth와 실행 데이터를 분리합니다. [네이티브 데이터 경로](https://moonshotai.github.io/kimi-code/en/configuration/data-locations.html), [이전 데이터 경로](https://moonshotai.github.io/kimi-cli/en/configuration/data-locations.html). |
| Google | `supported: false` | Antigravity는 OS 자격 증명 관리자를 재사용하며 공식 문서에서 독립된 인증 이름공간을 확인하지 못했습니다. 데스크톱은 API 연결을 제공하고 공유 인증을 사용하는 CLI 동작을 차단합니다. [Antigravity 설치·인증](https://www.antigravity.google/docs/cli/install/). |

호스트는 프로필 메타데이터가 없거나 지원되지 않으면 CLI 동작을 거부합니다. 상대 경로와 고정 환경 변수 이름을 검증하고 비밀 없는 초기 설정만 생성하며, OS의 `HOME`, `USERPROFILE`, `APPDATA`, `LOCALAPPDATA`는 변경하지 않습니다. API 키는 기존 데스크톱 암호화 저장소를 사용합니다.

어댑터는 로그아웃 방식도 제공합니다. Codex, Claude Code, Grok은 앱 프로필 안에서 문서화된 로그아웃 명령을 새 로그인 전에 실행합니다. Kimi Code는 ACP `initialize` 응답에 `agentCapabilities.auth.logout`이 있을 때만 ACP 로그아웃을 실행하며, 지원하지 않는 구버전에는 해당 요청을 보내지 않습니다. DeepSeek CLI에는 로그아웃 명령이 없으며 앱에 저장한 암호화 API 키를 지웁니다. Antigravity의 터미널 `/logout` 레시피는 향후 공식 격리 기능이 지원될 때 사용할 메타데이터로 남으며, 프로필이 지원되지 않는 동안 실행하지 않습니다.

설치된 각 어댑터는 공급자가 문서화한 CLI 진입점에 맞춘 고정 `cli.auth` 레시피를 포함합니다. Codex와 Claude Code는 문서화된 로그인·상태 명령을 사용합니다. Grok과 Kimi Code는 공식 브라우저/기기 코드 흐름을 사용하고, Antigravity는 `agy` 터미널에서 로그인을 시작합니다. DeepSeek에는 공식 코딩 CLI 로그인 명령이 없어 API 키 흐름을 사용합니다. 호스트는 고정된 인자만 실행하고, 전달되는 브라우저 URL은 어댑터의 정확한 HTTPS 호스트 허용 목록과 대조합니다.

상태·진행 파서는 정규화된 로그인 상태, 허용된 인증 URL 또는 일회용 기기 코드만 반환합니다. 원시 명령 출력, 계정 정보, 액세스 토큰, API 키는 반환하지 않습니다. API 키는 데스크톱의 암호화된 입력 흐름에서 저장하며 `keyUrl`은 공급자의 HTTPS 키 관리 콘솔을 가리킵니다. 로그인 명령과 URL 호스트는 공급자별 컴포넌트 버전에 포함됩니다.

## 빌드와 테스트

Node.js 22 이상이 필요합니다. 런타임 또는 개발용 npm 의존성은 없습니다.

```sh
npm test
npm run build
node scripts/build-pack.cjs openai
```

`npm run build`는 여섯 `.saip.json` 팩을 `dist/`에 생성합니다. 각 팩은 JSON 페이로드를 base64로 감싼 형식이며, 포함 파일마다 SHA-256 해시가 있습니다. `build-pack.cjs`는 릴리스 자동화가 사용하는 팩 다이제스트 메타데이터도 기록합니다.

## 릴리스

공급자 manifest를 수정한 뒤 `openai-v0.1.4`처럼 태그를 푸시합니다. 공급자별 릴리스 작업은 태그마다 독립적으로 실행되며, 전체 팩 테스트 후 해당 공급자 팩을 빌드하고 GitHub SHA-256 다이제스트와 크기를 확인합니다. 성공한 공급자 릴리스 뒤 별도 카탈로그 workflow가 실행되며, 수동으로 다시 실행해 카탈로그를 갱신할 수도 있습니다. 이 workflow는 기존 카탈로그 바이트의 GitHub 다이제스트와 각 기존 행에 해당하는 태그 팩을 검증한 뒤, 공급자마다 가장 높은 시맨틱 버전 릴리스의 태그·자산 이름·스키마·파일 해시·GitHub 다이제스트·크기를 확인합니다. 카탈로그 갱신은 직렬화되며, 대기 작업이 합쳐져도 매번 전체 공급자 릴리스를 다시 읽고 각 공급자의 최신 유효 버전을 선택합니다. 카탈로그는 스키마 버전이 포함된 일반 JSON입니다. 데스크톱 앱은 고정 저장소의 GitHub 릴리스 다이제스트가 카탈로그 및 다운로드한 팩의 바이트와 일치해야 설치를 진행합니다.

카탈로그 workflow는 GitHub API가 제공한 다이제스트와 크기로 카탈로그 및 선택된 모든 릴리스를 확인한 다음, 메타데이터 전용 배포 인덱스도 `https://raw.githubusercontent.com/yechankun/streamer-assist-ai-connectors/distribution-v1/index.json`에 게시합니다. 인덱스에는 정확한 카탈로그 바이트와 각 팩을 확인하는 API 자산 영수증이 들어가며 공급자 팩 바이너리를 복사하거나 미러링하지 않습니다. 클라이언트는 사용자의 GitHub REST 할당량을 쓰지 않고 고정된 동일 저장소 URL에서 인덱스를 받은 뒤, 고정된 GitHub 릴리스 URL에서만 팩을 내려받고 영수증에 따라 바이트를 검증할 수 있습니다. 이 endpoint는 대체 게시자 신뢰 경로이며 클라이언트의 기존 신뢰 정책을 자동으로 바꾸지 않습니다. 이 경로를 사용하는 클라이언트는 HTTPS와 고정 저장소의 CI가 갱신하는 `distribution-v1` 브랜치를 게시자 신뢰 기준으로 삼습니다. 인덱스는 서명되지 않았으며 클라이언트가 매번 GitHub API에서 직접 확인한 증명은 아닙니다. 이 브랜치는 workflow에서만 관리하세요.

GitHub Actions는 릴리스와 배포 브랜치 변경에 단기 `GITHUB_TOKEN`만 사용합니다. 영구 서명 키나 어댑터별 비밀값은 필요하지 않습니다. 공급자 릴리스 자산은 덮어쓰지 않으므로 변경 시 새 시맨틱 버전을 발행하세요.

## 가격 출처와 기여

초기 가격 스냅샷은 2026-10-06에 확인했으며 정확한 모델 ID에만 적용합니다. 가격은 바뀔 수 있으므로 출처와 확인 날짜를 함께 저장합니다. DeepSeek의 공식 UTC 피크 시간대와 Gemini의 기간 제한 가격은 가격 스키마로 표현합니다. xAI의 실행 중 모델 메타데이터에도 공급자가 제공하는 모델별 가격이 포함될 수 있습니다. 앱은 가격 파일을 검증하고 추정치를 청구서로 표시하지 않습니다.

공급자 전용 동작은 해당 공급자 어댑터에 두고, 순수 공통 변환은 `lib/`에 둡니다. 유료 API 생성 요청은 자동 재시도하지 마세요. 키를 URL이나 파일에 넣거나, 공급자 오류 본문을 로그에 남기거나, API 응답의 도구 호출을 실행하지 마세요. 테스트는 fixture와 메모리 메타데이터 응답을 사용하고 유료 프롬프트를 보내지 않습니다.
