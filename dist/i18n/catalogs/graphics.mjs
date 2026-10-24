// Report labels only. Saved project strings remain literal in every language.
const entries = [
  ['graphics.heading', '그래픽 문구 검토', 'Graphics text review', '图形文字审阅'],
  ['graphics.inventory', '저장된 문구 목록입니다. 비활성·출력 범위 밖 항목도 포함하며 실제 표시 결과, 자막 대본 또는 가져오기 파일이 아닙니다.', 'Saved-text inventory, including disabled and out-of-range items. Not a visibility report, caption transcript or import file.', '这是已保存文字清单，包含已停用和输出范围外的项目，并非实际显示结果、字幕文稿或导入文件。'],
  ['graphics.clock', '시간은 배속 적용 후 출력 초입니다. 종료값 null은 출력 끝을 따릅니다.', 'Times are output seconds after speed. A null end follows the output end.', '时间为变速后的输出秒数。结束值 null 表示跟随输出结束。'],
  ['graphics.countdown', '카운트다운의 재생 중 생성 숫자는 포함하지 않습니다.', 'Countdown digits generated during playback are not included.', '不包含播放期间生成的倒计时数字。'],
  ['graphics.duration', '출력 길이', 'Output duration', '输出时长'],
  ['graphics.title', '제목', 'Title', '标题'],
  ['graphics.credit', '출처', 'Credit', '来源'],
  ['graphics.card', '카드 {index}', 'Card {index}', '卡片 {index}'],
  ['graphics.enabled', '활성 여부', 'Enabled', '是否启用'],
  ['graphics.start', '시작', 'Start', '开始'],
  ['graphics.end', '종료', 'End', '结束'],
  ['graphics.line1', '첫째 줄', 'Line 1', '第一行'],
  ['graphics.line2', '둘째 줄', 'Line 2', '第二行'],
  ['graphics.text', '본문', 'Text', '正文'],
  ['graphics.label', '라벨', 'Label', '标签'],
  ['graphics.detail', '상세 문구', 'Detail', '详细文字'],
  ['graphics.role', '역할', 'Role', '角色'],
  ['graphics.kind', '종류', 'Kind', '类型'],
];

export const messages = Object.fromEntries(['ko', 'en', 'zh-CN'].map((locale, index) => [
  locale, Object.fromEntries(entries.map(([key, ...values]) => [key, values[index]])),
]));
