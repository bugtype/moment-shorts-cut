# 예시 결과 / Example results

**Moment의 Canvas 합성과 기본 템플릿으로 만든 세로 쇼츠 4편입니다.** 파일 이름을 누르면 MP4가 열립니다. 포스터는 [프로젝트 갤러리](../../README.md#example-results)에 사용합니다.

Four vertical shorts made with Moment's Canvas renderer and built-in templates. Open an MP4 below, or browse the [thumbnail gallery](../../README.md#example-results).

**앱의 실시간 내보내기와는 제작 경로가 다릅니다.** 이 예시는 프레임별 렌더링 후 FFmpeg으로 인코딩했습니다. 앱은 같은 구성을 MediaRecorder로 실시간 녹화하므로 프레임 드롭·코덱에 따라 결과가 달라집니다. These are frame-rendered examples, not a browser-export performance guarantee.

## 결과 목록 / Files

| 결과 / Result | 템플릿 / Template | 길이 / Duration | 파일 / Size |
| --- | --- | --- | --- |
| 노을 앞에서 · In front of the sunset | 시네마틱 모먼트 · Cinematic moment | 11.5s | [cinema-sunset.mp4](cinema-sunset.mp4) · 2.8 MiB |
| 도시의 밤 · City night | 강한 첫 문장 · Bold opening line | 10.3s | [city-night.mp4](city-night.mp4) · 6.8 MiB |
| 오늘은 이 한 잔 · One cup for today | 한눈에 보는 레시피 · Recipe at a glance | 11.5s | [coffee-recipe.mp4](coffee-recipe.mp4) · 4.8 MiB |
| 서두르는 하루에 필요한 세 가지 · Three things a rushed day needs | TOP 3 리스트 · TOP 3 list | 10.9s | [forest-top3.mp4](forest-top3.mp4) · 10.5 MiB |

## 제작 방식 / Production

| 항목 / Part | 이 예시의 설정 / Example settings |
| --- | --- |
| 구성 / Composition | 앱과 동일한 `createCompositionRenderer`로 장면·제목·크레딧·자막·효과를 그림. 별도 모션 그래픽을 덧씌우지 않음 / Same renderer; no extra motion-graphics overlay |
| 영상 / Video | 1080×1920, 30 fps, H.264 High Profile; standard-range `yuv420p` / BT.709 |
| 오디오 / Audio | AAC 192 kbps |
| 한국어 글꼴 / Korean font | 앱 기본 글꼴 Noto Sans KR / The editor's default font |


## 소스 영상과 음악 / Sources and credits

모든 영상과 음악은 [Mixkit](https://mixkit.co/)의 무료 라이선스 자료입니다. Mixkit 라이선스는 출처 표기를 요구하지 않지만, 재사용 범위를 분명히 하기 위해 아래에 기록합니다.

| 결과 | 소스 영상 | 음악 |
| --- | --- | --- |
| 노을 앞에서 | [Sun setting or rising over palm trees](https://mixkit.co/free-stock-video/sun-setting-or-rising-over-palm-trees-1170/) | [Valley Sunset](https://assets.mixkit.co/music/127/127.mp3) — Alejandro Magaña (A. M.) |
| 도시의 밤 | [Big city at night from an aerial shot](https://mixkit.co/free-stock-video/big-city-at-night-from-an-aerial-shot-49878/) | [Sweet September](https://assets.mixkit.co/music/282/282.mp3) — Arulo |
| 오늘은 이 한 잔 | [Cup being filled with coffee in a coffee machine](https://mixkit.co/free-stock-video/cup-being-filled-with-coffee-in-a-coffee-machine-41865/) | [Lounging By Moonlight](https://assets.mixkit.co/music/40/40.mp3) — Ahjay Stelino |
| 서두르는 하루에 필요한 세 가지 | [Meadow covered with grass and trees in the blazing sun](https://mixkit.co/free-stock-video/meadow-covered-with-grass-and-trees-in-the-blazing-sun-40657/) | [Serene View](https://assets.mixkit.co/music/443/443.mp3) — Arulo |

- 영상 라이선스: [Mixkit Free License — Video](https://mixkit.co/license/#videoFree)
- 음악 라이선스: [Mixkit Free License — Music](https://mixkit.co/license/#musicFree)

예시에 사용한 원본 미디어는 저장소에 포함하지 않았습니다. 이 폴더에는 완성된 결과물과 포스터 이미지만 있습니다.

Original source media is not included; this folder contains finished videos and poster images. The source and license links above identify the third-party material used, separate from the repository code’s MIT license.
