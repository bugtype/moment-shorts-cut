// Reviewer-selected metadata checks, not automatic fixes or delivery standards.
const entries = [
  ['advisory.title','자막 검토','Caption review','字幕检查'],
  ['advisory.speed','최대 읽기 속도 · 공백 제외 결합 문자/초 (선택)','Maximum reading speed · non-whitespace graphemes/second (optional)','最大阅读速度 · 非空白字素/秒（可选）'],
  ['advisory.min','최소 출력 표시 시간 · 초 (선택)','Minimum output duration · seconds (optional)','最短输出显示时长 · 秒（可选）'],
  ['advisory.max','최대 출력 표시 시간 · 초 (선택)','Maximum output duration · seconds (optional)','最长输出显示时长 · 秒（可选）'],
  ['advisory.overlaps','시간 겹침 포함','Include timing overlaps','包含时间重叠'],
  ['advisory.notice','빈 수치 기준은 검사하지 않습니다. 직접 정한 기준의 검토 결과이며, 자동 수정·납품 기준·실제 가시성·음성 일치를 판정하지 않습니다.','Blank numeric limits disable those checks. Findings use your chosen criteria, not automatic fixes, delivery standards, rendered visibility or speech alignment.','留空的数值限制不参与检查。结果仅按您选择的条件生成，不会自动修复，也不判定交付标准、实际可见性或语音对齐。'],
  ['advisory.filter','결과 종류','Finding type','结果类型'],
  ['advisory.all','전체','All','全部'],
  ['advisory.reading-speed','읽기 속도','Reading speed','阅读速度'],
  ['advisory.too-short','짧은 표시 시간','Too short','时长过短'],
  ['advisory.too-long','긴 표시 시간','Too long','时长过长'],
  ['advisory.overlap','시간 겹침','Timing overlap','时间重叠'],
  ['advisory.counts','출력 발생 {total}개 · 관련 발생 {flagged}개 · 전체 결과 {findings}개','Output occurrences {total} · affected occurrences {flagged} · all findings {findings}','输出出现次数 {total} · 涉及出现次数 {flagged} · 全部结果 {findings}'],
  ['advisory.filtered','필터 결과 {matched}개 · 표시 {shown}개 · 생략 {omitted}개','Matching findings {matched} · shown {shown} · omitted {omitted}','匹配结果 {matched} · 显示 {shown} · 省略 {omitted}'],
  ['advisory.summary','속도 {speed} · 짧음 {short} · 김 {long} · 겹침 {overlap}','Speed {speed} · short {short} · long {long} · overlap {overlap}','速度 {speed} · 过短 {short} · 过长 {long} · 重叠 {overlap}'],
  ['advisory.empty','이 필터에 해당하는 결과가 없습니다. 꺼진 검사는 결과를 만들지 않습니다.','No findings match this filter. Disabled checks produce no findings.','此筛选条件下没有结果。未启用的检查不会生成结果。'],
  ['advisory.duration','{value}초','{value} seconds','{value} 秒'],
  ['advisory.rate','{value}자소/초','{value} graphemes/second','{value} 字素/秒'],
  ['advisory.related','관련 자막 {index}','Related caption {index}','相关字幕 {index}'],
  ['advisory.stale','프로젝트나 미디어가 바뀌었습니다. 다시 검사하세요.','The project or media changed. Run inspection again.','项目或媒体已更改，请重新检查。'],
  ['advisory.save','표시된 결과 저장 (.json)','Save shown findings (.json)','保存所示结果（.json）'],
  ['advisory.saveFailed','검토 결과를 저장하지 못했습니다. 다시 시도하세요.','Could not save findings. Try again.','无法保存检查结果，请重试。'],
];
export const messages = Object.fromEntries(['ko','en','zh-CN'].map((locale,index) =>
  [locale,Object.fromEntries(entries.map(([key,...values]) => [key,values[index]]))]));
