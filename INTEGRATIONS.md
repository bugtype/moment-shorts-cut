# MCP / CLI 연결을 위한 구조

현재 버전은 **공통 편집 명령, 로컬 CLI, MCP 어댑터와 stdio 서버**를 제공합니다. [MCP 연결과 AI 스킬](docs/MCP.md)에서 설정 방법을 확인하세요.

**stdio 프로젝트는 임시 상태입니다.** 파일 저장·브라우저 동기화·원격 업로드·서버 음성 인식·무인 영상 인코딩은 제공하지 않습니다. 사이트는 기존 브라우저 편집기로 동작합니다.

| 하려는 일 | 사용할 인터페이스 | 먼저 확인할 것 |
|---|---|---|
| 프로젝트 JSON 편집·자막 파일 출력 | [CLI](#실제-cli-사용) | 원본을 보존할 출력 경로, `--dry-run` |
| AI 클라이언트로 메타데이터 편집 | [stdio MCP](docs/MCP.md) | `session`은 임시 프로젝트, 종료 전 문서 저장 |
| 열린 브라우저 프로젝트 편집 | [같은 페이지 API](#브라우저와-파일-왕복) | `window.moment.ready`, 현재 작업의 `BUSY` 상태 |
| 별도 저장소·미디어 작업 연결 | [호스트 확장](#mcp-어댑터와-호스트-확장) | 인증·원자적 저장·실제 제공자는 호스트 책임 |

**빠른 찾기:** [명령 목록](#명령-v1) · [시간 기준](#시간-기준) ·
[CLI 시작](#실제-cli-사용) · [결과·검증](#결과와-검증) ·
[입력 한도](#입력-인코딩과-크기) · [오류·복구](docs/MCP.md#responses-and-recovery) ·
[작업별 예제](#작업별-편집-예제)

## 실제 CLI 사용

Node.js 20 이상, 추가 패키지 설치 없이 실행합니다. 저장소 루트 기준입니다.

```bash
node cli/moment.mjs init --out project.json
node cli/moment.mjs exec template.apply --project project.json --args-file examples/explainer.json --out edited.json
node cli/moment.mjs exec title.update --project edited.json --json '{"patch":{"lines":["첫 번째 제목","두 번째 제목"]}}' --out titled.json
node cli/moment.mjs exec captions.export --project titled.json --out captions.srt
node cli/moment.mjs exec captions.export --project titled.json --json '{"format":"vtt"}' --out captions.vtt
node cli/moment.mjs exec captions.export --project titled.json --json '{"format":"txt"}' --out captions.txt
node cli/moment.mjs exec render.plan --project titled.json --json '{"quality":1080,"format":"mp4"}' --out render-plan.json
```

### 표준 입력으로 JSON 인수 전달

`exec --args-file -`는 파일 대신 stdin에서 **JSON 인수 하나**를 읽습니다. EOF까지
기다리므로 입력을 끝내는 생산자와 파이프로 연결하세요. 아래 Node 생산자는 별도
JSON 임시 파일이나 셸별 JSON 따옴표 이스케이프 없이 실행할 수 있습니다.

```sh
node cli/moment.mjs init --out stdin-source.json
node -e "process.stdout.write(JSON.stringify({patch:{name:'Piped edit'}}))" | node cli/moment.mjs exec project.update --project stdin-source.json --args-file - --out stdin-edited.json
node -e "process.stdout.write(JSON.stringify({offset:0,limit:2}))" | node cli/moment.mjs exec captions.list --project stdin-edited.json --args-file -
```

| 규칙 | 동작 |
|---|---|
| 크기·인코딩 | 실제 입력 UTF-8 바이트 최대 10 MiB(10,485,760); 파일과 같은 엄격한 디코딩, 선두 BOM 하나 허용 |
| 빈 입력·잘못된 UTF-8·여러 JSON 값 | `INVALID_JSON`; 줄마다 별도 JSON을 받는 스트리밍 프로토콜 아님 |
| 크기 초과 / 스트림 읽기 실패 | `FILE_TOO_LARGE` / `FILE_ERROR`; 초과는 EOF 전에도 거절 |
| 옵션 | `--json`과 함께 사용 불가; 이름이 `-`인 실제 파일은 `--args-file ./-` |
| 경로 구분 | `--project`·`--out`의 `-`에는 stdin/stdout 의미를 추가하지 않음 |
| 결과·보호 | 기존 stdout 응답 유지; 잘못되거나 초과한 인수는 새 출력을 만들거나 기존 출력을 덮어쓰지 않음 |

`--dry-run`도 같은 인수를 읽지만 파일을 쓰지 않고 미리보기만 반환합니다. stdin에는
응답 봉투나 원시 자막 파일이 아닌 해당 명령의 인수 객체를 보내세요. 예를 들어 자막
가져오기는 `{text,basis}`이며, 템플릿 적용은 `{document,withContent}`입니다. 인코딩을
바꾸는 셸에서는 UTF-8 파이프를 사용하거나 `--args-file args.json` 파일 경로를 쓰세요.

### 출력과 기존 파일 보호

**`exec --dry-run`은 파일을 쓰지 않습니다.** 결과를 JSON으로 미리 확인하세요. `init`은 `--out`과 `--overwrite`만 지원하며, 지원하지 않는 옵션은 파일 접근 전에 거부합니다.

| 상황 | 동작 |
|---|---|
| 기존 출력 파일 | 기본 거절; 의도한 교체에만 `--overwrite` 사용 |
| 성공 | 종료 코드 0, stdout JSON |
| 실패 | 종료 코드 1, stderr JSON |

출력은 임시 파일에 먼저 쓴 뒤 최종 경로로 반영합니다.

**프로젝트 설정 파일은 출력도 UTF-8 10 MiB(10,485,760바이트) 이하**여야 합니다.
들여쓰기·마지막 줄바꿈을 포함한 실제 직렬화 바이트를 쓰기 전에 검사하며,
초과하면 `FILE_TOO_LARGE`로 내용을 잘라내지 않고 거절합니다. 새 파일을 만들거나 기존 파일을
덮어쓰지 않습니다. CLI `init`, 수정 명령의 `--out`, `project.get --out`에
적용하며 stdout·`render.plan` 출력은 이 설정 파일 검사 대상이 아닙니다.
`--dry-run`은 메모리 미리보기로, `--out`도 함께 있어도 파일 크기 사전 검사를
대신하지 않습니다. 브라우저의 편집 설정 저장도 다운로드 전에 같은 한도를 적용하며
프로젝트 내용은 바꾸지 않습니다. 복원 시에는 실제 읽은 바이트도 다시 검사합니다.

이것은 파일 왕복 한도이지 프로젝트 상태 스키마의 한도가 아닙니다. 메타데이터
API의 `project.get`/`createProjectDocument`는 더 큰 유효 상태도 반환할 수 있으나,
기본 파일 저장·복원 경로가 이를 받아준다는 뜻은 아닙니다. 큰 구성을 보존해야 하면
데이터를 임의로 자르거나 삭제하지 말고 다른 승인된 저장 흐름을 선택하세요.


### 입력 인코딩과 크기

**JSON 파일 상한은 BOM 포함 10 MiB(10,485,760바이트)입니다.** 읽기 전 파일 크기와 읽은 바이트 수를 모두 확인하므로 중간에 커진 파일도 초과하면 거부합니다.

파일 전체를 읽은 뒤 재검사하므로 메모리 할당 상한이나 다른 프로세스와의 원자적 읽기를 보장하지는 않습니다.

`--project`와 `--args-file`은 UTF-8 JSON 파일을 읽으며, 파일 시작의 BOM 하나는 허용합니다. 본문의 문자는 그대로 보존하고 출력 JSON에는 BOM을 붙이지 않습니다. 잘못된 UTF-8 바이트는 대체 문자로 변환하지 않고 `INVALID_JSON`으로 거부합니다. UTF-16 파일은 지원하지 않으므로 UTF-8로 저장하세요. `--json` 인수에는 BOM 없는 JSON 문자열을 전달합니다.

### SRT 출력 제한

**SRT·VTT·TXT 모두 아래 한도를 적용합니다.** `format` 생략 시 기존 SRT 출력을 유지합니다. VTT는 `{"format":"vtt"}`를 명시해야 하며 출력 확장자로 형식을 추측하지 않습니다.

VTT는 UTF-8 일반 WebVTT로 `WEBVTT` 헤더와 점 단위 밀리초를 사용합니다. 편집 구간·반복·배속과 문구 이스케이프는 SRT와 동일합니다. 꾸밈 스타일·영역·화자 메타데이터는 내보내지 않습니다. NUL(`U+0000`)은 SRT/VTT/TXT 모두에서 거부합니다. 자동 제거하지 않으므로 해당 문자를 수정/제거한 뒤 재시도하세요. 프로젝트 JSON 원문과 실패 시 기존 출력 파일은 보존합니다. 자막이 없으면 CLI/서비스는 `WEBVTT\n\n`을 반환하고 브라우저는 빈 자막 파일을 내려받지 않습니다.

| 제한 대상 | 상한 |
|---|---|
| 편집 후 출력 자막 | 10,000개 |
| 반복분을 포함한 원문 UTF-8 | 2 MiB |
| 완성된 SRT, VTT 또는 TXT | 2 MiB |

`captions.export`는 이 세 제한을 각각 적용합니다. 파일 크기는 이스케이프·시간·구분자·VTT 헤더(해당 시)를 포함하며 CLI/서비스는 BOM을 출력하지 않습니다. 브라우저는 SRT에만 BOM을 넣고 그 3바이트도 계산하며, VTT/TXT에는 넣지 않습니다. 초과 시 `CAPTION_OUTPUT_LIMIT`로 전체 출력을 거절하고 CLI는 기존 출력 파일을 보존합니다. 원본 프로젝트 검증·JSON·편집·`render.plan`에는 이 파생 출력 제한을 적용하지 않습니다. 반복 클립이나 자막을 줄여 재시도할 수 있습니다.

CLI는 편집 메타데이터와 SRT/VTT/TXT 출력을 다룹니다. MP4 파일을 생성하거나 브라우저 IndexedDB의 원본 파일을 직접 가져오지 않습니다.

### 편집 후 자막을 일반 TXT로 저장

`captions.export`에 `{"format":"txt"}`를 전달하면 `{format:"txt", text}`를
반환합니다. 위 CLI 예제처럼 별도 `.txt` 파일로 저장하세요. 확장자만 바꾸면
형식이 바뀌지 않으며 기본 SRT는 그대로입니다.

| TXT 내용 | 경계 |
|---|---|
| 파생 자막마다 한 문단 | 클립·반복·원본/타임라인 기준·배속을 적용한 출력 순서, 중복 제거 없음 |
| 원문 보존 | `<>&`·공백·여러 줄 보존, LF로 정규화; 구간 사이 빈 줄과 마지막 줄바꿈 |
| 포함하지 않는 것 | 시간·ID·화자 이름·제목·카드·스타일; 단어별 정확한 녹취나 프로젝트 백업 아님 |
| 예외·한도 | 빈 줄·밀리초 미만 구간 허용, NUL 거부, 자막 없으면 `""`; 실제 UTF-8 구분자 포함 2 MiB |

10,000개 파생 구간·반복 원문 2 MiB 한도도 적용합니다. 원문 바이트 검사는
줄바꿈 정규화 전이므로 최종 TXT가 작아져도 원문 한도 초과는 거절합니다. 분할이나 반복 클립은
같은 자막 단어를 여러 번 출력할 수 있습니다. TXT는 SRT/VTT 가져오기 형식이
아니며 시간 정보를 복원할 수 없습니다. 브라우저는 형식 선택 후 하나의 저장
버튼을 사용하고 SRT만 BOM을 붙입니다. 빈 결과는 내려받지 않습니다.

### 그래픽 문구 검토용 TXT

브라우저 **프로젝트 파일 → 그래픽 문구 (.txt)**는 현재 저장 모델의 제목·크레딧·카드를
`프로젝트이름.graphics.txt`로 내려받습니다. 자막 패널의 TXT와 다른 **사람이 읽는 검토용
목록**이며, 편집 설정 JSON이 계속 백업입니다. 수정한 TXT를 가져오거나 자동 적용하는
기능은 없습니다.

| 포함 | 제외·한계 |
|---|---|
| 제목 두 줄, 크레딧, 카드의 label/text/detail | 대사 자막, 미디어 이름/경로, 카드 ID, 전체 스타일 없음 |
| 활성 여부·저장된 시작/끝(미지정 끝은 null), 카드 role/kind | 실제 표시 여부 판정·생성된 카운트다운 숫자·렌더링 결과 아님 |
| 비활성·범위 밖 항목도 포함, 작성 카드 순서, 최대 14개 문구 레이어 | 화면상 순서·대본·영상 전사·손실 없는 프로젝트 복원이 아님 |

제목·크레딧은 항상 포함하고 카드만 저장 순서로 이어집니다.
시간은 저장된 **배속 후 출력 초**입니다. 제목·항목 이름 등 보고서 표시는 현재 UI
언어를 따르지만 작성 문구와 줄바꿈은 번역·정규화하지 않습니다. UTF-8/BOM 없이 저장하고
내보낼 문구의 NUL은 자동 제거하지 않고 `INVALID_ARGUMENT`와 해당 필드 경로로 거절합니다.
표시 항목명은 번역하지만 true/false·role/kind는 원래 값이며 null 끝은 출력 끝을 뜻합니다. 다운로드는 프로젝트·기록·미디어를
바꾸지 않습니다. 준비된 미디어가 없어도 유효한 설정이면 가능하며, 복구 실패 후 읽은
유효 설정도 검토할 수 있지만 저장 잠금은 유지합니다. 복원 중·유효하지 않은 설정은
차단합니다. 실제 파일 저장·픽셀 결과를 브라우저에서 검증했다는 뜻은 아닙니다.

이 보고서의 CLI/MCP 명령은 없습니다. `project.get`은 계속 전체 설정 문서를 반환합니다.
직접 JavaScript를 통합할 때에는 다음 선택 모듈 함수를 사용할 수 있습니다. 예제는 파일을
쓰지 않으며 기본 데모를 사용합니다(사용자의 브라우저 프로젝트가 아님).

```sh
node --input-type=module <<'JS'
import {createDemoProject} from './dist/core/project.mjs';
import {projectGraphicsText} from './dist/core/graphics-text.mjs';
import {setLocale} from './dist/i18n.mjs';
setLocale('en', {persist:false});
const project = createDemoProject();
process.stdout.write(projectGraphicsText(project));
JS
```

### 결과와 검증

| 결과 | 형식 |
|---|---|
| 성공 | `{ok:true, apiVersion:1, command, data}` |
| 실패 | `{ok:false, apiVersion:1, command, error:{code,message,path?}}` |

잘못된 숫자·시간·색상·알 수 없는 필드는 변경 전에 거부합니다. 변경은 복사본에서 준비하며 저장 포트가 성공한 뒤 완료를 반환합니다. **수정 성공의 `data`는 전체 문서가 아닙니다.** 저장할 문서는 `project.get`으로 다시 읽으세요.

JavaScript에서 직접 호출할 때도 JSON으로 왕복 가능한 값을 전달하세요. 배열의 빈 슬롯(예: `[, '둘째 줄']`)과 열거되지 않는 인덱스는 `INVALID_ARGUMENT`로 거부합니다. 빈 제목 줄에는 `''`를 사용하고, `null`은 해당 입력 스키마가 허용하는 곳에서만 사용합니다.

주요 오류: `INVALID_ARGUMENT`, `UNKNOWN_COMMAND`, `NOT_FOUND`, `UNSUPPORTED_VERSION`, `BUSY`, `MEDIA_RELINK_REQUIRED`, `NOT_CONFIGURED`, `INVALID_PROVIDER_RESULT`, `CAPTION_OUTPUT_LIMIT`. 예상하지 못한 내부 오류는 `INTERNAL_ERROR`로 반환하며 스택이나 내부 인증 정보를 반환하지 않습니다.

### 선택 사항: 공식 Python SDK 연결 점검

기본 서버·`npm test`·Node 예제에는 외부 SDK가 필요하지 않습니다. 별도 SDK 소비자
점검은 **이미 `mcp==1.29.0`이 있는 Python 3.10+ 환경**과 PATH의 Node.js 20+에서
저장소 루트 기준 `python examples/use-mcp-sdk.py`로 실행하세요. v1 `ClientSession`
대상이며 v2/모든 버전 호환성을 주장하지 않습니다. 패키지를 설치하거나 파일을 쓰지
않으며, 실제 stdio 데모 편집·잘못된 입력 후 복구·메모리 문서의 새 세션 재가져오기를
확인합니다. 사용자의 브라우저 프로젝트나 실제 영상 출력 검사가 아닙니다.

기본 테스트/CI에 포함되지 않는 선택 검사입니다. SDK가 없으면 기존
`node examples/use-mcp-client.mjs`를 사용하세요. [정확한 전제·타임아웃·결과와
버전 고정 공식 자료](docs/MCP.md#optional-official-python-sdk-smoke-test)를 확인하세요.

### 시간 기준

| 필드·출력 | 시간 기준 |
|---|---|
| 클립 `start/end`, 자막 `basis: "source"` 또는 생략 | 원본 영상의 초 |
| 자막 `basis: "timeline"` | 배속 적용 **전** 편집 타임라인의 초 |
| 제목·크레딧·구간 문구 | 배속 적용 **후** 출력 영상의 초 |
| SRT/VTT | 편집 구간·반복·배속을 반영한 최종 출력 시간 |

배속이나 편집 길이 변경 시 출력 글자의 시간은 **한 번만** 비례 조정합니다.

브라우저 미리보기의 **출력 시간으로 이동**은 배속 후 출력 시계를 사용합니다.
부호 없는 초(`2.5`), `mm:ss(.소수)` 또는 `hh:mm:ss(.소수)`를 받으며 앞뒤 공백은
무시합니다. 콜론 뒤 항목의 정수 부분은 1–2자리이고 값은 0 이상 60 미만입니다.
소수는 마지막 초 항목에만 허용하며 첫 항목은 출력 길이 안에서 제한 없이 입력할
수 있습니다. 빈 값·부호·지수 표기·잘못된 형식·유한하지 않은 값·범위 밖 값은
거절하고 0과 정확한 출력 끝은 허용합니다. `.5` 대신 `0.5`를 쓰세요.
프레임 번호 형식은 아닙니다.

내부 재생 위치에는 입력 초에 배속을 곱해 전달하며 확인 시 일시 정지합니다.
프로젝트·미디어 원본·창이 바뀐 오래된 확인이나 작업 중·세션 미디어가 연결되지 않은 복구 상태에서는 이동하지
않습니다. 편집 명령이나 새 MCP 도구가 아니며 저장·실행 취소 기록을 만들지
않습니다. 출력 끝을 입력해도 네이티브 영상 탐색은 기존처럼 미디어 끝 직전으로
제한될 수 있으므로 정확한 마지막 프레임·오디오 샘플 표시를 보장하지 않습니다.

`title.update`는 기본 제목을 수정합니다. 구간별 제목이 나오는 시간에는 기본 제목이 숨겨집니다. 기존 구간별 문구는 `overlays.update`로 수정할 수 있습니다. 추가·삭제는 `overlays.add`/`overlays.remove`를 사용하며 카드끼리 겹치는 순서는 `overlays.move` 또는 UI의 맨 앞으로/맨 뒤로로 바꿉니다.

## 구성과 책임

| 구성 | 파일 | 역할 |
|---|---|---|
| 프로젝트 모델 | `dist/core/project.mjs` | 기본값, 저장 문서 v1, 상태 검증, 시간 기준, SRT/VTT/TXT |
| 편집 명령 | `dist/core/commands.mjs` | 입력 JSON Schema, 복사본 변경, 검증 후 결과 반환 |
| 공통 서비스 | `dist/integration/editor-service.mjs` | 명령 직렬 실행, 저장 포트, 공통 결과·오류, 미디어 작업 포트 |

### 사용자 인터페이스

| 구성 | 파일 | 역할 |
|---|---|---|
| 브라우저 | `dist/app.js`의 `window.moment` | 현재 프로젝트 접근, 실행 취소, 편집 중 상태 확인, 화면 갱신 |
| CLI | `cli/moment.mjs` | JSON 파일 읽기·쓰기, SRT/VTT/TXT 저장, 기존 파일 보호 |
| MCP 어댑터 | `dist/integration/mcp-adapter.mjs` | 명령을 도구 목록/호출 결과로 변환, 프로젝트별 서비스 조회 |

화면 비율·배속·기본 템플릿·트림·SRT/VTT/TXT 출력은 기존 UI도 공통 로직을 사용합니다. 타이틀/자막 등의 명령은 동일한 프로젝트 모델을 수정합니다. 미디어 디코딩·녹음·브라우저 인코딩은 기존 브라우저 구현에 남아 있습니다. 모든 화면 이벤트를 서버 코드로 옮긴 구조는 아닙니다.

## 명령 v1

`node cli/moment.mjs commands` 또는 브라우저의 `moment.describe()`에서 실제 입력 스키마를 읽을 수 있습니다.

### 읽기와 출력

| 명령 | 주요 입력 | 결과 |
|---|---|---|
| `timeline.list` | 선택 `offset`, `limit` | 구간 위치와 원본·편집·출력 시간 페이지 |
| `project.preview` | `operations` | 읽기 전용 편집 요약; 반영 여부·변경 필드·전후 개수/출력 길이 |
| `project.get` | 없음 | 편집 설정 문서 |
| `template.export` | `id`, `name` | 현재 구성의 `moment-template` 문서; 읽기 전용, 라이브러리 저장 아님 |
| `templates.list` | 없음 | 기본 템플릿 목록 |
| `template.inspect` | `templateId`, 선택 `withContent`(기본 false) | 적용 전 기본 템플릿 메타데이터·결과 문구/시간 읽기 |
| `captions.export` | 선택 `format: "srt"`, `"vtt"`, `"txt"` | 편집 구간·배속을 반영한 `{format, text}`; 기본 SRT |
| `captions.list` | 선택 `offset`, `limit` | 저장된 자막 페이지와 현재 배열 위치; 읽기 전용 |
| `captions.overlaps` | 선택 `limit` | 출력 시간 겹침의 읽기 전용 보고서; 자막 자동 수정 없음 |
| `captions.inspect` | `maxGraphemesPerSecond`, 선택 `limit` | 편집 후 표시 속도 초과 구간 요약; 프로젝트 변경 없음 |
| `render.plan` | `quality`, `format` | 출력 설정·프로젝트·필요한 미디어 목록; **파일 생성 아님** |

### 프로젝트와 템플릿 변경

| 명령 | 주요 입력 | 결과 |
|---|---|---|
| `project.update` | `patch` | 이름·비율·구도·배속·볼륨 수정 |
| `project.batch` | `operations` | 순차 편집 후 한 번 반영; `{updated, operationCount, outputDuration}` |
| `project.import` | `document` | 설정 교체 |
| `template.apply` | `templateId`, `withContent` | 기본 템플릿 적용 |
| `template.apply.document` | `document`, 선택 `withContent` | 내보낸 템플릿 적용; `{updated:true, outputDuration}` |

### 타임라인과 글자 변경

| 명령 | 주요 입력 | 결과 |
|---|---|---|
| `timeline.replace` | `clips: [{start,end}]` | 클립 구간/순서 교체 |
| `timeline.split` | `clipIndex`, `sourceTime` | 지정 클립 구간 분할; `{updated:true, outputDuration}` |
| `timeline.move` | `clipIndex`, `toIndex` | 최종 배열 위치로 이동; `{updated:boolean, outputDuration}` |
| `timeline.duplicate` | `clipIndex` | 선택 구간 바로 뒤에 복제; `{updated:true, outputDuration}` |
| `title.update` | `patch` | 기본 제목과 스타일 수정 |
| `credit.update` | `patch` | 출처 크레딧 수정; `{updated:true, outputDuration}` |
| `effects.update` | `patch` | 영상 효과 설정; `{updated:true, outputDuration}` |

### 시간별 카드 명령

| 명령 | 주요 입력 | 결과 |
|---|---|---|
| `overlays.update` | `id`, `patch` | 기존 시간별 카드 수정; `{updated:true, outputDuration}` |
| `overlays.add` | `id`, `patch` | 카드 하나 추가; `{updated:true, outputDuration, id}` |
| `overlays.remove` | `id` | 카드 하나 삭제; `{updated:true, outputDuration, id}` |
| `overlays.move` | `id`, `toIndex` | 카드 쌓임 순서 변경; `{updated, outputDuration, id, toIndex}` |

### 자막 변경

| 명령 | 주요 입력 | 결과 |
|---|---|---|
| `captions.replace` | `captions` | 대사 자막 교체 |
| `captions.insert` | `captionIndex`, `caption` | 지정 위치에 한 자막 추가; `{updated:true, captionIndex, totalCaptions, outputDuration}` |
| `captions.remove` | `captionIndex`, 선택 `count`(기본 1) | 지정 위치부터 연속 삭제; 같은 결과 형식, 삭제 전 시작 위치 반환 |
| `captions.update` | `captionIndex`, `patch` | 자막 하나 부분 수정; `{updated:true, outputDuration, captionIndex}` |
| `captions.merge` | `captionIndex` | 다음 저장 행과 병합; `{updated:true, outputDuration, mergedCaptionIndex}` |
| `captions.split` | `captionIndex`, `textOffset` | 지정 자막을 둘로 분할; `{updated:true, outputDuration, createdCaptionIndex}` |
| `captions.import` | `text`, `basis` | 전체 교체; `{updated:true, outputDuration, importedCaptions}` |
| `captions.text.replace` | `find`, `replacement` | 문구 모두 바꾸기; `{updated, matches, changedCaptions}` |
| `captions.style.update` | `patch` | 공통 자막 스타일; `{updated:true, outputDuration}` |
| `captions.timing.shift` | `basis`, `delta`, 선택 `captionIndex`, `count` | 시간 일괄 이동; `{updated, shiftedCaptions, outputDuration}` |

## 작업별 편집 예제

필요한 작업부터 골라 읽으세요. 각 예제의 시간 기준·교체 범위·재시도 주의사항을
함께 확인하고, 개별 입력 필드는 [명령 목록](#명령-v1)에서 찾으세요.

| 작업 | 예제 |
|---|---|
| 자막 | [시간 겹침](#자막-시간-겹침-점검) · [표시 속도 점검](#편집-후-자막-표시-속도-점검) · [가져오기](#srtvtt-본문을-명령으로-가져오기) · [커서 분할](#자막-하나를-커서-위치에서-분할) · [합치기](#인접한-자막-합치기) · [추가·삭제](#자막-하나-추가연속-범위-삭제) · [개별 수정](#자막-하나만-수정) · [문구 교정](#자막-문구-일괄-교정) · [시간 이동](#자막-시간을-앞뒤로-이동) · [스타일](#자막-스타일-수정) |
| 타임라인 | [클립 분할](#클립-구간-분할) · [클립 복제](#클립-구간-복제) |
| 구성 | [크레딧](#출처-크레딧-수정) · [영상 효과](#영상-효과-수정) · [카드 수정](#기존-시간별-카드-수정) · [카드 추가·삭제](#스크립트에-맞춰-카드-추가삭제) · [쌓임 순서](#카드-쌓임-순서-변경) |
| 묶음·템플릿 | [반영 전 요약](#편집-묶음의-반영-전-요약) · [한 번에 편집](#여러-편집을-한-번에-반영) · [기본 템플릿 점검](#기본-템플릿-적용-전-점검) · [템플릿 파일 관리](#개별-사용자-템플릿-파일) · [현재 구성 내보내기](#현재-구성을-템플릿으로-내보내기) · [파일 적용](#내보낸-템플릿을-climcp로-적용) |

### 편집 묶음의 반영 전 요약

`project.preview`는 `project.batch`와 같은 `operations` 1–20개를 복사본에 순서대로
검증하고 **반영하지 않은 요약**을 반환합니다. 현재 허용 편집 명령 24개와 개별 입력
스키마를 그대로 사용하며 읽기 명령·제공자 작업·중첩 묶음은 넣을 수 없습니다.

| 결과 | 의미 |
|---|---|
| `operationCount` | 입력 작업 수 |
| `wouldCommit` | 같은 묶음이 반영을 요청할지 여부; 최종 값의 차이 여부가 아님 |
| `changedFields` | JSON 내용이 달라진 알려진 최상위 프로젝트 필드(`templateId` 포함), 정렬된 배열; 전체 패치·문구·문서가 아님 |
| `before`, `after` | 각각 `{clipCount, captionCount, cardCount, outputDuration}`; 출력 길이는 배속 후 초 |

값을 바꿨다가 원래대로 돌리는 묶음은 `wouldCommit:true`, `changedFields:[]`일 수 있습니다.
시각 미리보기나 인코딩이 아니며 커밋·실행 취소·미디어 접근·제공자 호출을 하지 않습니다.
미디어 가용성·렌더링·실제 출력 가능 여부를 확인하는 검사도 아닙니다.
오류는 배치와 같은 코드와 작업 위치 경로를 유지합니다. 스냅샷 토큰·잠금·예약은 없으므로
후속 `project.batch`는 그때의 상태로 다시 검증합니다. 생성될 카드 ID도 예약하지 않습니다.

```sh
node cli/moment.mjs init --out preview-source.json
node -e "require('node:fs').writeFileSync('preview.args.json',JSON.stringify({operations:[{command:'project.update',arguments:{patch:{speed:2}}},{command:'credit.update',arguments:{patch:{text:'Source: Example',start:4,end:6}}}]}))"
node cli/moment.mjs exec project.preview --project preview-source.json --args-file preview.args.json --out preview-report.json
node cli/moment.mjs exec project.batch --project preview-source.json --args-file preview.args.json --out preview-edited.json
```

`preview-report.json`은 요약 보고서이지 복원할 프로젝트 문서가 아닙니다. 보고서를 확인한 뒤
필요할 때만 마지막 반영 명령을 실행하세요. `--dry-run`은 별도 CLI 파일 쓰기 억제 옵션이며,
이 읽기 전용 명령을 실행하기 위한 필수 옵션이 아닙니다. 반영 응답이 불확실하면 현재
문서를 다시 읽고 판단하며 미리보기 성공만 믿고 재시도하지 마세요.

### 여러 편집을 한 번에 반영

`project.batch`는 필수 `operations` 배열의 **1–20개 명령**을 복사본에 순서대로
준비·검증한 뒤 서비스가 한 번만 반영하도록 합니다. 중간 검증 실패는 앞선
편집도 실제 프로젝트에 반영하지 않습니다. 각 항목은 `{command, arguments}`이며
`arguments`는 해당 개별 명령의 입력 계약을 그대로 따릅니다.

| 규칙 | 의미 |
|---|---|
| 허용 명령 | 현재 스키마의 명시적 편집 명령 목록; `project.update`, 템플릿 적용, 타임라인·제목·크레딧·효과·카드·자막 수정 |
| 제외 | `project.import`, 읽기/출력 명령, 제공자 `jobs.*`, 중첩 `project.batch` |
| 순서 | 뒤 명령은 앞 명령을 적용한 복사본의 배열 인덱스·길이·시간 기준을 사용 |
| 성공 | `{updated, operationCount, outputDuration}`; `operationCount`는 입력 개수, 단계별 결과나 결과 참조 문법 없음 |
| 변경 없음 | 모든 단계가 자체적으로 변경 없음이면 `updated:false`, 커밋 없음. 빈 패치도 항상 무변경은 아님 |

실패 시 원래 오류 코드를 유지하며 `arguments.operations[1].arguments.patch`처럼
문제 단계의 0부터 시작하는 위치를 `error.path`에 표시합니다.
배속·구간 변경 뒤 카드 시간을 지정한다면 **변경 후 출력 시간**으로 계산하세요.
CLI의 `commands` 또는 MCP `tools/list`에서 개별 스키마와 허용 명령을 확인합니다.

```sh
node cli/moment.mjs init --out batch-source.json
node cli/moment.mjs exec project.batch --project batch-source.json --json '{"operations":[{"command":"project.update","arguments":{"patch":{"speed":2}}},{"command":"credit.update","arguments":{"patch":{"text":"Source: Example","start":4,"end":6}}}]}' --dry-run
node cli/moment.mjs exec project.batch --project batch-source.json --json '{"operations":[{"command":"project.update","arguments":{"patch":{"speed":2}}},{"command":"credit.update","arguments":{"patch":{"text":"Source: Example","start":4,"end":6}}}]}' --out batch-edited.json
```

12초 샘플이 6초 출력으로 바뀐 뒤 마지막 2초의 크레딧을 지정합니다. 두 번째
명령의 `end`를 `7`로 바꾸면 거절되며 원본 파일은 유지하고 새 출력 파일도
만들지 않습니다. `--dry-run`은 전체를 검증하지만 파일을 쓰지 않습니다.

이것은 **단일 명령 안의 편집 묶음**이지 JSON-RPC 요청 배열이 아닙니다. MCP는
`projectId:"session"`을 바깥 도구 인수에만 붙이며 내부 명령에는 넣지 않습니다.
브라우저 같은 페이지 API로 성공한 편집 묶음은 실행 취소 한 단계입니다. 새로운
UI 버튼이나 MCP 실행 취소 도구는 추가하지 않습니다.

사용자 정의 호스트는 저장 콜백의 원자성과 버전 충돌 검사를 여전히 책임집니다.
외부 저장소·여러 서비스 인스턴스까지 자동 트랜잭션으로 보호하지 않습니다.
커밋 중 오류나 응답 유실로 결과가 불명확하면 `project.get`으로 현재 문서를
확인한 뒤 복구하세요. 복제·분할 등이 포함된 묶음을 무조건 재시도하지 마세요.

### SRT/VTT 본문을 명령으로 가져오기

`captions.import`는 파일 경로가 아닌 SRT/VTT **본문 문자열**과 시간 기준을
받습니다. 기존 브라우저의 일반 자막 파서로 자막을 파싱하고 결과를 검증한 뒤 자막 배열을
한 번에 교체합니다. 기존 자막을 유지하려면 먼저 프로젝트를 보관하세요.

| 필수 입력 | 의미 |
|---|---|
| `text` | SRT/VTT 문자열; API 최대 100,000 UTF-16 코드 단위 |
| `basis:"source"` | 배속 적용 전 원본 영상의 초; 원본 영상 길이 기준 |
| `basis:"timeline"` | 배속 적용 전 편집 타임라인의 초; 클립 길이 합계 기준 |

**CLI/MCP 명령에는 출력 시계로 가져오는 옵션이 없습니다.** 편집·배속을 적용해 내보낸 SRT/VTT를
동일 프로젝트에 다시 넣는다고 원래 자막 상태가 복원되지 않습니다. 시간 기준을
직접 확인하며, 자동 역배속 변환이나 원본 구간 역매핑을 기대하지 마세요.
브라우저의 전용 파일 가져오기 창은 별도로 원본 미디어/편집된 출력을 명시적으로
선택합니다. 출력 모드는 현재 출력 길이로 파싱하고 잡아 둔 배속을 곱해 기존
`timeline` 자막으로 저장하지만, 이 동작을 명령의 `basis` 옵션으로 전달할 수는 없습니다.
반복 클립의 펼쳐진 구간·밀리초 반올림·누락 메타데이터 때문에 프로젝트 복원은 아닙니다.
**추가 오디오 오프셋은 출력 기준 자막을 가져오기 전에 설정하세요.** 기존 브라우저
오프셋 입력은 생성 출처와 무관하게 `basis:"timeline"` 자막 전체를 이동하므로 새로
가져온 자막도 영향을 받습니다. 실수했다면 오프셋 편집 전체를 실행 취소하세요.
클립 변경이 가져온 자막을 자동으로 다시 맞추지는 않습니다.

파서는 선택한 기준 길이까지 끝 시간을 자르고, 범위 밖이거나 유효한 양수 길이가
없는 구간을 제외합니다. 마크업은 제거하고 알려진 문자 참조는 한 번만 해석합니다.
화자·스타일·키워드 메타데이터는 가져오지 않습니다. 빈 파일이나 유효 자막이
없는 입력은 기존 자막을 유지하며 오류를 반환합니다. 완전한 SRT/WebVTT 규격
검사기는 아니며 잘못된 개별 구간을 건너뛸 수 있습니다.

| 한도 | 명령과 브라우저의 차이 |
|---|---|
| CLI/MCP 본문 | 공통 JSON 입력 검증에 따라 100,000 UTF-16 코드 단위 |
| 브라우저 자막 파일 | 기존 UTF-8 2 MiB 한도 유지 |
| 공통 파서 | 10,000개 자막, 구간당 2,000 UTF-16 코드 단위; 전체 UTF-8 2 MiB |

### SRT 파일을 명령 인수로 감싸기

현재 폴더의 `captions.srt`가 원본 시계 기준이라고 확인한 경우의 POSIX 셸 예제입니다.
`project.json`은 편집할 기존 프로젝트입니다. VTT도 같은 방식으로 본문을 읽습니다.

```sh
node --input-type=module <<'JS'
import { readFile, writeFile } from 'node:fs/promises';
const bytes = await readFile('captions.srt');
if (bytes.byteLength > 2 * 1024 * 1024) throw new Error('Subtitle exceeds 2 MiB');
const text = new TextDecoder('utf-8', {fatal:true}).decode(bytes);
if (text.length > 100000) throw new Error('API subtitle text exceeds 100,000 UTF-16 code units');
await writeFile('captions-import.args.json', JSON.stringify({text, basis:'source'}), {flag:'wx'});
JS
node cli/moment.mjs exec captions.import --project project.json --args-file captions-import.args.json --dry-run
node cli/moment.mjs exec captions.import --project project.json --args-file captions-import.args.json --out captioned.json
```

SRT/VTT 파일 자체를 `--args-file`에 전달하지 마세요. 인수 파일은 `{text, basis}`
JSON이며 명령은 파일을 읽거나 미디어를 업로드하지 않습니다. 성공 응답은
프로젝트 문서가 아닌 `{updated:true, outputDuration, importedCaptions}`입니다.
`importedCaptions`는 적용된 자막 수이며 MCP는 변경 후 `moment_project_get`
문서를 별도로 저장해야 합니다.

### 클립 구간 분할

`timeline.split`은 클립 목록 전체를 다시 보내지 않고 지정한 구간 하나를
둘로 나눕니다. 먼저 `project.get`으로 현재 `clips`와 순서를 확인하세요.

| 필드·조건 | 의미 |
|---|---|
| `clipIndex` | 필수 정수 0–999; 현재 클립 배열의 0부터 시작하는 위치 |
| `sourceTime` | 필수 유한 숫자 0–86,400; 트림·배속 적용 전 **원본 영상의 초** |
| 분할 위치 | 해당 클립 내부이며 앞뒤 각각 최소 0.1초 확보 |
| 용량 | 이미 1,000개면 거절; 기존 구간 삭제 등 의도한 편집 후 재시도 |

같은 원본 범위를 반복 사용해도 `clipIndex`로 지정한 **그 위치의 구간만**
분할합니다. 원본 시간으로 어느 반복 구간인지 추측하지 않습니다. 입력 오류나
용량 초과는 변경 없이 거절합니다.

```sh
node cli/moment.mjs init --out split-source.json
node cli/moment.mjs exec project.get --project split-source.json
node cli/moment.mjs exec timeline.split --project split-source.json --json '{"clipIndex":0,"sourceTime":6}' --out split.json
```

위 예제는 기본 12초 샘플을 6초에서 나눕니다. 다른 프로젝트에는 시간을
그대로 재사용하지 말고 구간을 확인하세요. 순서·전체 길이·배속과 원본 자막
배열·제목·시간별 문구의 시간을 유지하며 별도 비례 조정하지 않습니다.
분할 경계를 가로지르는 원본 자막은 출력에서 인접한 두 구간으로 나뉠 수
있으므로 **SRT/VTT 바이트가 이전과 같다는 뜻은 아닙니다.** 기존 UI 분할과
동일한 동작이며 UI에서는 한 번에 실행 취소할 수 있습니다.

### 타임라인 구간과 시간 나눠 조회

분할·이동·복제 전에 `timeline.list`로 현재 구간 위치와 시간 기준을 읽으세요.

| 입력·결과 | 계약 |
|---|---|
| `offset`, `limit` | 선택 정수 0–1,000 / 1–50; 기본 0 / 20 |
| `totalClips`, `offset`, `limit`, `speed` | 현재 총 구간 수·적용 범위·프로젝트 배속 |
| `nextOffset` | 더 있으면 다음 위치, 끝이면 null; 현재 끝 이상은 빈 clips/null |
| `clips[].clipIndex` | 현재 0기반 배열 위치; 같은 원본 반복도 별개 |
| `sourceStart`, `sourceEnd` | 배속 전 원본 초 |
| `timelineStart`, `timelineEnd` | 재생 누적 순서에 따른 배속 전 편집 초 |
| `outputStart`, `outputEnd` | 편집 구간 시간을 배속으로 나눈 출력 초 |

총 길이 필드·자막 본문·미디어는 반환하지 않습니다. 잘못된 값·null·알 수 없는 인수는
`INVALID_ARGUMENT`입니다. 읽기 전용이며 문서·저장·기록을 바꾸지 않고 배치에도 넣지
않습니다. 다음 예제는 같은 파일을 유지하며 `nextOffset`이 null이 될 때까지 읽습니다.

```sh
node cli/moment.mjs init --out timeline-source.json
node cli/moment.mjs exec timeline.split --project timeline-source.json --json '{"clipIndex":0,"sourceTime":6}' --out timeline-two.json
node --input-type=module <<'JS'
import {execFileSync} from 'node:child_process';
let offset=0;
do {
  const result=JSON.parse(execFileSync(process.execPath,
    ['cli/moment.mjs','exec','timeline.list','--project','timeline-two.json',
     '--json',JSON.stringify({offset,limit:1})],{encoding:'utf8'}));
  console.log(result.data.clips);
  offset=result.data.nextOffset;
} while(offset!==null);
JS
```

각 요청은 실시간 현재 상태를 읽으며 스냅샷이 아닙니다. 편집·불확실한 응답 뒤에는
다시 읽고, 위치를 안정된 ID로 취급하지 마세요. 누적 합은 기존 재생 순서의 일반
부동소수점 계산으로 아주 작은 파생 구간 폭이 수치상 사라질 수도 있습니다. 프레임·
샘플 정확도나 전역 시간 계산 변경을 뜻하지 않습니다. 페이지는 응답량을 제한하지
실행 비용이 페이지 크기에만 비례한다고 보장하지 않습니다. 선택 `--out`은 페이지
보고서만 저장하며 프로젝트 백업이 아닙니다. MCP는 `moment_timeline_list`에
`projectId:"session"`을 추가합니다. MCP 커서 페이징과는 다른 일반 명령 인수입니다.

### 클립을 지정한 위치로 이동

`timeline.move`는 현재 `clips`의 한 구간을 **최종 배열 위치**로 옮깁니다.
먼저 `project.get`으로 현재 순서를 읽으세요. 같은 원본 범위가 반복되어도 각 배열
위치는 별개이며 안정된 클립 ID가 아닙니다.

| 입력·결과 | 계약 |
|---|---|
| `clipIndex`, `toIndex` | 필수 정수 0–999, 두 위치 모두 현재 배열 안에 있어야 함 |
| 목적지 | 삭제 전 삽입 지점이 아닌 이동 후 최종 위치 |
| 결과 | `{updated:boolean,outputDuration}`; 같은 위치면 false, 반영·기록 없음 |
| 보존 | 구간 원본 범위·자막 배열/메타데이터·오디오 오프셋·제목/크레딧/카드 시간 수치 |
| 실패 | 잘못된 위치는 `INVALID_ARGUMENT`; 일부만 이동하지 않음 |

```sh
node cli/moment.mjs init --out move-source.json
node cli/moment.mjs exec timeline.replace --project move-source.json --json '{"clips":[{"start":0,"end":4},{"start":4,"end":8},{"start":8,"end":12}]}' --out move-three.json
node cli/moment.mjs exec project.get --project move-three.json
node cli/moment.mjs exec timeline.move --project move-three.json --json '{"clipIndex":0,"toIndex":2}' --out move-result.json
```

구간 길이를 추가·삭제하지 않으며 출력 레이어 시간을 다시 비례 조정하지 않습니다. 원본 자막은
재배치한 원본 구간을 따라 나타나며 타임라인 자막은 기존 배속 전 시간을 유지합니다.
명령에 UI 선택·재생 기능은 없습니다. CLI 변경에는 `--out` 또는 `--dry-run`이 필요하며
결과 파일은 전체 프로젝트 문서입니다. MCP는 `moment_timeline_move`에
`projectId:"session"`을 더하고, 성공 후 `project.get`으로 저장할 문서를 읽습니다.
배치에서는 앞 작업이 만든 현재 배열 위치를 사용합니다. 응답이 불확실하면 다시
조회하세요. 무조건 재시도하면 다른 구간을 옮길 수 있습니다.

### 클립 구간 복제

`timeline.duplicate`는 현재 `clips` 배열의 구간을 복사해 **바로 뒤**에 넣습니다.
필수 `clipIndex`는 기존 위치를 가리키는 0–999 정수입니다. 같은 원본을 반복
사용해도 위치로 구분하므로 먼저 `project.get`으로 배열을 확인하세요.
미디어 파일은 복사하지 않으며 클립별 별도 효과도 만들지 않습니다.

```sh
node cli/moment.mjs init --out repeat-source.json
node cli/moment.mjs exec project.get --project repeat-source.json
node cli/moment.mjs exec timeline.duplicate --project repeat-source.json --json '{"clipIndex":0}' --out repeated.json
```

기본 샘플은 12초에서 24초가 됩니다. 기존 프로젝트에서는 선택 구간 길이와
배속으로 증가량이 결정됩니다. 없는 위치나 이미 1,000개인 배열은
`INVALID_ARGUMENT`로 거절하며 프로젝트는 그대로입니다.

| 함께 달라지는 것 | 동작 |
|---|---|
| 원본 기준 자막 | 새 구간에서도 나타남; 저장된 자막 배열 자체를 복제하지 않음 |
| 타임라인 기준 자막 | 배속 전 절대 시간을 유지; 새 위치에 자동 복제·밀어내기 없음 |
| 제목·크레딧·시간별 카드 | 기존 타임라인 교체 규칙대로 출력 길이에 비례해 시간 조정; `null` 끝점은 유지 |
| 배속·미디어·오디오 오프셋·공통 효과 | 유지 |

UI의 복제는 새로 넣은 구간을 선택하고 그 시작 위치로 이동하며, 한 번에 실행
취소합니다. MCP에는 선택·재생 위치·실행 취소 기능이 없고, 성공 결과
`{updated:true, outputDuration}` 확인 후 `project.get`으로 문서를 저장해야 합니다.
응답을 놓치면 현재 배열부터 확인하세요. 무조건 재시도하면 구간이 다시 늘어납니다.

### 저장된 자막을 나눠 조회

`captions.list`는 전체 문서 대신 필요한 **작성 자막**만 읽습니다. 출력에서 반복된
구간이 아니라 현재 배열 순서이며, Unicode·화자·키워드·추정 시간 표시를 그대로
돌려줍니다. 없는 `basis`도 추가하지 않습니다(원본 기준). 시간은 배속 전입니다.

| 입력·결과 | 계약 |
|---|---|
| `offset` | 정수 0–10,000, 기본 0 |
| `limit` | 정수 1–50, 기본 20 |
| `totalCaptions`, `offset`, `limit` | 현재 총 자막 수와 적용한 조회 범위 |
| `captions[]` | `{captionIndex, caption}`; 현재 배열 위치와 분리된 원본 자막 사본 |
| `nextOffset` | 더 있으면 `offset + 반환 개수`, 끝이면 `null` |

현재 자막 수를 넘는 유효한 offset은 빈 배열과 `null`을 반환합니다. 호출마다 현재
상태를 읽으므로 스냅샷·고정 버전·안정된 ID가 아닙니다. 합치기·나누기·교체 후에는
다시 조회하세요. 응답량만 제한하며 실행 비용이 페이지 크기에만 비례하지는 않습니다.
읽기 전용이며 `project.batch`에는 넣을 수 없습니다.

표시 속도 검사 → 보고된 위치 주변 조회 → 해당 자막 수정 순서로 사용합니다.
아래 코드는 데모 파일을 만들고, 문제가 없으면 수정하지 않습니다. 기준 `1`은 추천
규격이 아니라 예제입니다. 저장 경로가 이미 있으면 CLI가 거절합니다.

```sh
node cli/moment.mjs init --out caption-review.json
node --input-type=module <<'JS'
import {execFileSync} from 'node:child_process';
const run=(command,args,extra=[])=>JSON.parse(execFileSync(process.execPath,
  ['cli/moment.mjs','exec',command,'--project','caption-review.json',
   '--json',JSON.stringify(args),...extra],{encoding:'utf8'})).data;
const issue=run('captions.inspect',{maxGraphemesPerSecond:1,limit:1}).issues[0];
if(issue) {
  console.log(run('captions.list',{offset:Math.max(0,issue.captionIndex-1),limit:3}));
  run('captions.update',{captionIndex:issue.captionIndex,patch:{text:'짧은 문장'}},
    ['--out','caption-reviewed.json']);
}
// 같은 파일을 변경하지 않는 동안 페이지를 차례로 읽습니다.
let offset=0;
do {
  const page=run('captions.list',{offset,limit:20});
  console.log(page.captions);
  offset=page.nextOffset;
} while(offset!==null);
JS
```

직접 호출: `node cli/moment.mjs exec captions.list --project caption-review.json --json '{"offset":0,"limit":20}'`.
선택 `--out caption-page.json`은 **페이지 결과**만 저장하며 프로젝트 설정 문서가
아니므로 `project.import`에 사용할 수 없습니다. `--dry-run`은 읽기 결과를 preview에도
추가하고 파일을 쓰지 않습니다. MCP에서는 같은 인수에 `projectId:"session"`을 넣습니다.

### 자막 시간 겹침 점검

`captions.overlaps`는 편집·반복·원본/타임라인 기준·배속을 반영한 출력 자막끼리의
양수 시간 겹침을 검사합니다. 끝과 시작이 맞닿기만 하면 겹침이 아닙니다. 화면 표시
우선순위나 실제 문구 가시성을 예측하지 않으며 자막을 자동으로 수정하지 않습니다.

| 입력·결과 | 계약 |
|---|---|
| `limit` | 선택 정수 1–100, 기본 20; null·알 수 없는 필드·잘못된 값은 `INVALID_ARGUMENT` |
| `metric` | `"output-time-overlap"` |
| `totalOccurrences` | 편집 후 전체 파생 자막 수 |
| `flaggedOccurrences`, `omittedOccurrences` | 하나 이상과 겹치는 파생 자막의 정확한 수 / 표시 한도로 생략한 수; 쌍의 개수 아님 |
| `issues[]` | 각 겹친 자막당 대표 충돌 하나; 원본/출력 위치와 양쪽 구간·교집합, 문구 없음 |

순위가 아닌 출력 발생 순서로 반환하며 모든 충돌 쌍을 나열하지 않습니다. 앞서 나온
최대 끝점 자막을 대표로 사용하고 동률은 기존 순서를 유지합니다. 아직 표시하지 않은
대표 자막에는 처음 만난 뒤쪽 충돌을 연결합니다. [정확한 필드 목록](docs/MCP.md#check-caption-time-overlaps)을
확인하세요. 시간은 배속 후 출력 초, 위치는 현재 배열/파생 구간 기준이므로 편집 뒤
다시 검사해야 합니다. 기존 파생 10,000개·원문 UTF-8 2 MiB 한도는 유지됩니다.
읽기 전용으로 저장·실행 취소 기록을 만들지 않으며 `project.batch`에 넣을 수 없습니다.

```sh
node cli/moment.mjs init --out overlap-source.json
node cli/moment.mjs exec captions.insert --project overlap-source.json --json '{"captionIndex":1,"caption":{"start":1,"end":2,"text":"Overlap example"}}' --out overlap-demo.json
node cli/moment.mjs exec captions.overlaps --project overlap-demo.json --json '{"limit":20}'
node cli/moment.mjs exec captions.list --project overlap-demo.json --json '{"offset":0,"limit":3}'
```

선택 `--out overlap-report.json`은 보고서만 저장하며 프로젝트 백업이 아닙니다.
MCP 도구는 `moment_captions_overlaps`, 추가 인수는 `projectId:"session"`입니다.

### 편집 후 자막 표시 속도 점검

`captions.inspect`는 자르기·반복·배속을 반영한 **출력 구간**마다 공백을 제외한
문자소 수를 표시 초로 나눕니다. 편집 뒤 확인용이며 문구·시간·실행 취소 기록을
바꾸지 않습니다. 기준값은 호출자가 정해야 하며 기본 추천 수치는 없습니다.

| 입력 | 계약 |
|---|---|
| `maxGraphemesPerSecond` | 필수 유한한 양수; 이를 초과한 구간을 보고 |
| `limit` | 정수 `1..100`, 생략하면 `20`; 가장 높은 비율부터 보고할 최대 구간 수 |

```sh
node cli/moment.mjs init --out inspect-source.json
node cli/moment.mjs exec captions.inspect --project inspect-source.json --json '{"maxGraphemesPerSecond":5,"limit":10}'
```

`5`는 호출 방법을 보여 주는 예시이지 권장 기준이나 언어별 합격선이 아닙니다.
`Intl.Segmenter` 문자소 중 전부 공백인 것만 빼며 구두점·원문 마크업은 셉니다.
공백뿐인 문구는 0으로 계산해 초과하지 않습니다. 화면 맞춤·실제 읽기 능력·음성
정렬·Netflix 등 자막 규격 준수나 SRT/VTT 출력 가능 여부를 판정하지 않습니다.

| 결과 필드 | 의미 |
|---|---|
| `metric`, `maxGraphemesPerSecond` | `"non-whitespace-graphemes-per-second"`와 요청 기준값 |
| `totalOccurrences`, `flaggedOccurrences`, `omittedOccurrences` | 전체·반올림하지 않은 기준 초과·보고 한도로 생략된 초과 구간 수 |
| `issues[].occurrenceIndex`, `captionIndex`, 선택 `clipIndex` | 0부터 시작하는 출력 시작순 발생 위치·작성 자막 위치·원본 클립 위치; 타임라인 자막에는 `clipIndex` 없음 |
| `issues[].start`, `end`, `graphemeCount`, `graphemesPerSecond` | 배속 후 출력 시간·문자소 수·반올림하지 않은 비율 |

상위 `issues`는 요청한 `limit`개까지만 반환하며,
비율 내림차순, 출력 시작 오름차순, 발생 인덱스 오름차순입니다. 보고 한도에
걸려 생략된 문제도 있으므로 상위 목록만 보고 전체가 해결됐다고 판단하지 마세요.
원문 전체를 응답에 넣지 않습니다. 작성 자막 인덱스로 `project.captions`를 조회하되
반복 출력 구간은 독립적으로 편집 가능한 자막이 아닙니다.

기존 파생 10,000구간·반복 원문 UTF-8 2 MiB 한도는 그대로 적용합니다. 유효하지
않은 파생 표시 길이·비율이나 안전한 문자소 구분을 할 수 없는 환경은
`INVALID_ARGUMENT`, 파생 구간·바이트 초과는 `CAPTION_OUTPUT_LIMIT`로 거절합니다.
읽기 명령이므로 `project.batch`에 넣지 말고 편집 묶음 이후 별도로 호출하세요.

브라우저에서는 자막 도구의 **읽기 속도 검사**를 열고 양수 기준을 직접 입력합니다.
기준값은 빈칸으로 시작하며 보고 한도는 높은 비율 순 **20구간**으로 고정합니다.
전체·초과·생략 수를 함께 확인하세요. **자막**은 창을 닫고 해당 작성 행의 페이지와
초점만 옮깁니다. **구간 보기**는 재생을 일시 정지하고 해당 출력 발생 구간의
시작으로 이동한 뒤 작성 행에 초점을 둡니다. 반복 구간도 정확히 그 발생 위치를
사용하며, 독립된 자막으로 새로 만드는 것은 아닙니다.

프로젝트나 입력 기준값이 바뀐 오래된 결과로는 이동하지 않고 재검사를 요구합니다. 작업 중·세션 미디어가 연결되지 않은 복구
차단 상태의 보호도 유지합니다. 검사·결과 이동은 문구·시간·저장·실행 취소 기록을
바꾸지 않습니다. CLI/MCP의 같은 검사는 보고서만 반환하며 이 브라우저 창이나
재생 위치를 제어하지 않습니다.


### 자막 하나를 커서 위치에서 분할

`captions.split`은 저장된 자막 하나를 지정한 문구 위치에서 둘로 나눕니다.
먼저 `project.get`의 `project.captions`에서 행과 원문을 확인하세요. 긴 자막을
전체적으로 나누는 기존 UI 작업과는 별도이며 음성·단어별 정렬은 하지 않습니다.

| 필수 입력·조건 | 의미 |
|---|---|
| `captionIndex` | 정수 `0..9999`; 현재 저장 배열의 기존 행 |
| `textOffset` | 정수 `1..1999`; 원문 내부의 **UTF-16 코드 단위 위치** |
| 분할 경계 | `Intl.Segmenter`가 구분한 문자소 경계여야 함; 이모지·결합 문자 내부는 거절 |
| 양쪽 문구 | 원문 그대로 분리, 공백 제거 없음; 어느 한쪽이라도 공백뿐이면 거절 |
| 용량 | 이미 10,000행이면 거절; 부분 변경 없음 |

문자소 경계인지 검증하지만 `textOffset` 자체는 문자소 번호가 아닙니다. JS
문자열 인덱스나 textarea 커서 위치와 같은 단위입니다. 양쪽에 메타데이터를
유지하고 `timing:"estimated"`를 표시합니다. 첫 시작·마지막 끝은 유지하며 내부
시간은 양쪽 문자소 수에 비례해 추정합니다. 분할 문구에 공백이 남으면 그 공백도
문자소 수에 포함됩니다. `Intl.Segmenter`가 없으면 안전하지 않은 대체 분할 대신
거절합니다. 계산한 내부 시간이 부동소수점 정밀도 때문에 원래 시작·끝
사이에 놓이지 못해도 거절하며 별도의 최소 초 단위는 강제하지 않습니다.

```sh
node cli/moment.mjs init --out cue-split-source.json
node cli/moment.mjs exec captions.replace --project cue-split-source.json --json '{"captions":[{"start":1,"end":12,"text":"Hello world"}]}' --out cue-split-ready.json
node cli/moment.mjs exec captions.split --project cue-split-ready.json --json '{"captionIndex":0,"textOffset":6}' --out cue-split.json
```

예제는 샘플 자막을 의도적으로 교체한 뒤 `Hello `와 `world`로 분할하며 경계는
7초입니다. 실제 프로젝트에서는 교체 없이 현재 행·문구를 조회하세요. 실패는
`INVALID_ARGUMENT`이며 기존 프로젝트를 유지합니다. 성공 결과의
`createdCaptionIndex`는 바로 뒤에 추가한 둘째 행의 위치입니다.

원본 기준 자막은 교차하는 편집 구간마다 파생될 수 있고 타임라인 기준은 배속 전
시계를 유지합니다. 짧은 구간은 SRT/VTT 밀리초 반올림에서 길이가 0이 되어 출력이
거절될 수 있으며 기존 빈 줄·바이트·파생 구간 한도도 그대로입니다. 응답을 놓치면
배열부터 확인하세요. 같은 요청 재시도는 이미 나눈 행을 다시 나눌 수 있습니다.
UI에서는 선택 범위가 아닌 커서 하나를 두고 **나누기**를 누르면 둘째 행에 초점을 옮기고
한 번에 실행 취소합니다. MCP에는 실행 취소가 없으므로 이전 문서를 보관하세요.

### 인접한 자막 합치기

`captions.merge`는 `project.captions`의 지정 행과 **바로 다음 저장 행**을
합칩니다. 출력에서 파생된 반복 구간이나 화면 페이지의 위치가 아닙니다.
먼저 `project.get`으로 현재 배열을 확인하세요.

| 조건 | 동작 |
|---|---|
| `captionIndex` | 필수 정수 `0..9998`; 해당 행과 다음 행이 모두 있어야 함 |
| 시간·메타데이터 | 같은 시간 기준·화자·키워드, `다음.start >= 첫.end`; 생략된 기준은 `source`, 화자·키워드는 빈 문자열로 비교 |
| 문구 | 원문 두 개 사이 ASCII 공백 하나 삽입; 최대 2,000 UTF-16 코드 단위, 자동 다듬기 없음 |
| 결과 구간 | 첫 시작부터 둘째 끝까지; 사이에 빈 시간이 있으면 그 시간에도 합친 문구 표시 |

잘못된 위치·겹침·역순·메타데이터 차이·길이 초과는 `INVALID_ARGUMENT`로 전체
거절합니다. 첫 행의 메타데이터를 유지하며 둘 중 하나가 추정 시간이라면 병합
결과도 `timing:"estimated"`입니다. 단어별 시간 정렬을 하는 기능이 아닙니다.

```sh
node cli/moment.mjs init --out merge-source.json
node cli/moment.mjs exec captions.replace --project merge-source.json --json '{"captions":[{"start":1,"end":2,"text":"Hello"},{"start":2,"end":3,"text":"world"}]}' --out merge-ready.json
node cli/moment.mjs exec captions.merge --project merge-ready.json --json '{"captionIndex":0}' --out merged.json
```

이 예제는 새 샘플의 자막을 의도적으로 두 행으로 교체한 뒤 `Hello world`로
합칩니다. 실제 자막을 유지하려면 교체 단계를 실행하지 말고 현재 인덱스를
조회하세요. 원본 기준의 병합 문구는 해당 원본과 겹치는 각 편집 구간에서
반복될 수 있으며 타임라인 기준은 절대 시간을 유지합니다. 원문 줄바꿈을 그대로
연결하므로 SRT/VTT의 빈 줄 제한이나 기존 출력 바이트·파생 구간 한도가 별도로
적용됩니다. 병합 성공이 모든 형식의 출력 성공을 보장하지는 않습니다.

성공 결과는 `{updated:true, outputDuration, mergedCaptionIndex}`입니다. 응답을
놓치면 배열을 다시 읽으세요. 같은 인덱스로 재시도하면 그다음 행까지 합칠 수
있습니다. UI의 **다음 자막과 합치기**는 페이지 경계도 처리하며 합친 행에 초점을
유지하고 한 번에 실행 취소합니다. MCP에는 실행 취소가 없으므로 이전 문서를 보관하세요.

<a id="자막-하나를-추가하거나-삭제"></a>

### 자막 하나 추가·연속 범위 삭제

`captions.list`로 현재 위치를 확인한 뒤 `captions.insert` / `captions.remove`를
사용하세요. 전체 배열을 다시 보내지 않으며, 다른 자막의 순서·시간은 바꾸지 않습니다.

| 명령·필드 | 계약 |
|---|---|
| insert `captionIndex` | 정수 0부터 현재 개수까지; 개수와 같으면 마지막에 추가 |
| insert `caption` | 필수 `start`, `end`, `text`; 선택 `basis`, `speaker`, `keywords`, `timing` |
| insert 자막 시간 | `0 <= start < end`, 원본 길이 또는 `basis:"timeline"`의 배속 전 편집 길이 이하; 끝점 86,400초 이하 |
| 문구·메타데이터 | text 최대 2,000 UTF-16 코드 단위(빈 값 허용), speaker `""`/`"0"`/`"1"`, keywords 최대 500, timing은 `"estimated"`만 |
| 시간 기준 | basis 생략 또는 `"source"`는 원본; `"timeline"`은 편집 타임라인. 출력 기준이 아님 |
| remove `captionIndex` | 현재 존재하는 0부터 시작하는 위치 |
| remove `count` | 선택 정수 1..10,000, 기본 1; `captionIndex + count <= 현재 개수`. 전체 삭제하여 빈 배열 가능 |
| 한도·결과 | 최대 10,000개; `{updated:true, captionIndex, totalCaptions, outputDuration}` |

잘못된 위치·삭제 범위 또는 삽입 한도·자막 스키마·시간 위반은 `INVALID_ARGUMENT`로 거절하며 일부만 반영하지 않습니다.
자동 정렬·다른 자막 시간 이동은 없습니다. 빈 문구가 저장 가능하다고 SRT/VTT 출력까지
보장되지는 않습니다. 삭제 결과의 `captionIndex`는 **삭제 전 시작** 위치입니다.
삭제는 작성 배열의 연속 범위에만 적용하며 현재 타임라인 밖의 생존 자막도 그대로
보존합니다. 범위를 초과한 요청은 줄여서 적용하지 않고 전체 거절합니다.

```sh
node cli/moment.mjs init --out cue-source.json
node cli/moment.mjs exec captions.list --project cue-source.json --json '{"offset":0,"limit":3}'
node cli/moment.mjs exec captions.insert --project cue-source.json --json '{"captionIndex":1,"caption":{"start":1,"end":2,"text":"추가한 자막","basis":"source"}}' --out cue-added.json
node cli/moment.mjs exec captions.remove --project cue-added.json --json '{"captionIndex":1}' --out cue-removed.json
node cli/moment.mjs exec captions.remove --project cue-added.json --json '{"captionIndex":0,"count":2}' --out cue-range-removed.json
node cli/moment.mjs exec project.batch --project cue-source.json --json '{"operations":[{"command":"captions.remove","arguments":{"captionIndex":0}},{"command":"captions.insert","arguments":{"captionIndex":0,"caption":{"start":0,"end":2,"text":"새 첫 자막"}}}]}' --out cue-batch.json
```

두 명령은 `project.batch`의 순차 현재 배열에 적용됩니다. 위 배치는 첫 자막을 삭제한
**다음** 상태의 0번 위치에 삽입합니다. 배치 허용 편집 명령은 24개지만 한 요청의 작업
수는 여전히 최대 20개이며, 하나라도 실패하면 전체가 반영되지 않습니다.
CLI 변경에는 `--out` 또는 `--dry-run`이 필요합니다. 출력 파일은 조회 페이지가 아니라
전체 프로젝트 문서이며 기존 파일은 기본 보호됩니다. MCP는 성공 확인 후 `project.get`으로
문서를 따로 저장합니다. 삽입·삭제는 재시도에 안전한 명령이 아닙니다. 응답이 불확실하면
`captions.list`로 다시 확인하세요. 무조건 재시도하면 중복 삽입하거나 다른 자막을 삭제합니다.

### 자막 하나만 수정

`captions.update`는 현재 `project.captions`의 한 행에서 지정한 필드만 바꿉니다.
먼저 `project.get`으로 대상 문구와 배열 위치를 확인하세요. `captionIndex`는
0부터 시작하는 기존 위치(`0..9999`)이며 안정적인 ID나 출력 발생 인덱스가 아닙니다.

| 필수 `patch` 안의 선택 필드 | 계약 |
|---|---|
| `text` | 최대 2,000 UTF-16 코드 단위; 빈 문자열도 허용 |
| `speaker` | `""`, `"0"`, `"1"`; 빈 문자열은 화자 지정 해제 |
| `keywords` | 최대 500 UTF-16 코드 단위 문자열; 빈 문자열 허용 |
| `start`, `end` | 유한한 `0..86400`초; 기존 자막의 시간 기준, **배속 적용 전** |

`basis`와 `timing`은 이 패치로 변경할 수 없습니다. 다른 메타데이터·순서·자막과
프로젝트 필드는 유지합니다. 시간 필드를 하나라도 보내면 최종 `0 <= start < end`
및 기존 기준의 길이(원본 길이 또는 배속 전 편집 길이) 이내인지 검사합니다.
문구만 바꾸면 기존에 유효하지만 현재 길이 밖에 있는 시간은 자동 조정하지 않습니다.
빈 문구도 편집은 가능하지만 SRT/VTT 출력 제한을 우회하지는 않습니다.

```sh
node cli/moment.mjs init --out cue-edit-source.json
node cli/moment.mjs exec project.get --project cue-edit-source.json
node cli/moment.mjs exec captions.update --project cue-edit-source.json --json '{"captionIndex":0,"patch":{"text":"나만의 속도로 시작해요","speaker":"0","keywords":"속도"}}' --out cue-edited.json
```

성공 결과는 `{updated:true, outputDuration, captionIndex}`이며 전체 문서는 별도
조회합니다. 빈·같은 패치도 일반 수정처럼 `updated:true`일 수 있습니다. 잘못된
위치·필드·시간은 `INVALID_ARGUMENT`로 변경 없이 거절합니다. `project.batch`에도
넣을 수 있지만 앞선 분할·합치기로 인덱스가 달라졌다면 그 변경 후 위치를 써야 합니다.
오래된 인덱스를 안전한 ID로 취급하거나 다른 작성자와의 충돌 방지를 기대하지 마세요.

### 자막 문구 일괄 교정

`captions.text.replace`는 자막 문구만 바꾸고 시간·`basis`·화자·키워드·순서를 유지합니다. 모든 결과를 검증한 뒤 한 번만 반영합니다.

| 항목 | 규칙 |
|---|---|
| 입력 | `find`, `replacement` 필수; 각각 최대 2,000 UTF-16 코드 단위, `find`는 빈 문자열 불가 |
| 일치 | 대소문자를 구분하는 일반 문자열; 겹치지 않는 일치만 계산, 정규식·Unicode 정규화 없음 |
| 결과 | `{updated:boolean, matches:number, changedCaptions:number}`; 전체 문서가 아님 |
| 변경 없음 | 일치 없음 또는 동일한 대체 문구이면 `updated:false`; 저장 반영·실행 취소 이력 추가 없음 |

빈 `replacement`는 허용하지만, 바뀐 자막이 `trim()` 후 비거나 2,000 UTF-16 코드 단위를 넘으면 **전체 변경을 거절**합니다. 문구를 조용히 삭제하거나 잘라내지 않습니다. 구간 삭제는 UI의 개별/범위 삭제 또는 `captions.remove`를 사용하세요. 제목·크레딧·시간별 문구는 이 명령의 대상이 아닙니다.

```sh
node cli/moment.mjs exec captions.text.replace --project edited.json --json '{"find":"하루","replacement":"하루의 기록"}' --dry-run
node cli/moment.mjs exec captions.text.replace --project edited.json --json '{"find":"하루","replacement":"하루의 기록"}' --out corrected.json
```

`matches`는 일치 횟수, `changedCaptions`는 실제 문구가 바뀐 자막 수입니다. 동일한 문구로 바꾸면 일치가 있어도 변경 수는 0입니다. CLI에서 저장한 출력 파일은 편집 프로젝트 문서이며, 변경 없음 응답도 파일 쓰기 자체를 금지하는 뜻은 아닙니다. UI에서는 미리 표시한 개수를 확인하고 모두 바꾸며, 반영된 변경은 한 번에 실행 취소합니다. MCP에는 실행 취소 도구가 없으므로 이전 문서를 보관하세요.

### 자막 시간을 앞뒤로 이동

`captions.timing.shift`는 작성 배열 범위를 고른 뒤 선택한 시간 기준의 자막 시작·끝에
같은 값을 더합니다. 범위를 생략하면 기존처럼 전체 배열에서 해당 기준을 처리하며,
현재 페이지나 검색 결과로 자동 제한하지 않습니다.

| 필수 입력 | 의미 |
|---|---|
| `basis:"source"` | 원본 영상 시계; `basis`가 생략된 기존 자막도 포함 |
| `basis:"timeline"` | 편집 타임라인 시계; 클립 길이 합계 기준 |
| `delta` | 유한한 부호 있는 초; 양수는 늦게, 음수는 일찍. 두 기준 모두 **배속 적용 전** |

| 선택 범위 | 대상 작성 행 (0부터 시작) |
|---|---|
| 둘 다 생략 | 전체 배열 |
| `captionIndex`만 | 해당 위치부터 마지막까지 |
| `count`만 | 처음부터 N개 |
| 둘 다 | 해당 위치부터 정확히 N개 |

명시한 `captionIndex`는 현재 존재하는 0..9,999 정수이고 `count`는 1..10,000 정수입니다.
범위 초과·빈 배열의 명시 범위는 줄여서 적용하지 않고 거절하며 `delta:0`이어도 먼저
검증합니다. 범위를 고른 **뒤** `basis`로 필터링하며 시간 기준을 변환하지 않습니다.
`count`는 기준이 일치하는 개수가 아닌 작성 행 수이므로 실제 이동 수는 더 작을 수 있습니다.
선택하지 않은 행은 바꾸지 않습니다.

이동 결과 하나라도 기준 길이 밖이거나 양수 길이 구간이 아니면 전체를 거절합니다.
기존 자막 끝점의 86,400초 상한도 적용합니다.
범위에 맞추려고 시간을 자르거나 자막을 삭제하지 않으며, 끝점의 미세한 부동소수점 오차만 보정합니다. 문구·화자·키워드·기준·순서와
다른 프로젝트 설정은 유지하며 오디오 오프셋도 바꾸지 않습니다. 원본 시계의
이동은 자르기 경계를 넘을 수 있어 출력에 보이는 구간이 달라질 수 있습니다.

```sh
node cli/moment.mjs init --out shift-source.json
node cli/moment.mjs exec captions.import --project shift-source.json --json '{"basis":"source","text":"1\n00:00:01,000 --> 00:00:02,000\nHello\n"}' --out shift-ready.json
node cli/moment.mjs exec captions.timing.shift --project shift-ready.json --json '{"basis":"source","delta":0.25}' --dry-run
node cli/moment.mjs exec captions.timing.shift --project shift-ready.json --json '{"basis":"source","delta":0.25}' --out shifted.json
node cli/moment.mjs exec captions.replace --project shift-source.json --json '{"captions":[{"start":1,"end":2,"text":"First"},{"start":3,"end":4,"text":"Second"},{"start":5,"end":6,"text":"Third"}]}' --out range-ready.json
node cli/moment.mjs exec captions.timing.shift --project range-ready.json --json '{"basis":"source","delta":0.25,"captionIndex":1}' --out tail-shifted.json
node cli/moment.mjs exec captions.timing.shift --project range-ready.json --json '{"basis":"source","delta":0.5,"captionIndex":1,"count":1}' --out range-shifted.json
```

성공 결과는 `{updated, shiftedCaptions, outputDuration}`이며 `shiftedCaptions`는
실제 시간이 바뀐 자막 수입니다. 0초 이동이나
해당 기준의 자막이 없으면 `updated:false`, `shiftedCaptions:0`이며 편집을
반영하지 않습니다. CLI에서 명시한 출력 파일 쓰기와는 별개입니다.
브라우저의 기존 전체 이동 또는 **자막 범위 시간 이동…**을 사용합니다. 범위 창은
양끝 포함 1부터 시작하는 작성 행 번호를 받고 해당 범위에서 기준을 필터링합니다.
현재 페이지 첫 행·원본 기준·0초로 시작하며 API의 0부터 시작하는 위치와 구별하세요.
기준·부호 있는 초를 정하고 적용하며 실제 변경은
한 단계 실행 취소됩니다. 자동 음성 동기화·속도 보정이 아닌 일정 시간 이동이고
MCP에는 실행 취소 도구가 없으므로 이전 프로젝트를 보관하세요.

### 자막 스타일 수정

`captions.style.update`는 기존 화면의 공통 자막 스타일을 CLI/MCP에서도 수정합니다. 새 UI나 개별 자막 스타일을 추가하는 명령이 아닙니다. 모든 자막에 적용되는 설정이며 개별 문구·시간·화자 배정은 유지합니다.

| `patch` 필드 | 허용 값 |
|---|---|
| `style` | `impact`, `accent`, `highlight`, `minimal` |
| `captionSize` | 10–120; 캔버스 너비 540 기준 크기 |
| `captionX`, `captionY` | 각각 캔버스 너비·높이의 0–1 비율 |
| `captionColor`, `captionAccent` | `#RRGGBB` 또는 `#RRGGBBAA` |
| `captionStroke` | 0–20; 캔버스 너비 540 기준 두께 |
| `captionItalic` | boolean |
| `captionAnimation` | `none`, `fade`, `slide`, `pop` |
| `speakerLabels` | 정확히 2개 문자열, 각각 최대 80 UTF-16 코드 단위; 빈 문자열 허용, 공백 자르지 않음 |
| `speakerColors` | 정확히 2개 `#RRGGBB` 또는 `#RRGGBBAA` 색상 |

`patch`는 필수이고 내부 필드는 모두 선택입니다. 빈 `{}`도 허용하며 표준 수정 응답 `{updated:true, outputDuration}`을 반환합니다. `captions.text.replace`의 변경 없음 감지와 같은 계약은 아닙니다. 전달하지 않은 필드는 그대로 두며, **`style`만 바꿔도 화면 프리셋의 기울임·외곽선 기본값을 함께 적용하지 않습니다.** 필요하면 해당 필드를 명시하세요.

```sh
node cli/moment.mjs exec captions.style.update --project corrected.json --json '{"patch":{"captionSize":48,"captionY":0.72,"captionColor":"#FFFFFF"}}' --dry-run
node cli/moment.mjs exec captions.style.update --project corrected.json --json '{"patch":{"captionSize":48,"captionY":0.72,"captionColor":"#FFFFFF"}}' --out styled.json
```

화자 배열을 보내면 해당 두 슬롯을 함께 교체하며 보내지 않은 다른 배열은 유지합니다.
색상 대소문자·알파값도 보존하고 잘못된 배열/값은 `INVALID_ARGUMENT`로 거절합니다. 인덱스 0/1은 기존 자막의 화자 배정에
대응하며 이름을 바꿔도 새 화자를 감지하거나 자막을 재배정하지 않습니다. 기존 대화 UI의
이름·색상을 전체 프로젝트 가져오기 없이 수정하는 경로입니다.

```sh
node cli/moment.mjs init --out speakers-source.json
node cli/moment.mjs exec captions.style.update --project speakers-source.json --json '{"patch":{"speakerLabels":["Host","Guest"],"speakerColors":["#FFFFFF","#B5FF00"]}}' --out speakers-edited.json
```

**화면 적용:** 글자 크기와 외곽선은 캔버스 너비에 비례해 확대·축소하며 글자가 영역을 넘으면 맞춤 처리로 더 작아질 수 있습니다. `highlight`는 어두운 글자·강조색 상자·외곽선 없음으로 표시합니다. 그 외에는 지정 화자 색상이 우선하고, 화자가 없으면 `accent` 스타일은 `captionAccent`, 나머지는 `captionColor`를 사용합니다. 따라서 `captionColor` 수정이 화자·강조 스타일 색상을 덮어쓰지는 않습니다. `highlight`에서도 화자 이름 표시는 해당 화자 색상을 사용합니다.

스타일은 프로젝트 JSON과 영상 화면에 적용하며 일반 SRT/VTT/TXT에는 화자 이름·색상을 기록하지 않습니다. 이 명령은 영상을 인코딩하지 않으며 `render.plan`도 계속 계획만 반환합니다.

### 출처 크레딧 수정

`credit.update`는 `design.credit`에서 지정한 필드만 바꾸며 제목·대사 자막·카드는
유지합니다. 크레딧은 영상의 시각 요소이며 SRT/VTT/TXT에는 들어가지 않습니다.
필수 `patch` 안에 필요한 항목만 넣으세요.

| 필드 | 허용 값 / 의미 |
|---|---|
| `text` | 최대 100 UTF-16 코드 단위; 빈 문자열도 허용 |
| `enabled`, `italic` | 불리언; 숨기기에는 `enabled:false` |
| `color` | `#RRGGBB` 또는 `#RRGGBBAA` |
| `x`, `y` | 화면 너비·높이 기준 정규화 좌표 `0..1` |
| `size` | `10..120`; 화면에 맞춰 배율·자동 맞춤 적용, 고정 픽셀 크기 아님 |
| `start`, `end` | **배속 적용 후** 출력 초; `end:null`이면 출력 끝까지 |

시간 필드를 하나라도 보내면 최종 `start`는 `0 <= start < outputDuration`,
`end`는 `null` 또는 `start < end <= outputDuration`이어야 합니다. 별도의
86,400초 상한은 없습니다. 내용만 바꾸면 기존의 유효하지만 현재 출력 밖인
시간은 자동 조정하지 않습니다. 잘못된 입력은 `INVALID_ARGUMENT`로 전체 거절합니다.
빈·동일한 패치도 일반 수정 명령처럼 `{updated:true, outputDuration}`를 반환하며
커밋할 수 있으므로 변경 없음 응답으로 해석하지 마세요.

아래 새 샘플은 12초이므로 마지막 2초에 출처를 표시합니다. 기존 프로젝트는
먼저 `render.plan`의 `output.duration`을 읽고 시간 범위를 계산하세요.

```sh
node cli/moment.mjs init --out credit-source.json
node cli/moment.mjs exec render.plan --project credit-source.json
node cli/moment.mjs exec credit.update --project credit-source.json --json '{"patch":{"text":"Source: Example","enabled":true,"start":10,"end":12}}' --out credited.json
```

### 영상 효과 수정

`effects.update`는 기존 렌더러의 효과 설정 중 전달한 필드만 바꿉니다. 클립·
배속·자막·카드·제목·오디오와 그 시간은 변경하지 않습니다. `patch`는 필수이며
빈 객체도 표준 `{updated:true, outputDuration}` 응답으로 처리합니다.

| 색상·화면 필드 | 허용 값 |
|---|---|
| `brightness` | 0.7–1.3; 기본 1 |
| `contrast` | 0.7–1.5; 기본 1 |
| `saturation` | 0–1.6; 기본 1 |
| `vignette` | 0–0.6; 기본 0 |

| 움직임·경계 필드 | 허용 값 |
|---|---|
| `motion` | `none`, `in`, `out`; 기본 `none` |
| `strength` | 0–0.4; 기본 0.12 |
| `transition` | `none`, `fadeBlack`, `flash`; 기본 `none` |
| `transitionDuration` | 출력 시간 0.05–0.7초; 기본 0.2 |

| 진행 표시 필드 | 허용 값 |
|---|---|
| `progress` | boolean; 기본 `false` |
| `progressPosition` | `top`, `bottom`; 기본 `bottom` |
| `progressColor` | `#RRGGBB` 또는 `#RRGGBBAA`; 기본 `#b5ff00` |

```sh
node cli/moment.mjs init --out effects-source.json
node cli/moment.mjs exec effects.update --project effects-source.json --json '{"patch":{"brightness":1.1,"contrast":1.05}}' --dry-run
node cli/moment.mjs exec effects.update --project effects-source.json --json '{"patch":{"brightness":1.1,"contrast":1.05}}' --out effects-edited.json
```

**경계 효과는 교차 전환이 아닙니다.** 각 클립의 시작·끝에 검정(`fadeBlack`)
또는 흰색(`flash`)을 덧씌우며 두 영상을 겹치지 않습니다. 실제 효과 길이는
해당 클립 출력 길이의 절반 이하로 제한됩니다. 느린 줌은 `in`이면 1배에서
`1 + strength`배로, `out`이면 그 반대로 변하며 기존 구도 줌에 곱해집니다.

별도 초기화 명령은 없습니다. 필요한 필드에 위 기본값을 명시하세요. 이 명령은
편집 설정만 수정하며 영상 인코딩을 실행하지 않고 SRT/VTT에 효과를 넣지 않습니다.

### 기존 시간별 카드 수정

`overlays.update`는 `project.get` 문서의 `project.overlays`에서 찾은 정확한
`id`와 필수 `patch`를 받습니다. ID는 공백뿐인 값이 아닌 최대 2,000 UTF-16
코드 단위 문자열입니다. 해당 카드가 없으면 `NOT_FOUND`이며 새로 만들지
않습니다. 추가·삭제·순서 변경·ID 변경 명령이 아닙니다.

| 문구·종류 필드 | 허용 값 |
|---|---|
| `text`, `detail`, `label` | 각각 최대 2,000 UTF-16 코드 단위 |
| `kind`, `role` | `card`/`countdown`, `headline`/`free` |
| `presentation`, `animation` | `plain`/`panel`, `none`/`fade`/`slide`/`pop` |
| `enabled` | boolean |

| 모양 필드 | 허용 값 |
|---|---|
| `color`, `accent`, `background` | `#RRGGBB` 또는 `#RRGGBBAA` |
| `x`, `y`, `width` | 각각 0–1 |
| `size`, `stroke` | 10–120, 0–20 |
| `backgroundOpacity` | 0–1 |

**시간은 배속 적용 후 출력 초입니다.** `start`, `end`는 0 이상의 유한 숫자이며
둘 중 하나라도 보내면 최종 `0 <= start < end <= outputDuration`을 검사합니다.
일률적인 86,400초 상한은 없습니다. 문구만 바꾸면 기존의 유효한 프로젝트에
남아 있는 출력 범위 밖 카드 시간을 자동으로 자르거나 조정하지 않습니다.

브라우저의 카드 모양 복사·붙여넣기는 같은 `overlays.update`를 사용합니다.
원본 카드에서 **스타일 복사**를 누른 뒤 대상 카드의 **스타일 붙여넣기**를 누르세요.

| 복사 범위 | 필드 |
|---|---|
| 포함 | `color`, `accent`, `background`, `size`, `stroke`, `backgroundOpacity`, `presentation`, `animation` |
| 제외 | `width`, `x`, `y`, `role`, `kind`, `enabled`, `text`, `detail`, `label`, `start`, `end`, `id` |

복사 시점의 스냅샷이므로 원본 수정·삭제는 복사본을 바꾸지 않습니다. 운영체제
클립보드나 영구 저장소를 사용하지 않으며 같은 편집기에서 프로젝트를 바꿔도
유지하지만 새로 고치면 사라집니다. 복사 전에는 붙여넣기가 비활성화됩니다. 붙여넣기는
작업 중 보호를 따르고 대상의 나머지 필드를 유지하며 실제 변경을 실행 취소 한
단계로 반영합니다. 같은 스타일이면 변경·실행 취소 기록을 만들지 않습니다.
새 CLI/MCP 도구는 없습니다. 자동화에서는 원본의 위 8개 필드만 골라 기존
`overlays.update`의 대상 ID와 `patch`에 전달하세요. 전체 카드를 복사하면 의도하지
않은 문구·시간·배치까지 바꿀 수 있습니다.

### 스크립트에 맞춰 카드 추가·삭제

먼저 `project.get`으로 현재 카드 ID와 출력 길이를 확인하세요. `overlays.add`는
필수 `id`와 `patch:{text,start,end,...}`를 받아 기존 카드 뒤에 한 개를 추가합니다.
스타일 옵션은 위 `overlays.update` 표와 같고 생략하면 기존 UI의 새 카드 기본값을
사용합니다. 일반 `headline` 카드이며 위치 0.47/0.16, 폭 0.78, 크기 34,
외곽선 3, `slide` 등장 효과를 기본으로 합니다.

| 작업 | 경계와 오류 |
|---|---|
| 추가 ID | 공백뿐이 아닌 최대 2,000 UTF-16 코드 단위; 동일 ID는 `INVALID_ARGUMENT`, 덮어쓰기 없음 |
| 추가 시간 | 필수 `start`, `end`는 배속 적용 후 출력 초; `0 <= start < end <= outputDuration` |
| 용량 | 비활성 카드를 포함해 최대 12개; 가득 차면 `INVALID_ARGUMENT`, 변경 없음 |
| 삭제 ID | 비어 있지 않은 정확한 기존 ID; 기존 공백 ID도 그대로 지정 가능, 없으면 `NOT_FOUND` |

아래 예제는 새 12초 샘플에 도입·핵심·마무리를 추가하고 마무리 카드를 삭제해
보는 완전한 파일 작업입니다. 기존 프로젝트라면 이름이 충돌하지 않는 ID와
실제 출력 길이에 맞는 시간을 사용하세요.

```sh
node cli/moment.mjs init --out story-source.json
node cli/moment.mjs exec project.get --project story-source.json
node cli/moment.mjs exec overlays.add --project story-source.json --json '{"id":"hook","patch":{"text":"세 가지 팁","start":0,"end":2}}' --out story-hook.json
node cli/moment.mjs exec overlays.add --project story-hook.json --json '{"id":"tip","patch":{"text":"핵심부터 간단히","start":2,"end":8}}' --out story-tip.json
node cli/moment.mjs exec overlays.add --project story-tip.json --json '{"id":"cta","patch":{"text":"직접 시도해 보세요","start":8,"end":12}}' --out story.json
node cli/moment.mjs exec overlays.remove --project story.json --json '{"id":"cta"}' --out story-without-cta.json
```

**응답을 놓치면 추가부터 반복하지 마세요.** 같은 세션의 `project.get`으로
지정한 ID가 실제 추가되었는지 확인한 뒤 재시도하거나 `overlays.update`를
사용합니다. ID는 추가 때마다 바꾸는 임시값이 아니라 요청을 확인할 기준입니다.
삭제 후 나머지 순서와 자막·기본 제목·효과·클립·미디어는 유지합니다.
겹치는 headline은 마지막 활성 카드가 우선하며 기본 제목을 가릴 수 있습니다.
위 예제는 명령마다 따로 반영합니다. 모두 함께 검증·반영하려면 `project.batch`로 묶으세요.

### 카드 쌓임 순서 변경

`overlays.move`는 기존 ID의 카드를 배열의 **최종 위치** `toIndex`로 옮깁니다.
`0`은 맨 뒤, `project.overlays.length - 1`은 맨 앞이며 비활성 카드도 위치에 포함합니다.
위 예제의 `story.json`에서 첫 카드를 세 카드 중 맨 앞으로 옮기려면:

```sh
node cli/moment.mjs exec overlays.move --project story.json --json '{"id":"hook","toIndex":2}' --out story-stacked.json
```

이동은 시간·문구를 바꾸지 않습니다. 겹치는 `free` 카드는 배열 순서대로 그리며,
`headline`은 마지막 활성 카드만 표시합니다. 자막·기본 제목 등 다른 종류의
레이어와의 순서를 바꾸는 기능은 아닙니다. UI의 **맨 앞으로 / 맨 뒤로**도 같은
카드 배열만 바꾸며 선택을 유지합니다.

| 확인할 것 | 동작 |
|---|---|
| `id` | 비어 있지 않은 정확한 기존 ID, 최대 2,000 UTF-16 코드 단위; 기존 공백 ID도 가능. 없으면 `NOT_FOUND`, 현재 `project.overlays`를 다시 조회 |
| `toIndex` | `0` 이상, 카드 수 미만인 정수; 범위 밖이면 `INVALID_ARGUMENT`, 변경 없음 |
| 이미 같은 위치 | `updated:false`; 커밋·브라우저 실행 취소 기록 없음 |
| 응답을 놓침 | 현재 ID와 배열 순서를 다시 읽고 목적 위치를 확인한 뒤 재시도 |

성공 결과는 `{updated, id, toIndex, outputDuration}`입니다. MCP에서는 별도
`project.get`으로 문서를 읽어 저장하세요. 카드 간 상대 순서 외에는 유지합니다.

### 실제 카드 ID를 조회하는 CLI 예제

```sh
node cli/moment.mjs init --out cards-source.json
node cli/moment.mjs exec template.apply --project cards-source.json --json '{"templateId":"recipe","withContent":true}' --out cards.json
node cli/moment.mjs exec project.get --project cards.json
node --input-type=module <<'JS'
import { readFile, writeFile } from 'node:fs/promises';
const document = JSON.parse(await readFile('cards.json', 'utf8'));
const card = document.project.overlays[0];
if (!card) throw new Error('No existing card to edit');
await writeFile('card-edit.args.json', JSON.stringify({id:card.id, patch:{text:'준비부터 시작해요'}}), {flag:'wx'});
JS
node cli/moment.mjs exec overlays.update --project cards.json --args-file card-edit.args.json --out cards-edited.json
```

예제는 첫 카드를 선택하지만 실제 요청에서는 조회한 내용과 ID로 의도한 카드를
고르세요. 다른 카드·기본 제목·자막·미디어·클립은 유지하며 빈 `patch`도 표준
`{updated:true, outputDuration}` 응답을 반환합니다.

**화면 동작:** 활성 `headline` 카드는 기본 제목을 가릴 수 있으며 여러 개가
겹치면 배열에서 마지막 활성 headline이 표시됩니다. 크기·외곽선 단위는
`min(너비/540, 높이/960)`으로 확대·축소하고 글자 맞춤 처리가 추가됩니다.
위치는 안전 영역에 맞추며, `width:0`은 기존 0.78 기본 폭으로 처리하고 최대
표시 폭은 캔버스의 0.82입니다. 저장한 숫자가 고정 출력 픽셀을 뜻하지 않습니다.

## 기본 템플릿 적용 전 점검

`templates.list`로 ID를 찾고 `template.inspect`에 `{templateId,withContent?}`를
보내세요. `templateId`는 최대 100 UTF-16 코드 단위 문자열이고 `withContent`는 선택 불리언(기본 `false`)입니다. 현재 프로젝트 복사본에 기존
`template.apply`를 적용해 검증한 **결과 문구·출력 시간**을 읽으며 실제 적용은 하지 않습니다.

| 결과 필드 | 내용 |
|---|---|
| `template` | `id`, `name`, `category`, `tag`, `description`, `flow`, `exampleTitle`, `reference` (`{title,url}` 또는 null) |
| `withContent`, `outputDuration` | 사용한 내용 교체 옵션과 배속 후 출력 초 |
| `title` | `{lines,enabled,start,end}` |
| `credit` | `{text,enabled,start,end}` |
| `cards` | 최대 12개 `{index,role,text,detail,label,enabled,start,end}`; 배열 순서, 생성 ID 제외 |

시간은 **배속 후 출력 초**이며 제목/크레딧의 미지정 끝은 null을 유지합니다.
`false`는 작성한 제목·크레딧·카드 문구를 유지하지만 템플릿의 시각 설정·해당 시간은
달라질 수 있습니다. `true`는 예시 내용으로 교체할 결과를 보여줍니다. 기본 카탈로그와
참조 정보는 한국어 원문이며 작성한 내용도 번역하지 않습니다. 알 수 없는 ID는 `NOT_FOUND`입니다.

```sh
node cli/moment.mjs init --out inspect-source.json
node cli/moment.mjs exec template.inspect --project inspect-source.json --json '{"templateId":"recipe","withContent":true}' --out inspect-report.json
node cli/moment.mjs exec template.apply --project inspect-source.json --json '{"templateId":"recipe","withContent":true}' --out inspect-applied.json
```

보고서를 검토한 뒤 필요할 때만 마지막 적용 명령을 실행하세요. `--out`은 요약 보고서를
저장하며 프로젝트 백업이나 `moment-template` 파일이 아닙니다. 전체 스타일·자막·클립·
미디어는 반환하지 않습니다. 렌더링·실제 표시 여부·원본 동일성 검사가 아니며 커밋·기록·
제공자 호출·브라우저 라이브러리 저장을 하지 않습니다. 상태나 생성 ID를 예약하지 않아
후속 적용은 현재 프로젝트로 다시 검증합니다. 읽기 전용이므로 `project.batch`에 넣지 않습니다.

## 개별 사용자 템플릿 파일

브라우저 갤러리는 사용자 템플릿 한 개를 JSON으로 내보내고 가져올 수 있습니다.
프로젝트 JSON, 라이브러리 전체 백업, CLI/MCP의 기본 템플릿 목록과는 별도입니다.

| 항목 | 계약 |
|---|---|
| 문서 | `{format:"moment-template", formatVersion:1, template:{...}}` |
| 입력 | UTF-8 JSON, 파일 시작 BOM 하나 허용, BOM 포함 최대 256 KiB(262,144바이트) |
| 검증 | 지원 형식·버전과 템플릿 구조·중첩 스타일 검증 |
| 가져오기 | 현재 라이브러리에 새 고유 ID로 추가, 카테고리 `내 템플릿`, 최대 20개 |
| 현재 구성으로 갱신 | 명시적 확인 시 기존 사용자 템플릿 하나를 교체; ID·이름·카테고리·즐겨찾기 유지, 20개에서도 가능 |

갤러리에서 가져올 파일을 선택하면 현재 라이브러리에 **복사본을 추가할 뿐**,
기존 템플릿·즐겨찾기·현재 프로젝트를 덮어쓰거나 자동 적용하지 않습니다.
미리보기 후 스타일만 적용 또는 예시 내용까지 적용을 선택하세요.

**갱신은 파일 가져오기와 다릅니다.** 사용자 템플릿 카드의 **현재 구성으로 업데이트**에서 덮어쓰기를 확인하면
그 확인 시점의 프로젝트 구성으로 스타일·설정·제목/크레딧·시간별 카드와 상대
시간 정보를 저장합니다. 기존 ID를 유지하므로 즐겨찾기도 그대로이며 현재
프로젝트·미디어·다른 프로젝트를 수정하거나 자동 적용하지 않습니다. 이전 버전이
필요하면 먼저 해당 템플릿을 내보내세요. 취소·검증/저장 실패는 기존 라이브러리를
유지하고 저장 실패 후 다시 시도할 수 있습니다. 갱신 결과도 개별 템플릿의
엄격한 구조·256 KiB 한도를 검증하며, 삭제된 대상은 다시 만들지 않습니다. CLI/MCP에는 브라우저 라이브러리
갱신 도구가 없으며, `template.apply.document`는 파일의 구성을 프로젝트에 적용하는
반대 방향의 작업입니다.

**공유 범위:** 스타일과 저장된 제목·크레딧·시간별 문구·공통 키워드·화자 이름을
포함할 수 있습니다. 영상·오디오 원본은 포함하지 않으며 전체 프로젝트 문서도
아닙니다. 미디어가 없다는 이유로 파일에 개인정보가 없다고 판단하지 마세요.

| 실패·경합 | 처리와 복구 |
|---|---|
| 잘못된 형식·버전·UTF-8·중첩 스타일 또는 크기 초과 | 라이브러리와 프로젝트 유지; 지원 파일을 다시 선택 |
| 사용자 템플릿 20개 | 추가 거절; 필요한 템플릿을 먼저 보관한 뒤 의도한 항목만 삭제 |
| 저장 실패 | 기존 라이브러리와 프로젝트 유지; 저장소 문제를 해결한 뒤 다시 시도 |
| 연속 파일 선택 | 가장 최근 선택한 요청만 적용 가능; 읽기가 끝난 뒤에도 현재 용량 재확인 |

가져오기 중 다른 템플릿이 추가되어도 이전 라이브러리 스냅샷으로 덮어쓰지
않습니다. CLI/MCP의 `templates.list`는 계속 기본 템플릿만 반환합니다. 내보낸
문서를 현재 프로젝트에 적용하려면 아래 `template.apply.document`를 사용하세요.
이 명령도 브라우저 라이브러리를 읽거나 저장하지 않습니다.

### 템플릿 문서 검증 예제

아래 예제는 저장소 루트에서 실행하며 메모리에서 문서를 생성·검증합니다.
파일이나 브라우저 라이브러리에 쓰지 않습니다. 가져올 때의 ID 재발급과
라이브러리 추가는 별도의 브라우저 가져오기 흐름이 담당합니다.

```sh
node --input-type=module <<'JS'
import { createDemoProject } from './dist/core/project.mjs';
import { saveCustomTemplate } from './dist/template-catalog.mjs';
import { createTemplateDocument, readTemplateDocument } from './dist/template-library.mjs';
const template = saveCustomTemplate('공유 예시', createDemoProject());
const document = createTemplateDocument(template);
const restored = readTemplateDocument(JSON.parse(JSON.stringify(document)));
console.log({format: document.format, version: document.formatVersion, name: restored.name});
JS
```

이 함수들은 파싱된 JSON 객체를 검증합니다. 파일 바이트·UTF-8 검사는 브라우저
파일 읽기 단계의 책임이며, 이미 파싱한 객체에 검증 함수를 호출했다고 파일
인코딩까지 검증한 것은 아닙니다. 내보내는 JSON은 들여쓰기 2칸을 사용하며
그 결과도 256 KiB 이하여야 합니다. 따라서 압축된 입력 파일이 한도 안이어도
정규 출력 형태가 한도를 넘으면 가져오기를 거절합니다.

## 현재 구성을 템플릿으로 내보내기

읽기 전용 `template.export`로 현재 프로젝트 구성을 개별 템플릿 문서로 만듭니다.
프로젝트·브라우저 라이브러리·실행 취소 기록을 바꾸지 않으며 배치에는 넣을 수 없습니다.

| 항목 | 계약 |
|---|---|
| `id` | 필수, 공백뿐이면 거절, 최대 200 UTF-16 코드 단위; 입력 그대로 보존, 기본 템플릿 ID와 충돌 불가 |
| `name` | 필수, 다듬기 전 최대 40 UTF-16 코드 단위; 양 끝 공백 제거 후 빈 이름 거절, 자동 자르기 없음 |
| 반환 문서 | `{format:"moment-template",formatVersion:1,template}`; 기존 형식·버전 사용 |
| 내용 | 시각 설정·제목·크레딧·카드·전역 강조어·화자 이름/색상; 대사 자막·클립 목록·미디어 제외 |
| 시간 | 기존 캡처 규칙으로 출력 길이에 상대화; 카드 범위 자르기·범위 밖 제외·시작 시간순 정렬, 제목/크레딧 null 끝점 유지 |
| 한도·실패 | 들여쓴 UTF-8 JSON 최대 256 KiB; 잘못된 인수·템플릿 검증은 `INVALID_ARGUMENT` |

```sh
node cli/moment.mjs exec template.export --project project.json --json '{"id":"custom-my-style","name":"My style"}' --out my-style.moment-template.json
```

`--out`은 응답 봉투가 아닌 템플릿 문서를 저장합니다. 이 출력은 한도와 동일한
들여쓴 JSON이며 **마지막 줄바꿈을 덧붙이지 않습니다**. 기존 파일은 기본 보호되므로
별도 경로를 쓰세요. 프로젝트·라이브러리 전체 백업이 아니며 공유 전 저장된 문구를
확인해야 합니다. 적용은 `template.apply.document`를 사용하고 `{document,withContent}`로
감싸세요. [실행 가능한 전체 CLI·서비스 예제](docs/MCP.md#export-the-current-composition-as-a-template)를
참고하세요. MCP 이름은 `moment_template_export`이며 `projectId:"session"`도 필요합니다.

## 내보낸 템플릿을 CLI/MCP로 적용

`template.apply.document`는 전달받은 `moment-template` 문서를 현재 프로젝트에
적용합니다. 기본 템플릿 ID를 받는 `template.apply`와 다르며, 브라우저
라이브러리에 복사본을 추가하는 가져오기와도 다릅니다.

| 입력·결과 | 계약 |
|---|---|
| `document` | 필수 전체 `{format:"moment-template", formatVersion:1, template:{...}}` 문서 |
| `withContent` | 선택 boolean, 기본 `false` |
| 성공 | `{updated:true, outputDuration}`; 저장할 프로젝트 문서는 별도 조회 |
| 검증 | 지원 버전·알려진 필드·중첩 스타일, 들여쓰기 JSON 기준 256 KiB 제한 |

**`false`도 시각 설정은 바꿉니다.** 제목 줄·크레딧 문구·기존 카드·대사 자막은
유지하지만 디자인·제목/크레딧 시간·효과·공통 키워드·화자 이름과 색상은
템플릿 설정을 적용합니다. `true`는 제목·크레딧·카드 내용도 교체하며, 대사
자막은 교체하지 않습니다.

기존 사용자 템플릿 시간 규칙을 그대로 사용합니다. `relativeTiming:true`이면
제목·크레딧 시간을 현재 출력 길이에 맞추고, 내용까지 적용할 때는 저장된
정규화 카드 시간을 현재 출력 길이로 변환합니다. 임의로 시간을 다시 조정하지
마세요. 적용한 문서의 ID는 프로젝트 `templateId`가 되며 새 ID를 발급하거나
브라우저 라이브러리에 저장하지 않습니다.

### 내보낸 파일에서 명령 인수 만들기

아래 POSIX 셸 예제는 현재 폴더의 `shared-template.json`과 `project.json`을
사용합니다. 인수 파일을 새로 만들고 결과는 별도 프로젝트 파일로 저장합니다.

```sh
node --input-type=module <<'JS'
import { readFile, writeFile } from 'node:fs/promises';
const bytes = await readFile('shared-template.json');
if (bytes.byteLength > 256 * 1024) throw new Error('Template exceeds 256 KiB');
const document = JSON.parse(new TextDecoder('utf-8', {fatal:true}).decode(bytes));
await writeFile('apply-template.args.json', JSON.stringify({document, withContent:false}), {flag:'wx'});
JS
node cli/moment.mjs exec template.apply.document --project project.json --args-file apply-template.args.json --dry-run
node cli/moment.mjs exec template.apply.document --project project.json --args-file apply-template.args.json --out templated.json
```

**템플릿 파일을 그대로 `--args-file`에 넣지 마세요.** 명령 인수는 템플릿
문서를 `document`로 감싼 객체여야 합니다. MCP에도 파일 경로가 아닌 파싱한
문서를 `document`에 전달합니다. 명령 자체는 파일을 읽거나 미디어를 올리지
않습니다. 잘못된 문서는 프로젝트 변경 전에 거절하며 원본 파일을 보존하세요.

## UI 언어와 프로젝트 데이터

브라우저 UI는 `ko`, `en`, `zh-CN`을 지원합니다. 저장한 선택 → 지원되는
브라우저 언어 → 한국어 순서로 시작 언어를 정하며, 언어 저장 실패 시 현재 세션의
전환은 유지해도 새로 고친 뒤 선택은 유지되지 않을 수 있습니다.

언어는 화면 표시 설정이며 프로젝트 JSON 스키마나 편집 명령의 입력이 아닙니다.
전환 시 프로젝트 이름·자막·제목·크레딧·화자 이름·사용자 템플릿을 다시 쓰거나
실행 취소 기록을 만들지 않습니다. 내장 템플릿의 목록 이름·설명은 번역하지만
기존 한국어 예시 문구는 작성 콘텐츠로 보존합니다. 예시 내용 적용은 기존처럼
명시적인 편집이며 자동 자막의 인식 언어도 별도 설정입니다.

CLI/MCP의 명령 이름·키·열거 값·오류 코드·경로는 그대로 유지합니다. 번역된 오류
문장이나 표시 이름을 ID로 사용하지 마세요. JSON·SRT/VTT/TXT·템플릿의 사용자
본문은 번역하지 않으며 브라우저 UI 언어가 출력 언어를 결정하지 않습니다.

## 브라우저와 파일 왕복

사이트 상단 폴더 아이콘의 **프로젝트 파일** 또는 사용 가이드에서 **편집 설정 저장 / 편집 설정 불러오기**를 사용할 수 있습니다. 문서 형식은 `{format:"moment-project", formatVersion:1, project:{...}}`이며, 내부 편집 상태 버전은 현재 4입니다. 지원하는 이전 상태만 마이그레이션하며 미래 버전은 거부합니다. 현재 상태 버전의 잘못되거나 누락된 필드는 기본값으로 조용히 교체하지 않고 거부합니다.

파일에는 영상과 오디오의 바이너리가 포함되지 않습니다. 다른 브라우저에서는 원본 영상과 추가 오디오를 먼저 연결해야 합니다. 현재 연결 확인은 영상 이름·길이, 오디오 이름 기준이며 파일 내용의 해시 비교는 아닙니다. 같은 이름의 다른 파일을 잘못 연결하지 않도록 원본을 보관하세요.

저장소 복원이 실패해도 유효한 설정을 읽었다면 브라우저의 [이번 탭에서만 원본 다시 연결](README.ko.md#이번-탭에서만-원본-다시-연결)을 사용할 수 있습니다.
명시적으로 확인한 원본과 실제 미디어 요소의 준비가 끝나면 미리보기·탐색·영상/PNG
출력을 허용하지만, 브라우저 저장·일반 가져오기·초기화·녹음·음성 인식은 여전히 차단됩니다.
연결 자체는 문서·기록·저장소를 바꾸지 않으며 새로고침 후 다시 연결해야 합니다.
이름·길이 확인은 파일 동일성 증명이 아니며 새 CLI/MCP 명령도 아닙니다.

같은 페이지의 JavaScript에서 호출할 수도 있습니다.

```js
await window.moment.ready;
const result = await window.moment.execute('template.apply', {
  templateId: 'reference',
  withContent: false,
});
if (!result.ok) console.error(result.error);
const document = await window.moment.execute('project.get');
```

수정 명령은 실행 취소 이력에 기록하고 화면·저장을 갱신합니다. 로드·녹음·인식·내보내기 중에는 `BUSY`를 반환합니다. `window.moment`는 같은 페이지 API이며 외부 컴퓨터에서 접근하는 네트워크 엔드포인트가 아닙니다.

### 동시성 경계

현재 브라우저의 동기 상태 읽기·검증·모델 교체 사이에는 비동기 대기를 두지 않습니다. `execute()`는 계속 Promise를 반환하며 명령은 큐 순서로 실행됩니다. 비동기 저장 어댑터의 커밋 완료도 기다리지만, 큐는 해당 서비스 인스턴스의 명령만 직렬화합니다. 외부 작성자가 있는 저장소는 `commitProject(next, {previous})`에서 이전 상태 확인과 쓰기를 원자적으로 수행하고 충돌 시 명시적으로 거절해야 합니다.

**자동 재시도·여러 탭 조정·미디어와 설정의 원자적 저장은 보장하지 않습니다.**

인프로세스 호스트는 `execute(name, args, beforeCommit)`의 선택적 동기 검사 함수로 프로젝트 변경의 커밋 직전에 충돌을 거절할 수 있습니다. 상태를 수정하지 말고 실패 시 예외를 던지세요. 비동기 검사 결과는 거절하며, 읽기 명령·미디어 작업에는 호출하지 않습니다. 이 함수는 CLI/MCP의 JSON 인수가 아니며 비동기 저장소의 원자적 충돌 검사를 대신하지 않습니다.

## MCP 어댑터와 호스트 확장

어댑터는 `listTools()` / `callTool()` 도구 매핑과 내부 `resultType: "complete"` 메타데이터를 제공합니다. 그 자체가 특정 버전의 완전한 MCP 서버는 아닙니다. 로컬 stdio 호스트는 **2025-11-25**를 협상하고 wire 응답에서 `resultType`을 제외합니다. 전송·수명주기·JSON-RPC 오류 처리·인증은 호스트의 책임입니다. 실제 설정, 도구별 입력/결과, 저장·재시도 흐름은 [MCP 안내](docs/MCP.md)를 따르세요.

각 도구에는 `projectId`가 필수입니다. 서비스 객체를 연결별 전역 변수 하나에 고정하지 말고, 요청마다 인증된 사용자와 프로젝트 ID로 조회하세요. `projectId` 자체는 권한이 아닙니다. 어댑터는 중첩된 호출 입력을 복사·검증한 뒤 resolver를 기다리므로, 조회 중 호출자가 입력을 바꾸어도 실행할 명령은 바뀌지 않습니다.

```js
const adapter = createMcpToolAdapter({
  async resolveService(projectId, requestContext) {
    // 호스트에서 인증·소유권·프로젝트별 권한 확인 후 서비스를 반환합니다.
    return authorizedProjectServices.resolve(projectId, requestContext.user);
  },
});
// tools/list → adapter.listTools()
// tools/call → adapter.callTool(params.name, params.arguments, trustedContext)
```

`UNKNOWN_TOOL`은 호스트에서 JSON-RPC invalid-params 오류로 변환합니다. 입력/도메인 오류는 `isError:true` 결과로 반환합니다. `structuredContent`는 `{ok, apiVersion, command, data}` 또는 오류 결과이며 `tools/list`의 `outputSchema`에서 확인할 수 있습니다. 수정 성공 응답은 전체 문서가 아니므로 `moment_project_get`을 호출해 `structuredContent.data`를 저장하세요.

인프로세스 서비스 예제는 `node examples/use-editor-service.mjs`, 실제 stdio 클라이언트 왕복 예제는 `node examples/use-mcp-client.mjs`입니다. 후자는 외부 SDK 없이 하위 프로세스에서 가져오기·수정·오류 복구·SRT/JSON 추출·새 세션으로 재가져오기를 검증하며 사용자 파일을 읽거나 쓰지 않습니다.

서버 서비스의 저장 콜백은 원자적인 저장과 프로젝트 버전 비교를 맡아야 합니다. 서비스 내부 큐는 한 서비스 인스턴스의 명령만 순서대로 실행하므로, 여러 서버 인스턴스 간 충돌을 막는 데이터베이스 트랜잭션을 대신하지 않습니다.

로컬 stdio 서버는 `node cli/mcp.mjs`로 실행합니다. 현재 사이트는 정적 배포이고 `/mcp`가 없습니다. 별도의 원격 HTTP MCP 서버를 켜려면 서버 런타임과 프로젝트 저장소를 추가하고, Sites의 MCP 기능 선언 및 인증된 엔드포인트를 구현해야 합니다. 이 단계에서 미디어 저장소도 연결해야 브라우저가 닫힌 뒤 작업할 수 있습니다.

로컬 호스트의 공식 규격: https://modelcontextprotocol.io/specification/2025-11-25/server/tools

## 업로드·음성 인식·렌더 제공자 확장

`createEditorService({getProject, commitProject, jobs})`에 아래 작업 포트를 주입할 수 있습니다.

```js
const jobs = {
  async submit({request, document}) { /* 작업 큐에 넣고 {id,status:"queued"} 반환 */ },
  async get(jobId) { /* {id,status,progress?,artifacts?,error?} 반환 */ },
  async cancel(jobId) { /* 실제 취소 상태를 반환 */ },
};
```

이 포트가 있을 때만 `jobs.submit`, `jobs.get`, `jobs.cancel`을 서비스 명령 목록에 노출합니다. 작업 유형은 `media.import`, `captions.transcribe`, `video.render`입니다. 가져오기에는 등록된 `assetId`가 필요합니다. 상태는 `queued`, `running`, `succeeded`, `failed`, `cancelled` 중 하나입니다. 제출은 완료를 의미하지 않습니다.

### 제공자 결과와 재시도

반환값은 `id`와 `status`를 포함한 JSON 객체여야 합니다. `id`는 조회·취소 입력과 동일하게 공백만으로 구성되지 않은 최대 200자의 문자열입니다. `get`·`cancel`은 요청한 `jobId`와 정확히 같은 `id`를 반환해야 합니다(공백 제거·대소문자·유니코드 정규화 없이 비교). `submit`은 제공자가 새 ID를 발급합니다. 다른 작업 ID를 포함한 잘못된 반환값은 `INVALID_PROVIDER_RESULT`로 보고하며 사용자 입력 오류와 구분합니다.

**오류 응답이어도 제공자에서 작업이 이미 생성·취소됐을 수 있습니다.** 서비스는 자동 재시도하지 않습니다. 호스트가 제공자 상태를 확인한 뒤 재시도 여부를 결정해야 합니다.

원본 파일의 저장·검증·실제 업로드, 음성 인식 엔진, 인코더, 작업 큐·취소·타임아웃·산출물 저장은 제공자가 구현합니다. 서비스가 임의의 로컬 경로나 URL을 자동으로 읽거나 다운로드하지 않습니다. 작업 결과를 편집기에 반영하려면 검증된 `captions.replace` 또는 `project.import`를 호출합니다. 제출 중 캡처한 스냅샷과 현재 프로젝트가 달라졌는지도 호스트에서 확인해야 합니다.

기본 브라우저·CLI에는 이 제공자가 없으며, 호출하면 `NOT_CONFIGURED`를 반환합니다. MCP 매핑도 현재는 편집 명령만 노출합니다. 미디어 작업 도구는 실제 제공자·권한·저장소를 연결하는 시점에 서버에서 추가하세요. 대용량 영상 인코딩은 정적 사이트 또는 제한된 요청 처리 런타임 안에서 수행하지 말고 별도 렌더 작업자로 분리할 수 있습니다.

## 검증

`npm test`는 기존 편집기 회귀 검사와 새 통합 테스트를 실행합니다. 실제 CLI 프로세스의 JSON/SRT/VTT 파일 생성, 덮어쓰기 방지, 실패 시 원본 보존, 명령 직렬화, MCP 권한 조회·오류 매핑, 모의 작업 제공자, 브라우저 API의 실행 취소·작업 중 차단을 확인합니다.

stdio 프로토콜 테스트는 실제 Node 하위 프로세스를 사용합니다. 외부 MCP 클라이언트 앱 연결, 실제 업로드 제공자, 실제 음성 인식·인코딩, 브라우저 UI의 파일 선택창 동작은 이 자동 테스트 범위에 포함되지 않습니다. 별도 실제 브라우저에서의 파일 가져오기·MP4 출력·저장 복원 결과는 [브라우저 점검](docs/BROWSER_QA.md)에 기록했습니다.
