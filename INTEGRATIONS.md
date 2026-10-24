# MCP / CLI 연결을 위한 구조

현재 버전은 **공통 편집 명령, 로컬 CLI, MCP 어댑터와 stdio 서버**를 제공합니다. [MCP 연결과 AI 스킬](docs/MCP.md)에서 설정 방법을 확인하세요.

**stdio 프로젝트는 임시 상태입니다.** 파일 저장·브라우저 동기화·원격 업로드·서버 음성 인식·무인 영상 인코딩은 제공하지 않습니다. 사이트는 기존 브라우저 편집기로 동작합니다.

| 하려는 일 | 사용할 인터페이스 | 먼저 확인할 것 |
|---|---|---|
| JSON·SRT·VTT 파일 편집 | [CLI](#실제-cli-사용) | 원본을 보존할 출력 경로, `--dry-run` |
| AI 클라이언트로 메타데이터 편집 | [stdio MCP](docs/MCP.md) | `session`은 임시 프로젝트, 종료 전 문서 저장 |
| 열린 브라우저 프로젝트 편집 | [같은 페이지 API](#브라우저와-파일-왕복) | `window.moment.ready`, 현재 작업의 `BUSY` 상태 |
| 별도 저장소·미디어 작업 연결 | [호스트 확장](#mcp-어댑터와-호스트-확장) | 인증·원자적 저장·실제 제공자는 호스트 책임 |

## 구성과 책임

| 구성 | 파일 | 역할 |
|---|---|---|
| 프로젝트 모델 | `dist/core/project.mjs` | 기본값, 저장 문서 v1, 상태 검증, 시간 기준, SRT/VTT |
| 편집 명령 | `dist/core/commands.mjs` | 입력 JSON Schema, 복사본 변경, 검증 후 결과 반환 |
| 공통 서비스 | `dist/integration/editor-service.mjs` | 명령 직렬 실행, 저장 포트, 공통 결과·오류, 미디어 작업 포트 |

### 사용자 인터페이스

| 구성 | 파일 | 역할 |
|---|---|---|
| 브라우저 | `dist/app.js`의 `window.moment` | 현재 프로젝트 접근, 실행 취소, 편집 중 상태 확인, 화면 갱신 |
| CLI | `cli/moment.mjs` | JSON 파일 읽기·쓰기, SRT/VTT 저장, 기존 파일 보호 |
| MCP 어댑터 | `dist/integration/mcp-adapter.mjs` | 명령을 도구 목록/호출 결과로 변환, 프로젝트별 서비스 조회 |

화면 비율·배속·기본 템플릿·트림·SRT/VTT 출력은 기존 UI도 공통 로직을 사용합니다. 타이틀/자막 등의 명령은 동일한 프로젝트 모델을 수정합니다. 미디어 디코딩·녹음·브라우저 인코딩은 기존 브라우저 구현에 남아 있습니다. 모든 화면 이벤트를 서버 코드로 옮긴 구조는 아닙니다.

## 명령 v1

`node cli/moment.mjs commands` 또는 브라우저의 `moment.describe()`에서 실제 입력 스키마를 읽을 수 있습니다.

### 읽기와 출력

| 명령 | 주요 입력 | 결과 |
|---|---|---|
| `project.get` | 없음 | 편집 설정 문서 |
| `templates.list` | 없음 | 기본 템플릿 목록 |
| `captions.export` | 선택 `format: "srt"` 또는 `"vtt"` | 편집 구간·배속을 반영한 `{format, text}`; 기본 SRT |
| `render.plan` | `quality`, `format` | 출력 설정·프로젝트·필요한 미디어 목록; **파일 생성 아님** |

### 프로젝트와 템플릿 변경

| 명령 | 주요 입력 | 결과 |
|---|---|---|
| `project.update` | `patch` | 이름·비율·구도·배속·볼륨 수정 |
| `project.import` | `document` | 설정 교체 |
| `template.apply` | `templateId`, `withContent` | 기본 템플릿 적용 |

### 타임라인과 글자 변경

| 명령 | 주요 입력 | 결과 |
|---|---|---|
| `timeline.replace` | `clips: [{start,end}]` | 클립 구간/순서 교체 |
| `title.update` | `patch` | 기본 제목과 스타일 수정 |

### 자막 변경

| 명령 | 주요 입력 | 결과 |
|---|---|---|
| `captions.replace` | `captions` | 대사 자막 교체 |
| `captions.text.replace` | `find`, `replacement` | 문구 모두 바꾸기; `{updated, matches, changedCaptions}` |
| `captions.style.update` | `patch` | 공통 자막 스타일; `{updated:true, outputDuration}` |

### 자막 문구 일괄 교정

`captions.text.replace`는 자막 문구만 바꾸고 시간·`basis`·화자·키워드·순서를 유지합니다. 모든 결과를 검증한 뒤 한 번만 반영합니다.

| 항목 | 규칙 |
|---|---|
| 입력 | `find`, `replacement` 필수; 각각 최대 2,000 UTF-16 코드 단위, `find`는 빈 문자열 불가 |
| 일치 | 대소문자를 구분하는 일반 문자열; 겹치지 않는 일치만 계산, 정규식·Unicode 정규화 없음 |
| 결과 | `{updated:boolean, matches:number, changedCaptions:number}`; 전체 문서가 아님 |
| 변경 없음 | 일치 없음 또는 동일한 대체 문구이면 `updated:false`; 저장 반영·실행 취소 이력 추가 없음 |

빈 `replacement`는 허용하지만, 바뀐 자막이 `trim()` 후 비거나 2,000 UTF-16 코드 단위를 넘으면 **전체 변경을 거절**합니다. 문구를 조용히 삭제하거나 잘라내지 않습니다. 구간 삭제는 UI의 개별 삭제 또는 명시적인 `captions.replace`를 사용하세요. 제목·크레딧·시간별 문구는 이 명령의 대상이 아닙니다.

```sh
node cli/moment.mjs exec captions.text.replace --project edited.json --json '{"find":"하루","replacement":"하루의 기록"}' --dry-run
node cli/moment.mjs exec captions.text.replace --project edited.json --json '{"find":"하루","replacement":"하루의 기록"}' --out corrected.json
```

`matches`는 일치 횟수, `changedCaptions`는 실제 문구가 바뀐 자막 수입니다. 동일한 문구로 바꾸면 일치가 있어도 변경 수는 0입니다. CLI에서 저장한 출력 파일은 편집 프로젝트 문서이며, 변경 없음 응답도 파일 쓰기 자체를 금지하는 뜻은 아닙니다. UI에서는 미리 표시한 개수를 확인하고 모두 바꾸며, 반영된 변경은 한 번에 실행 취소합니다. MCP에는 실행 취소 도구가 없으므로 이전 문서를 보관하세요.

### 자막 스타일 수정

`captions.style.update`는 기존 화면의 공통 자막 스타일을 CLI/MCP에서도 수정합니다. 새 UI나 개별 자막 스타일을 추가하는 명령이 아닙니다. 모든 자막에 적용되는 설정이며 문구·시간·화자 정보는 유지합니다.

| `patch` 필드 | 허용 값 |
|---|---|
| `style` | `impact`, `accent`, `highlight`, `minimal` |
| `captionSize` | 10–120; 캔버스 너비 540 기준 크기 |
| `captionX`, `captionY` | 각각 캔버스 너비·높이의 0–1 비율 |
| `captionColor`, `captionAccent` | `#RRGGBB` 또는 `#RRGGBBAA` |
| `captionStroke` | 0–20; 캔버스 너비 540 기준 두께 |
| `captionItalic` | boolean |
| `captionAnimation` | `none`, `fade`, `slide`, `pop` |

`patch`는 필수이고 내부 필드는 모두 선택입니다. 빈 `{}`도 허용하며 표준 수정 응답 `{updated:true, outputDuration}`을 반환합니다. `captions.text.replace`의 변경 없음 감지와 같은 계약은 아닙니다. 전달하지 않은 필드는 그대로 두며, **`style`만 바꿔도 화면 프리셋의 기울임·외곽선 기본값을 함께 적용하지 않습니다.** 필요하면 해당 필드를 명시하세요.

```sh
node cli/moment.mjs exec captions.style.update --project corrected.json --json '{"patch":{"captionSize":48,"captionY":0.72,"captionColor":"#FFFFFF"}}' --dry-run
node cli/moment.mjs exec captions.style.update --project corrected.json --json '{"patch":{"captionSize":48,"captionY":0.72,"captionColor":"#FFFFFF"}}' --out styled.json
```

**화면 적용:** 글자 크기와 외곽선은 캔버스 너비에 비례해 확대·축소하며 글자가 영역을 넘으면 맞춤 처리로 더 작아질 수 있습니다. `highlight`는 어두운 글자·강조색 상자·외곽선 없음으로 표시합니다. 그 외에는 지정 화자 색상이 우선하고, 화자가 없으면 `accent` 스타일은 `captionAccent`, 나머지는 `captionColor`를 사용합니다. 따라서 `captionColor` 수정이 화자·강조 스타일 색상을 덮어쓰지는 않습니다.

스타일은 프로젝트 JSON과 영상 화면에 적용하며 일반 SRT/VTT에는 기록하지 않습니다. 이 명령은 영상을 인코딩하지 않으며 `render.plan`도 계속 계획만 반환합니다.

### 결과와 검증

| 결과 | 형식 |
|---|---|
| 성공 | `{ok:true, apiVersion:1, command, data}` |
| 실패 | `{ok:false, apiVersion:1, command, error:{code,message,path?}}` |

잘못된 숫자·시간·색상·알 수 없는 필드는 변경 전에 거부합니다. 변경은 복사본에서 준비하며 저장 포트가 성공한 뒤 완료를 반환합니다. **수정 성공의 `data`는 전체 문서가 아닙니다.** 저장할 문서는 `project.get`으로 다시 읽으세요.

JavaScript에서 직접 호출할 때도 JSON으로 왕복 가능한 값을 전달하세요. 배열의 빈 슬롯(예: `[, '둘째 줄']`)과 열거되지 않는 인덱스는 `INVALID_ARGUMENT`로 거부합니다. 빈 제목 줄에는 `''`를 사용하고, `null`은 해당 입력 스키마가 허용하는 곳에서만 사용합니다.

주요 오류: `INVALID_ARGUMENT`, `UNKNOWN_COMMAND`, `NOT_FOUND`, `UNSUPPORTED_VERSION`, `BUSY`, `MEDIA_RELINK_REQUIRED`, `NOT_CONFIGURED`, `INVALID_PROVIDER_RESULT`, `CAPTION_OUTPUT_LIMIT`. 예상하지 못한 내부 오류는 `INTERNAL_ERROR`로 반환하며 스택이나 내부 인증 정보를 반환하지 않습니다.

### 시간 기준

| 필드·출력 | 시간 기준 |
|---|---|
| 클립 `start/end`, 자막 `basis: "source"` 또는 생략 | 원본 영상의 초 |
| 자막 `basis: "timeline"` | 배속 적용 **전** 편집 타임라인의 초 |
| 제목·크레딧·구간 문구 | 배속 적용 **후** 출력 영상의 초 |
| SRT/VTT | 편집 구간·반복·배속을 반영한 최종 출력 시간 |

배속이나 편집 길이 변경 시 출력 글자의 시간은 **한 번만** 비례 조정합니다.

`title.update`는 기본 제목을 수정합니다. 구간별 제목이 나오는 시간에는 기본 제목이 숨겨집니다. 구간별 문구 수정은 문서 편집 후 `project.import` 또는 현재 UI를 사용합니다.

## 실제 CLI 사용

Node.js 20 이상, 추가 패키지 설치 없이 실행합니다. 저장소 루트 기준입니다.

```bash
node cli/moment.mjs init --out project.json
node cli/moment.mjs exec template.apply --project project.json --args-file examples/explainer.json --out edited.json
node cli/moment.mjs exec title.update --project edited.json --json '{"patch":{"lines":["첫 번째 제목","두 번째 제목"]}}' --out titled.json
node cli/moment.mjs exec captions.export --project titled.json --out captions.srt
node cli/moment.mjs exec captions.export --project titled.json --json '{"format":"vtt"}' --out captions.vtt
node cli/moment.mjs exec render.plan --project titled.json --json '{"quality":1080,"format":"mp4"}' --out render-plan.json
```

### 출력과 기존 파일 보호

**`exec --dry-run`은 파일을 쓰지 않습니다.** 결과를 JSON으로 미리 확인하세요. `init`은 `--out`과 `--overwrite`만 지원하며, 지원하지 않는 옵션은 파일 접근 전에 거부합니다.

| 상황 | 동작 |
|---|---|
| 기존 출력 파일 | 기본 거절; 의도한 교체에만 `--overwrite` 사용 |
| 성공 | 종료 코드 0, stdout JSON |
| 실패 | 종료 코드 1, stderr JSON |

출력은 임시 파일에 먼저 쓴 뒤 최종 경로로 반영합니다.

### 입력 인코딩과 크기

**JSON 파일 상한은 BOM 포함 10 MiB(10,485,760바이트)입니다.** 읽기 전 파일 크기와 읽은 바이트 수를 모두 확인하므로 중간에 커진 파일도 초과하면 거부합니다.

파일 전체를 읽은 뒤 재검사하므로 메모리 할당 상한이나 다른 프로세스와의 원자적 읽기를 보장하지는 않습니다.

`--project`와 `--args-file`은 UTF-8 JSON 파일을 읽으며, 파일 시작의 BOM 하나는 허용합니다. 본문의 문자는 그대로 보존하고 출력 JSON에는 BOM을 붙이지 않습니다. 잘못된 UTF-8 바이트는 대체 문자로 변환하지 않고 `INVALID_JSON`으로 거부합니다. UTF-16 파일은 지원하지 않으므로 UTF-8로 저장하세요. `--json` 인수에는 BOM 없는 JSON 문자열을 전달합니다.

### SRT 출력 제한

**SRT와 VTT 모두 아래 한도를 적용합니다.** `format` 생략 시 기존 SRT 출력을 유지합니다. VTT는 `{"format":"vtt"}`를 명시해야 하며 출력 확장자로 형식을 추측하지 않습니다.

VTT는 UTF-8 일반 WebVTT로 `WEBVTT` 헤더와 점 단위 밀리초를 사용합니다. 편집 구간·반복·배속과 문구 이스케이프는 SRT와 동일합니다. 꾸밈 스타일·영역·화자 메타데이터는 내보내지 않습니다. NUL 문자는 VTT에서 거부합니다. 자막이 없으면 CLI/서비스는 `WEBVTT\n\n`을 반환하고 브라우저는 빈 자막 파일을 내려받지 않습니다.

| 제한 대상 | 상한 |
|---|---|
| 편집 후 출력 자막 | 10,000개 |
| 반복분을 포함한 원문 UTF-8 | 2 MiB |
| 완성된 SRT 또는 VTT | 2 MiB |

`captions.export`는 이 세 제한을 각각 적용합니다. 파일 크기는 이스케이프·시간·구분자·VTT 헤더(해당 시)를 포함하며 CLI/서비스는 BOM을 출력하지 않습니다. 브라우저는 SRT에만 BOM을 넣고 그 3바이트도 계산하며, VTT에는 넣지 않습니다. 초과 시 `CAPTION_OUTPUT_LIMIT`로 전체 출력을 거절하고 CLI는 기존 출력 파일을 보존합니다. 원본 프로젝트 검증·JSON·편집·`render.plan`에는 이 파생 출력 제한을 적용하지 않습니다. 반복 클립이나 자막을 줄여 재시도할 수 있습니다.

CLI는 편집 메타데이터와 SRT/VTT를 다룹니다. MP4 파일을 생성하거나 브라우저 IndexedDB의 원본 파일을 직접 가져오지 않습니다.

## 개별 사용자 템플릿 파일

브라우저 갤러리는 사용자 템플릿 한 개를 JSON으로 내보내고 가져올 수 있습니다.
프로젝트 JSON, 라이브러리 전체 백업, CLI/MCP의 기본 템플릿 목록과는 별도입니다.

| 항목 | 계약 |
|---|---|
| 문서 | `{format:"moment-template", formatVersion:1, template:{...}}` |
| 입력 | UTF-8 JSON, 파일 시작 BOM 하나 허용, BOM 포함 최대 256 KiB(262,144바이트) |
| 검증 | 지원 형식·버전과 템플릿 구조·중첩 스타일 검증 |
| 가져오기 | 현재 라이브러리에 새 고유 ID로 추가, 카테고리 `내 템플릿`, 최대 20개 |

갤러리에서 가져올 파일을 선택하면 현재 라이브러리에 **복사본을 추가할 뿐**,
기존 템플릿·즐겨찾기·현재 프로젝트를 덮어쓰거나 자동 적용하지 않습니다.
미리보기 후 스타일만 적용 또는 예시 내용까지 적용을 선택하세요.

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
않습니다. 로컬 stdio MCP는 이 브라우저 라이브러리를 읽지 않으며 도구는
그대로 12개입니다. CLI/MCP의 `templates.list`는 계속 기본 템플릿만 반환합니다.

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

## 브라우저와 파일 왕복

사이트 상단 사용 가이드에서 **편집 설정 저장 / 편집 설정 불러오기**를 사용할 수 있습니다. 문서 형식은 `{format:"moment-project", formatVersion:1, project:{...}}`이며, 내부 편집 상태 버전은 현재 4입니다. 지원하는 이전 상태만 마이그레이션하며 미래 버전은 거부합니다. 현재 상태 버전의 잘못되거나 누락된 필드는 기본값으로 조용히 교체하지 않고 거부합니다.

파일에는 영상과 오디오의 바이너리가 포함되지 않습니다. 다른 브라우저에서는 원본 영상과 추가 오디오를 먼저 연결해야 합니다. 현재 연결 확인은 영상 이름·길이, 오디오 이름 기준이며 파일 내용의 해시 비교는 아닙니다. 같은 이름의 다른 파일을 잘못 연결하지 않도록 원본을 보관하세요.

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
