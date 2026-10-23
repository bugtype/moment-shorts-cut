# 예시 결과 / Example results

Moment의 실제 Canvas 합성 엔진(`dist/composition-renderer.mjs`)과 기본 템플릿으로 만든 1080×1920 세로 쇼츠입니다. 각 파일 이름을 누르면 영상이 열리고, 포스터 이미지는 `README.md`의 갤러리에 사용됩니다.

| 결과 | 템플릿 | 길이 | 용량 | 파일 |
| --- | --- | --- | --- | --- |
| 노을 앞에서 | 시네마틱 모먼트 | 11.5초 | 2.8 MB | [cinema-sunset.mp4](cinema-sunset.mp4) |
| 도시의 밤 | 강한 첫 문장 | 10.3초 | 6.8 MB | [city-night.mp4](city-night.mp4) |
| 오늘은 이 한 잔 | 한눈에 보는 레시피 | 11.5초 | 4.8 MB | [coffee-recipe.mp4](coffee-recipe.mp4) |
| 서두르는 하루에 필요한 세 가지 | TOP 3 리스트 | 10.9초 | 10.5 MB | [forest-top3.mp4](forest-top3.mp4) |

## 제작 방식

- **구성:** 앱과 동일한 `createCompositionRenderer`로 장면·제목·크레딧·자막·효과를 그렸습니다. 별도의 모션 그래픽을 덧씌우지 않았습니다.
- **해상도와 프레임:** 1080×1920, 30fps, H.264 High Profile, AAC 192kbps. 색상은 표준 범위의 `yuv420p` / BT.709로 태깅했습니다.
- **렌더링:** 결과 화질을 높이기 위해 프레임을 한 장씩 결정적으로 렌더링한 뒤 FFmpeg으로 인코딩했습니다. 앱의 **내보내기** 버튼은 같은 구성을 브라우저에서 실시간 MediaRecorder로 인코딩하므로, 녹화 중 프레임 드롭이 발생하면 이 예시보다 화질이나 부드러움이 낮을 수 있습니다.
- **자막:** 한국어 자막과 제목은 앱의 기본 글꼴인 Noto Sans KR로 렌더링했습니다.

## 소스 영상과 음악

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
