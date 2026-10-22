# Moment · 모먼트 쇼츠 스튜디오

[![CI](https://github.com/bugtype/moment-shorts-cut/actions/workflows/ci.yml/badge.svg)](https://github.com/bugtype/moment-shorts-cut/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

**내 영상을 서버에 올리지 않고, 브라우저에서 편집하고 자막을 붙이는 한국어 쇼츠 편집기.**

Moment is a browser-local shorts editor with a Korean UI, reusable editing commands, a Node.js CLI, and an MCP tool adapter. Media processing runs on your device. This is an early-stage project; see the [verification report](docs/BROWSER_QA.md) for what has actually been tested.

![Moment 데스크톱 편집 화면: 템플릿, 영상 미리보기, 타임라인](docs/editor-desktop.png)

## 바로 실행하기

Node.js 20 이상이 필요합니다. npm 패키지 설치나 API 키 없이 실행할 수 있습니다.

```sh
git clone https://github.com/bugtype/moment-shorts-cut.git
cd moment-shorts-cut
npm start
```

브라우저에서 **http://127.0.0.1:4173**을 여세요. 첫 화면의 12초 모션 그래픽 샘플로 편집을 바로 시도할 수 있습니다. `Ctrl+C`로 서버를 종료합니다. 서버는 내 컴퓨터의 `127.0.0.1`에서 `dist/`만 제공합니다. `file://`로 HTML을 직접 열면 모듈·저장소·음성 기능이 정상 동작하지 않을 수 있습니다.

1. **미디어**에서 영상 업로드, 또는 샘플 그대로 시작.
2. **템플릿**에서 스타일 선택. ‘스타일만 적용’은 작성한 문구를 보존합니다.
3. **자막**에서 SRT/VTT를 불러오거나 직접 편집. 음성이 있는 짧은 원본은 로컬 자동 자막을 사용할 수 있습니다.
4. **내보내기**에서 지원되는 MP4/WebM과 해상도를 선택. 내보내는 동안 탭을 열어두세요.
5. 사용 가이드의 **편집 설정 저장**으로 JSON을 백업하세요. 영상·오디오 원본은 별도로 보관해야 합니다.

## 할 수 있는 일

| 영역 | 현재 구현 |
| --- | --- |
| 영상 | 9:16 / 1:1 / 16:9, 구도·확대, 트림·분할·순서 변경, 배속 |
| 자막 | SRT/VTT 가져오기, 두 줄 이상 문구, 화자·강조, 편집 구간과 배속을 반영한 SRT 출력 |
| 디자인 | 10개 기본 템플릿, 제목·크레딧·시간별 문구, 스타일만 적용, 실행 취소/다시 실행 |
| 오디오 | 원본 볼륨, 추가 음성 파일, 마이크 녹음, 브라우저 내 음성 인식 |
| 저장 | 현재 브라우저의 IndexedDB + localStorage, 편집 설정 JSON 가져오기/내보내기 |
| 출력 | Canvas 합성과 오디오 믹싱을 이용한 실시간 MediaRecorder 출력 |
| 자동화 | 공통 명령 코어, 실제 JSON/SRT CLI, `window.moment`, MCP 도구 매핑 어댑터 |

AI가 편집 명령을 만들고 사람이 미리보기에서 확인하는 흐름을 지원하도록, UI와 CLI가 같은 검증·시간 변환 코드를 사용합니다. **MCP 어댑터는 원격 MCP 서버가 아니며 CLI는 영상을 인코딩하지 않습니다.**

## CLI로 편집하기

```sh
node cli/moment.mjs init --out project.json
node cli/moment.mjs exec template.apply --project project.json --args-file examples/explainer.json --out edited.json
node cli/moment.mjs exec captions.export --project edited.json --out captions.srt
node examples/use-editor-service.mjs
```

`node cli/moment.mjs commands`로 입력 스키마를 확인합니다. 기존 파일은 기본적으로 덮어쓰지 않으며 `--overwrite`가 필요합니다. 수정 명령을 `--dry-run`으로 실행하면 파일을 변경하지 않고 결과를 확인합니다. 전체 API·시간 기준·권한 경계는 [INTEGRATIONS.md](INTEGRATIONS.md)를 참고하세요.

## 검증과 기여

```sh
npm test
```

추가 설치 없이 문법 검사, 편집기 회귀 검사, 실제 CLI 파일 입출력, 입력 검증, MCP 호출 격리, 자막 파서, 로컬 HTTP 서버 테스트를 실행합니다. GitHub Actions는 Linux의 Node 20/22/24와 Windows의 Node 24에서 실행하도록 구성되어 있습니다. 실제 실행 상태는 위 CI 링크에서 확인할 수 있습니다.

- [실제 브라우저 검증과 재현 방법](docs/BROWSER_QA.md)
- [상세 회귀 검사 범위](QA.md)
- [기여 가이드](CONTRIBUTING.md) · [보안 정책과 데이터 흐름](SECURITY.md)
- [개선 계획](ROADMAP.md)

## 개인정보와 현재 한계

- 사용자 영상·음성 파일은 앱 서버로 업로드하지 않습니다. 기본 글꼴은 Google Fonts에서, 음성 인식 코드는 jsDelivr에서, 모델은 Hugging Face에서 내려받으므로 **처음부터 완전한 오프라인 앱은 아닙니다**. 외부 요청의 네트워크 정보와 코드·모델 공급망은 [보안 정책](SECURITY.md)에 설명했습니다.
- 자동 자막은 Transformers.js 3.8.1 / Whisper tiny를 브라우저 워커에서 실행합니다. 원본 영상은 180초 이하를 지원하며, 인식 정확도는 직접 확인해야 합니다.
- 영상은 최대 500 MB, 추가 오디오는 100 MB, 설정 JSON은 10 MB, SRT/VTT는 2 MB까지 받습니다. 자막은 최대 10,000개·구간당 2,000자입니다. 크기 제한은 기기별 메모리 여유나 코덱 호환성을 보장하지 않습니다.
- 브라우저 데이터 삭제·시크릿 모드·저장 공간 부족으로 작업이 사라질 수 있습니다. 클라우드 동기화나 자동 원격 백업은 없습니다.
- 출력은 실시간입니다. 탭이 백그라운드로 이동하면 내보내기를 취소합니다. MP4/WebM 지원은 브라우저에 따라 다릅니다.
- 현재 단일 영상 트랙 편집기입니다. 페이드는 클립 경계의 효과이며 두 영상이 겹치는 크로스 디졸브는 아닙니다.

## 라이선스

프로젝트 코드와 문서는 [MIT](LICENSE)입니다. 런타임에 내려받는 글꼴·라이브러리·모델에는 각각의 이용 조건이 적용됩니다. [외부 구성요소](THIRD_PARTY.md)를 확인하세요.
