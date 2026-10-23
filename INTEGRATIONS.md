# MCP / CLI 연결을 위한 구조

현재 버전은 **공통 편집 명령 + 실제 로컬 CLI + MCP 도구 매핑 어댑터**를 제공합니다. 서버 MCP 연결, 자동 원격 업로드, 서버 음성 인식, 무인 영상 인코딩은 아직 활성화하지 않았습니다. 사이트는 기존 브라우저 편집기로 동작합니다.

## 구성과 책임

| 구성 | 파일 | 역할 |
|---|---|---|
| 프로젝트 모델 | `dist/core/project.mjs` | 기본값, 저장 문서 v1, 상태 검증, 시간 기준, SRT |
| 편집 명령 | `dist/core/commands.mjs` | 입력 JSON Schema, 복사본 변경, 검증 후 결과 반환 |
| 공통 서비스 | `dist/integration/editor-service.mjs` | 명령 직렬 실행, 저장 포트, 공통 결과·오류, 미디어 작업 포트 |
| 브라우저 | `dist/app.js`의 `window.moment` | 현재 프로젝트 접근, 실행 취소, 편집 중 상태 확인, 화면 갱신 |
| CLI | `cli/moment.mjs` | JSON 파일 읽기·쓰기, SRT 저장, 기존 파일 보호 |
| MCP 어댑터 | `dist/integration/mcp-adapter.mjs` | 명령을 도구 목록/호출 결과로 변환, 프로젝트별 서비스 조회 |

화면 비율·배속·기본 템플릿·트림·SRT 출력은 기존 UI도 공통 로직을 사용합니다. 타이틀/자막 등의 명령은 동일한 프로젝트 모델을 수정합니다. 미디어 디코딩·녹음·브라우저 인코딩은 기존 브라우저 구현에 남아 있습니다. 모든 화면 이벤트를 서버 코드로 옮긴 구조는 아닙니다.

## 명령 v1

`node cli/moment.mjs commands` 또는 브라우저의 `moment.describe()`에서 실제 입력 스키마를 읽을 수 있습니다.

| 명령 | 주요 입력 | 결과 |
|---|---|---|
| `project.get` | 없음 | 편집 설정 문서 |
| `project.update` | `patch` | 이름·비율·구도·배속·볼륨 수정 |
| `project.import` | `document` | 설정 교체 |
| `templates.list` | 없음 | 기본 템플릿 목록 |
| `template.apply` | `templateId`, `withContent` | 기본 템플릿 적용 |
| `timeline.replace` | `clips: [{start,end}]` | 클립 구간/순서 교체 |
| `title.update` | `patch` | 기본 제목과 스타일 수정 |
| `captions.replace` | `captions` | 대사 자막 교체 |
| `captions.export` | 없음 | 편집 구간·배속을 반영한 SRT |
| `render.plan` | `quality`, `format` | 출력 설정·프로젝트·필요한 미디어 목록; **파일 생성 아님** |

모든 결과는 `{ok, apiVersion: 1, command, data}` 또는 `{ok:false, apiVersion:1, command, error:{code,message,path?}}`입니다. 잘못된 숫자·시간·색상·알 수 없는 필드는 변경 전에 거부합니다. 변경은 복사본에서 준비하며, 저장 포트가 성공한 뒤 완료를 반환합니다.

JavaScript에서 직접 호출할 때도 JSON으로 왕복 가능한 값을 전달하세요. 배열의 빈 슬롯(예: `[, '둘째 줄']`)과 열거되지 않는 인덱스는 `INVALID_ARGUMENT`로 거부합니다. 빈 제목 줄에는 `''`를 사용하고, `null`은 해당 입력 스키마가 허용하는 곳에서만 사용합니다.

주요 오류: `INVALID_ARGUMENT`, `UNKNOWN_COMMAND`, `NOT_FOUND`, `UNSUPPORTED_VERSION`, `BUSY`, `MEDIA_RELINK_REQUIRED`, `NOT_CONFIGURED`, `INVALID_PROVIDER_RESULT`, `CAPTION_OUTPUT_LIMIT`. 예상하지 못한 내부 오류는 `INTERNAL_ERROR`로 반환하며 스택이나 내부 인증 정보를 반환하지 않습니다.

시간 기준을 유지해야 합니다.

- 클립 `start/end`: 원본 영상의 초.
- 자막 `basis: "source"` 또는 생략: 원본 영상의 초. `basis: "timeline"`: 배속 적용 전 편집 타임라인의 초.
- 제목·크레딧·구간 문구: 배속 적용 후 출력 영상의 초.
- 배속이나 편집 길이 변경 시 출력 글자의 시간은 한 번만 비례 조정합니다. SRT는 최종 출력 시간입니다.
- `title.update`는 기본 제목을 수정합니다. 구간별 제목이 나오는 시간에는 기본 제목이 숨겨집니다. 구간별 문구 수정은 문서 편집 후 `project.import` 또는 현재 UI를 사용합니다.

## 실제 CLI 사용

Node.js 20 이상, 추가 패키지 설치 없이 실행합니다. 저장소 루트 기준입니다.

```bash
node cli/moment.mjs init --out project.json
node cli/moment.mjs exec template.apply --project project.json --args-file examples/explainer.json --out edited.json
node cli/moment.mjs exec title.update --project edited.json --json '{"patch":{"lines":["첫 번째 제목","두 번째 제목"]}}' --out titled.json
node cli/moment.mjs exec captions.export --project titled.json --out captions.srt
node cli/moment.mjs exec render.plan --project titled.json --json '{"quality":1080,"format":"mp4"}' --out render-plan.json
```

`exec --dry-run`은 결과를 JSON으로 출력하고 파일을 쓰지 않습니다. `init`은 `--out`과 `--overwrite`만 지원하며, `--dry-run` 등 지원하지 않는 옵션은 파일 접근 전에 거부합니다. 기존 출력 파일은 기본적으로 거부하며, 교체하려면 `--overwrite`를 지정합니다. 성공은 종료 코드 0과 stdout JSON, 실패는 종료 코드 1과 stderr JSON입니다. JSON 파일은 10 MB까지 읽습니다. 임시 파일에 먼저 쓴 뒤 최종 경로로 반영합니다.

`--project`와 `--args-file`은 UTF-8 JSON 파일을 읽으며, 파일 시작의 BOM 하나는 허용합니다. 본문의 문자는 그대로 보존하고 출력 JSON에는 BOM을 붙이지 않습니다. 잘못된 UTF-8 바이트는 대체 문자로 변환하지 않고 `INVALID_JSON`으로 거부합니다. UTF-16 파일은 지원하지 않으므로 UTF-8로 저장하세요. `--json` 인수에는 BOM 없는 JSON 문자열을 전달합니다.

`captions.export`는 편집 후 자막 10,000개, 반복분을 포함한 원문 UTF-8 2 MiB, 완성된 SRT 2 MiB를 각각 제한합니다. SRT 크기는 이스케이프·시간·구분자를 포함하며 CLI/서비스는 BOM을 출력하지 않습니다(브라우저는 BOM 3바이트도 계산합니다). 초과 시 `CAPTION_OUTPUT_LIMIT`로 전체 출력을 거절하고 CLI는 기존 출력 파일을 보존합니다. 원본 프로젝트 검증·JSON·편집·`render.plan`에는 이 파생 출력 제한을 적용하지 않습니다. 반복 클립이나 자막을 줄여 재시도할 수 있습니다.

CLI는 편집 메타데이터와 SRT를 다룹니다. MP4 파일을 생성하거나 브라우저 IndexedDB의 원본 파일을 직접 가져오지 않습니다.

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

현재 브라우저의 동기 상태 읽기·검증·모델 교체 사이에는 비동기 대기를 두지 않습니다. `execute()`는 계속 Promise를 반환하며 명령은 큐 순서로 실행됩니다. 비동기 저장 어댑터의 커밋 완료도 기다리지만, 큐는 해당 서비스 인스턴스의 명령만 직렬화합니다. 외부 작성자가 있는 저장소는 `commitProject(next, {previous})`에서 이전 상태 확인과 쓰기를 원자적으로 수행하고 충돌 시 명시적으로 거절해야 합니다. 자동 재시도, 여러 탭 조정, 브라우저 미디어와 편집 설정의 원자적 저장을 보장하지 않습니다.

인프로세스 호스트는 `execute(name, args, beforeCommit)`의 선택적 동기 검사 함수로 프로젝트 변경의 커밋 직전에 충돌을 거절할 수 있습니다. 상태를 수정하지 말고 실패 시 예외를 던지세요. 비동기 검사 결과는 거절하며, 읽기 명령·미디어 작업에는 호출하지 않습니다. 이 함수는 CLI/MCP의 JSON 인수가 아니며 비동기 저장소의 원자적 충돌 검사를 대신하지 않습니다.

## MCP 연결 시 추가할 부분

어댑터는 MCP **2026-07-28 도구 결과 형태**의 `listTools()` / `callTool()`을 제공합니다. 전송, `server/discover`, `_meta`, JSON-RPC 오류 처리, 인증은 구현하지 않습니다. 정식 서버를 연결할 때 해당 프로토콜을 지원하는 호스트/SDK가 맡아야 합니다.

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

`UNKNOWN_TOOL`은 호스트에서 JSON-RPC invalid-params 오류로 변환합니다. 입력/도메인 오류는 `isError:true` 결과로 반환합니다. 실제 작동하는 로컬 연결 예제는 `node examples/use-editor-service.mjs`로 실행할 수 있습니다.

서버 서비스의 저장 콜백은 원자적인 저장과 프로젝트 버전 비교를 맡아야 합니다. 서비스 내부 큐는 한 서비스 인스턴스의 명령만 순서대로 실행하므로, 여러 서버 인스턴스 간 충돌을 막는 데이터베이스 트랜잭션을 대신하지 않습니다.

현재 사이트는 정적 배포이고 `/mcp`가 없습니다. MCP 서버를 실제로 켜려면 서버 런타임과 프로젝트 저장소를 추가하고, Sites의 MCP 기능 선언 및 인증된 엔드포인트를 구현해야 합니다. 이 단계에서 미디어 저장소도 연결해야 브라우저가 닫힌 뒤 작업할 수 있습니다.

공식 규격: https://modelcontextprotocol.io/specification/2026-07-28/server/tools

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

반환값은 `id`와 `status`를 포함한 JSON 객체여야 합니다. `id`는 조회·취소 입력과 동일하게 공백만으로 구성되지 않은 최대 200자의 문자열입니다. 잘못된 반환값은 `INVALID_PROVIDER_RESULT`로 보고하며 사용자 입력 오류와 구분합니다. 이 오류가 나도 제공자에서 작업이 이미 생성되거나 취소되었을 수 있습니다. 서비스는 자동 재시도하지 않으므로, 호스트가 제공자 상태를 확인한 뒤 재시도 여부를 결정해야 합니다.

원본 파일의 저장·검증·실제 업로드, 음성 인식 엔진, 인코더, 작업 큐·취소·타임아웃·산출물 저장은 제공자가 구현합니다. 서비스가 임의의 로컬 경로나 URL을 자동으로 읽거나 다운로드하지 않습니다. 작업 결과를 편집기에 반영하려면 검증된 `captions.replace` 또는 `project.import`를 호출합니다. 제출 중 캡처한 스냅샷과 현재 프로젝트가 달라졌는지도 호스트에서 확인해야 합니다.

기본 브라우저·CLI에는 이 제공자가 없으며, 호출하면 `NOT_CONFIGURED`를 반환합니다. MCP 매핑도 현재는 편집 명령만 노출합니다. 미디어 작업 도구는 실제 제공자·권한·저장소를 연결하는 시점에 서버에서 추가하세요. 대용량 영상 인코딩은 정적 사이트 또는 제한된 요청 처리 런타임 안에서 수행하지 말고 별도 렌더 작업자로 분리할 수 있습니다.

## 검증

`npm test`는 기존 편집기 회귀 검사와 새 통합 테스트를 실행합니다. 실제 CLI 프로세스의 JSON/SRT 파일 생성, 덮어쓰기 방지, 실패 시 원본 보존, 명령 직렬화, MCP 권한 조회·오류 매핑, 모의 작업 제공자, 브라우저 API의 실행 취소·작업 중 차단을 확인합니다.

외부 MCP 클라이언트 연결, 실제 업로드 제공자, 실제 음성 인식·인코딩, 브라우저 UI의 파일 선택창 동작은 이 자동 테스트 범위에 포함되지 않습니다. 별도 실제 브라우저에서의 파일 가져오기·MP4 출력·저장 복원 결과는 [브라우저 점검](docs/BROWSER_QA.md)에 기록했습니다.
