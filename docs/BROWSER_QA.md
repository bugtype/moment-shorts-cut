# 실제 브라우저 점검 · 2026-10-23

로컬 `npm start` 서버와 Ego Browser의 Chromium(UA: Chrome/154.0.0.0, macOS)에서 실행했습니다. 아래는 한 환경의 기능 확인이며 모든 기기·브라우저의 품질 보장은 아닙니다.

## 이번에 확인한 결과

| 확인 항목 | 증거·결과 |
| --- | --- |
| 초기 편집기 | 실제 1440×1000 화면에서 샘플·템플릿·타임라인 렌더링. [스크린샷](editor-desktop.png) |
| 영상 가져오기 | FFmpeg로 만든 4초 H.264/AAC 합성 영상을 파일 입력으로 업로드. 앱에서 길이 4초로 확인 |
| SRT 가져오기 | 한국어 두 줄 자막과 이모지가 포함된 2개 구간을 실제 파일 입력으로 읽고 프로젝트 문서에서 내용 확인 |
| 설정 오류 거부 | 현재 형식의 `design:null` 문서를 `project.import`로 전달. `INVALID_ARGUMENT`을 반환하고 기존 프로젝트 보존 |
| 저장·복원 | 저장 버튼 후 새로고침. 원본 파일명·길이·자막 복원, video `readyState=4` 확인 |
| MP4 출력 | 실제 MediaRecorder로 720×1280 H.264/AAC 파일 다운로드. 최종 측정 길이 4.010233초, 크기 1,268,904바이트 |
| 디코딩 | FFmpeg로 비디오·오디오 전체 디코딩 성공. 별도 브라우저 플레이어에서 `ended=true`, 재생 위치 4.010233초, 오류 없음 확인 |
| 합성 확인 | 출력 프레임에서 원본 테스트 패턴·한국어 제목·두 줄 자막·크레딧을 시각적으로 확인 |
| 오디오 | 출력 파일에 AAC 트랙 확인. 첫 출력의 신호 분석에서 평균 -21.1 dB, 최대 -16.1 dB로 무음이 아님을 확인 |

## 프레임 간격 수정과 제한

기존 코드는 매번 마지막 그리기 시간을 현재 시각으로 바꾸면서 남은 시간을 버렸습니다. 60 Hz 입력을 2초간 모의 실행했을 때 42회만 그리는 문제를 재현했습니다. 남은 시간을 유지하도록 수정했고 `tests/app-media.test.mjs`에서 목표 60회(±1)를 확인합니다.

브라우저 MediaRecorder 출력은 여전히 기기·디코더·화면 부하의 영향을 받는 가변 프레임 레이트입니다. 최종 4초 테스트 MP4의 평균은 약 **21.7 fps**였습니다. 고정 30 fps 인코딩이나 실시간 성능을 보장하지 않으며, 이 결과를 숨기지 않습니다. 프레임 간격 수정이 하드웨어 코덱·시작 지연을 해결했다는 뜻도 아닙니다.

## 재현 방법

앱을 실행한 뒤 별도 터미널에서 테스트 원본을 만듭니다. FFmpeg는 이 수동 점검에만 필요하며 앱 실행·`npm test`의 의존성이 아닙니다.

```sh
ffmpeg -f lavfi -i testsrc2=size=640x360:rate=30 \
  -f lavfi -i sine=frequency=440:sample_rate=48000 \
  -t 4 -c:v libx264 -pix_fmt yuv420p -c:a aac moment-test.mp4
```

다음 내용을 UTF-8 `captions.srt`로 저장합니다.

```srt
1
00:00:00,000 --> 00:00:02,000
첫 번째 자막
두 번째 줄

2
00:00:02,000 --> 00:00:04,000
마지막 장면 🌊
```

1. 데스크톱 브라우저에서 영상을 업로드하고 자막 탭에서 SRT를 불러옵니다.
2. 저장하고 새로고침한 뒤 영상·자막을 확인합니다.
3. MP4/H.264·720p로 내보냅니다. 탭을 계속 활성 상태로 둡니다.
4. 원본과 다른 경로에 결과를 저장하고 별도 플레이어로 끝까지 재생합니다.
5. `ffprobe`와 디코더로 컨테이너·영상·오디오를 확인합니다. 가변 프레임 레이트를 그대로 검사하도록 time base를 유지합니다.

```sh
ffprobe -v error -show_entries format=duration,size:stream=codec_name,codec_type,width,height,avg_frame_rate -of json output.mp4
ffmpeg -v error -i output.mp4 -map 0:v:0 -c:v rawvideo -fps_mode passthrough -enc_time_base demux -f null -
ffmpeg -v error -i output.mp4 -map 0:a:0 -f null -
```

## 자동 검증과 미검증 범위

`npm test`: 문법 검사, 모의 DOM 편집기 회귀 검사와 Node 테스트를 실행합니다. CLI 프로세스·파일 입출력·로컬 HTTP 서버는 실제 실행합니다. CI의 운영체제·Node 버전별 결과는 [Actions](https://github.com/bugtype/moment-shorts-cut/actions/workflows/ci.yml)에서 확인할 수 있습니다.

실제 마이크 권한·녹음, 음성 인식 모델 다운로드·한국어 정확도, Safari/Firefox, 모바일 실기기, WebM 출력, 긴 영상의 음성 동기, 저장 공간 부족 상황은 이번 브라우저 점검에서 확인하지 않았습니다. 테스트 영상의 오디오는 사인파이므로 음성 인식 평가 자료가 아닙니다. 스크린샷과 영상은 개인 미디어를 사용하지 않았습니다.
