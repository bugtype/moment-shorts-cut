import { t, translateFor } from './i18n.mjs';
import { applyDesignPreset } from './typography.mjs';
import { defaultEnhancements, newCard, projectStructure, migrateSceneLayers } from './effects.mjs';

export const REFERENCE_SOURCES = [
  { title: 'YouTube · 쇼츠 편집 도구와 시간별 텍스트', url: 'https://blog.youtube/news-and-events/new-creation-tools-youtube-shorts-2025/' },
  { title: 'Feel Good Foodie · 완성 장면과 질문으로 시작하기', url: 'https://blog.youtube/creator-and-artist-stories/road-to-1-million-with-feel-good-foodie/' },
  { title: 'YouTube · 팟캐스트의 핵심 순간을 쇼츠로', url: 'https://blog.youtube/creator-and-artist-stories/the-definitive-guide-to-creating-engaging-podcast-content/' },
  { title: 'YouTube · 질문·퀴즈형 쇼츠', url: 'https://blog.youtube/creator-and-artist-stories/grow-youtube-channel-interactive-shorts/' },
  { title: 'YouTube · 실제 자막·텍스트 화면 예시', url: 'https://blog.youtube/news-and-events/6-new-youtube-shorts-tools/' },
  { title: 'YouTube Works · 제품 중심 크리에이티브 예시', url: 'https://services.google.com/fh/files/events/ytw2024cj_1min.pdf' },
  { title: 'YouTube · 첫 순간의 훅과 짧은 이야기', url: 'https://blog.youtube/creator-and-artist-stories/youtube-shorts-deep-dive/' },
  { title: 'YouTube · 쇼츠 시청 선택과 시청 지속 신호', url: 'https://support.google.com/youtube/answer/11914225?co=YOUTUBE._YTVideoType%3Dshorts&hl=en' },
];
export const TEMPLATES = [
  { id:'reference', name:'리뷰 스토리', category:'리뷰', accent:'#b5ff00', base:'reference', tag:'두 줄 헤드라인', title:['이 장면을 다시 보니','완전히 다르게 보입니다'], description:'검은 상하 여백, 흰색·형광 타이틀, 중앙의 굵은 대사로 시선을 나눕니다.', flow:['상황 소개','핵심 장면','짧은 해석'], source:0 },
  { id:'punch', name:'강한 첫 문장', category:'정보', accent:'#ffd13e', base:'punch', tag:'풀 화면 · 팝업', title:['처음엔 몰랐습니다','알고 나니 보이는 것'], description:'전체 영상과 굵은 두 줄 제목, 짧은 대사로 시작합니다. 추가 정보 박스 없이 장면을 보여줍니다.', flow:['호기심 문장','핵심 한 가지','다음 질문'], source:0 },
  { id:'clean', name:'데일리 브이로그', category:'라이프', accent:'#fff4b8', base:'clean', tag:'작은 타이틀', title:['별일 없던 하루','그래서 더 좋았던 순간'], description:'작은 제목과 절제된 자막으로 풍경과 일상을 먼저 보여줍니다.', flow:['장소와 분위기','작은 기록','여운'], source:0 },
  { id:'explainer', name:'한 가지를 설명하는 법', category:'정보', accent:'#73e1ff', base:'punch', tag:'질문 → 이유 → 요약', title:['왜 이런 일이 생길까?','핵심만 짧게 설명합니다'], description:'상단 제목 자리에서 질문·이유·요약을 교체합니다. 배경 박스 없이 중앙의 피사체를 보여줍니다.', flow:['질문 던지기','핵심 이유','한 줄 정리'], source:0 },
  { id:'interview', name:'인터뷰 하이라이트', category:'대화', accent:'#e3c4ff', base:'clean', tag:'화자 이름 · 강조어', title:['이 한마디가','오래 남았습니다'], description:'화자별 이름표와 서로 다른 자막 색상으로 대화의 흐름을 구분합니다. 화자는 직접 지정합니다.', flow:['좋은 질문','핵심 답변','기억할 한 문장'], source:4 },
  { id:'recipe', name:'한눈에 보는 레시피', category:'라이프', accent:'#ffac70', base:'clean', tag:'STEP 01 · 02 · 03', title:['오늘은 이 한 접시','순서만 따라오세요'], description:'요리 장면은 넓게 보여주고 상단에 단계 번호와 짧은 설명만 배치합니다.', flow:['완성 미리보기','재료와 과정','마무리 팁'], source:1 },
  { id:'ranking', name:'TOP 3 리스트', category:'정보', accent:'#ffca54', base:'punch', tag:'순위 카드', title:['기억하면 좋은','세 가지 포인트'], description:'상단의 순위와 짧은 설명을 시간에 따라 바꿉니다. 제품이나 장면을 가리는 중앙 박스가 없습니다.', flow:['세 가지 예고','3위 → 2위 → 1위','요약'], source:0 },
  { id:'product', name:'솔직한 제품 리뷰', category:'리뷰', accent:'#bfe1a4', base:'reference', tag:'장점 · 아쉬움 · 결론', title:['직접 써보고 알게 된','좋은 점과 아쉬운 점'], description:'제품 특징, 장단점, 사용 대상까지 구분합니다. 수치·가격·평점은 직접 입력합니다.', flow:['제품 소개','장점과 아쉬움','누구에게 맞을까'], source:5 },
  { id:'quiz', name:'생각하고 공개하는 퀴즈', category:'참여', accent:'#bbabff', base:'reference', tag:'카운트다운 · 정답 공개', title:['잠깐, 정답은 뭘까요?','생각한 뒤 확인하세요'], description:'상단 여백에 질문·선택지·남은 시간을 놓고 같은 자리에서 정답을 공개합니다. 결과물은 영상 그래픽이며 클릭형 투표가 아닙니다.', flow:['질문과 선택지','생각할 시간','정답과 이유'], source:3 },
  { id:'cinema', name:'시네마틱 모먼트', category:'라이프', accent:'#e7d7b8', base:'clean', tag:'천천히 줌 · 페이드', title:['조금 느리게','다시 바라본 순간'], description:'여백과 작은 문장, 느린 줌, 검정 페이드로 여행·풍경·회상 장면을 구성합니다.', flow:['장면 열기','느리게 관찰','조용한 엔딩'], source:0 },
  { id:'hook-result', hook:true, name:'결과 먼저 보여주기', category:'초반 훅', accent:'#d6ff72', base:'reference', tag:'완성 컷 → 핵심 과정', title:['같은 영상인데','이렇게 달라집니다'], description:'첫 화면에 결과와 짧은 약속을 보여주고 핵심 과정과 비교를 이어갑니다. 완성 컷은 직접 앞에 배치하세요.', flow:['0~2초 · 결과 먼저','2~5초 · 핵심 과정','5~8초 · 바뀐 점 확인','8초 이후 · 한 줄 요약'], source:6 },
  { id:'hook-mistake', hook:true, name:'실수 진단과 해결', category:'초반 훅', accent:'#ffb68a', base:'punch', tag:'문제 → 원인 → 해결', title:['자막이 안 읽힌다면','이것부터 확인하세요'], description:'문제 한 가지를 첫 화면에서 짚고 원인과 수정 방법을 보여줍니다. 실제 수정 전후 장면을 맞춰 주세요.', flow:['0~2초 · 문제 지목','2~5초 · 원인 확인','5~8초 · 해결 방법','8초 이후 · 수정 결과'], source:6 },
  { id:'hook-compare', hook:true, name:'A/B 빠른 비교', category:'초반 훅', accent:'#97dcff', base:'reference', tag:'선택 질문 → 같은 조건 비교', title:['A와 B 중','어느 쪽이 잘 읽히나요?'], description:'선택 질문으로 시작해 같은 조건의 A와 B를 차례로 비교합니다. 비교할 영상 순서는 직접 배치하세요.', flow:['0~2초 · 선택 질문','2~5초 · A 확인','5~8초 · B와 차이 확인','8초 이후 · 선택 기준'], source:6 },
  { id:'hook-experiment', hook:true, name:'10초 미니 실험', category:'초반 훅', accent:'#ffe183', base:'punch', tag:'질문 → 실험 → 결과', title:['제목을 짧게 줄이면','더 잘 읽힐까요?'], description:'작은 질문 하나를 조건·실험·결과 순서로 보여줍니다. 예시 결론은 실제 실험 결과에 맞게 수정하세요.', flow:['0~2초 · 실험 질문','2~5초 · 조건과 시도','5~8초 · 결과 공개','8초 이후 · 적용 범위'], source:6 },
  { id:'hook-quiz', hook:true, name:'3초 관찰 퀴즈', category:'초반 훅', accent:'#d5b9ff', base:'reference', tag:'3초 질문 → 힌트 → 정답', title:['첫 화면의 제목은','몇 줄이었을까요?'], description:'첫 화면에서 질문하고 짧은 힌트 뒤 정답과 이유를 공개합니다. 선택지는 영상 그래픽이며 클릭형 투표가 아닙니다.', flow:['0~3초 · 관찰 질문','3~5초 · 짧은 힌트','5~8초 · 정답 공개','8초 이후 · 이유 설명'], source:6 },
  { id:'hook-myth', hook:true, name:'통념 검증', category:'초반 훅', accent:'#a7e5c8', base:'punch', tag:'통념 → 근거 → 조건부 결론', title:['자막은 무조건','클수록 좋을까요?'], description:'통념을 질문으로 제시한 뒤 근거와 적용 조건을 보여줍니다. 사실 확인과 근거 영상은 직접 준비하세요.', flow:['0~2초 · 통념 질문','2~5초 · 반례와 근거','5~8초 · 검증 결과','8초 이후 · 적용 조건'], source:7 },
];

export const VISUAL_KEYS = ['design','style','captionSize','captionY','captionX','captionColor','captionAccent','captionStroke','captionItalic','captionAnimation','effects','globalKeywords','speakerLabels','speakerColors','templateId'];
export function visualPreset(project) { return structuredClone(Object.fromEntries(VISUAL_KEYS.map(key => [key, project[key]]))); }

export function applyTemplate(project, template, withContent = false) {
  const existingText = { lines:[...project.design.title.lines], credit:project.design.credit.text };
  const total = project.clips.reduce((sum, clip) => sum + clip.end - clip.start, 0) / project.speed;
  if (template.custom) {
    Object.assign(project, structuredClone(template.settings));
    project.templateId = template.id;
    if (template.relativeTiming) for (const layer of [project.design.title, project.design.credit]) {
      layer.start *= total;
      if (layer.end != null) layer.end *= total;
    }
    if (withContent) {
      project.overlays = structuredClone(template.cards || []).map(card => ({ ...card, start:card.start * total, end:card.end * total }));
    } else {
      project.design.title.lines = existingText.lines;
      project.design.credit.text = existingText.credit;
    }
    migrateSceneLayers(project);
    return;
  }
  applyDesignPreset(project, template.base);
  project.design.title.lines = existingText.lines;
  project.design.credit.text = existingText.credit;
  project.effects = defaultEnhancements().effects;
  project.templateId = template.id;
  project.captionAccent = template.accent;
  project.design.title.colors[1] = template.accent;
  project.effects.progressColor = template.accent;
  const title = project.design.title;
  if (['explainer','interview','recipe','ranking','product','quiz'].includes(template.id)) {
    title.size = 36; title.y = .15; title.stroke=3; project.captionY = .71; project.captionSize = 33;
    project.captionItalic = false; title.italic = false; project.effects.progress = false;
  }
  if (template.id === 'explainer') { project.effects.motion='in'; project.effects.strength=.06; project.captionAnimation='slide'; }
  if (template.id === 'interview') { project.design.layout='full'; project.captionY=.68; project.style='impact'; project.captionStroke=3; }
  if (template.id === 'recipe') { project.design.layout='full'; title.size=30; project.captionY=.73; project.effects.transition='fadeBlack'; project.effects.transitionDuration=.12; }
  if (template.id === 'ranking') { title.size=38; project.style='accent'; project.effects.motion='in'; project.effects.strength=.08; }
  if (template.id === 'product') { project.design.top=.24; project.design.bottom=.8; project.captionY=.73; project.captionSize=28; }
  if (template.id === 'quiz') { project.design.top=.28; project.captionY=.72; project.effects.progress=false; project.captionAnimation='none'; }
  if (template.id === 'cinema') { project.design.layout='framed'; project.design.top=.2; project.design.bottom=.78; title.size=27; title.y=.12; title.stroke=0; title.colors=['#e7d7b8','#ffffff']; project.captionSize=25; project.captionY=.69; project.effects.motion='in'; project.effects.strength=.1; project.effects.transition='fadeBlack'; project.effects.transitionDuration=.45; project.effects.vignette=.25; project.captionAnimation='fade'; }
  if (template.hook) {
    title.size=38; title.y=.17; title.italic=false; title.stroke=3;
    project.design.credit.enabled=false;
    if (project.design.layout==='framed') { project.design.top=.28; project.design.bottom=.82; }
    project.captionY=.71; project.captionSize=32; project.captionItalic=false; project.captionAnimation='none';
    project.effects.motion='in'; project.effects.strength=.04;
  }
  if (!withContent) return;
  title.lines = [...template.title];
  project.design.credit.text = '나의 채널';
  const cards = {
    reference: [],
    punch: [],
    clean: [],
    explainer: [['질문','왜 같은 장면도\n다르게 느껴질까?','',0,.24],['핵심','시선을 바꾸면\n새로운 것이 보입니다','',.28,.68],['한 줄 정리','중요한 건\n어디를 바라보느냐','',.73,1]],
    interview: [['인터뷰','가장 기억나는 순간은?','',0,.22],['기억할 한마디','그 대답의 핵심','',.7,.98]],
    recipe: [['PREVIEW','완성된 한 접시','',0,.2],['STEP 01','재료를 준비해 주세요','',.23,.47],['STEP 02','순서대로 조리해 주세요','',.5,.74],['FINISH','마지막으로 이 팁','',.78,1]],
    ranking: [['TOP 3','세 번째 포인트','',.08,.35],['TOP 2','두 번째 포인트','',.38,.65],['TOP 1','가장 중요한 포인트','',.68,1]],
    product: [['FIRST LOOK','어떤 제품인가요?','',0,.22],['GOOD','좋았던 점','',.25,.49],['CHECK','아쉬웠던 점','',.52,.76],['VERDICT','이런 분께 맞아요','',.8,1]],
    quiz: [['QUIZ','1분은 몇 초일까요?','A. 30초     B. 60초',0,.66],['ANSWER','정답은 B, 60초','다음 문제에도 도전해 보세요',.68,1]],
    cinema: [],
    'hook-result': [['RESULT','같은 영상인데\n이렇게 달라집니다','',0,2],['HOW','제목은 짧게\n핵심만 남기기','한 화면에 한 가지 메시지',2,5],['COMPARE','바꾸기 전과 후를\n같은 장면으로 비교','달라진 점을 직접 확인하세요',5,8],['TAKEAWAY','첫 화면에는\n결과와 핵심 한 가지','내 영상의 결과에 맞게 바꿔 주세요',8,12]],
    'hook-mistake': [['CHECK','자막이 안 읽힌다면\n이것부터 확인하세요','',0,2],['CAUSE','밝은 배경 위의\n흰 글자를 확인하세요','실제 문제 장면을 보여주세요',2,5],['FIX','짙은 외곽선으로\n글자를 구분해 보세요','같은 장면에서 수정 전후 비교',5,8],['VERIFY','작은 화면에서도\n읽히는지 확인하세요','크기와 배치도 함께 점검',8,12]],
    'hook-compare': [['A / B','A와 B 중\n어느 쪽이 잘 읽히나요?','',0,2],['A','A · 글자만 표시','밝은 배경에서 확인하세요',2,5],['B','B · 외곽선 추가','같은 배경에서 차이를 보세요',5,8],['CHOOSE','내 배경에 맞게\n대비를 선택하세요','두 장면의 조건을 맞춰 비교',8,12]],
    'hook-experiment': [['TEST','제목을 짧게 줄이면\n더 잘 읽힐까요?','',0,2],['TRY','긴 제목을\n핵심 한 문장으로','장면과 글자 크기는 그대로',2,5],['RESULT','두 제목을 번갈아\n읽어 보세요','이 자리에 실제 결과를 넣어 주세요',5,8],['LIMIT','뜻이 빠지지 않았는지\n함께 확인하세요','짧아져도 핵심 정보는 남기기',8,12]],
    'hook-quiz': [['QUIZ','첫 화면의 제목은\n몇 줄이었을까요?','',0,3],['HINT','힌트 · 위아래로\n나뉘어 있었습니다','첫 화면을 떠올려 보세요',3,5],['ANSWER','정답은\n두 줄입니다','질문과 정답을 함께 수정하세요',5,8],['WHY','질문은 짧게\n답과 이유는 바로','내 영상의 관찰 포인트로 교체',8,12]],
    'hook-myth': [['REALLY?','자막은 무조건\n클수록 좋을까요?','',0,2],['CHECK','너무 큰 자막은\n피사체를 가릴 수 있어요','작은 화면에서 직접 비교',2,5],['FINDING','읽기 쉬운 크기와\n배치를 함께 보세요','실제 비교 장면으로 확인',5,8],['CONTEXT','배경과 화면에 맞게\n크기를 정하세요','조건에 따라 결과가 달라집니다',8,12]],
  }[template.id] || [];
  // Keep the opening in seconds on longer edits; only compress outputs below 12 seconds.
  const timingScale = template.hook ? Math.min(1,total/12) : total;
  project.overlays = cards.map(([label,text,detail,a,b],i) => ({...newCard(total),id:`${template.id}-${i}-${Date.now()}`,label,text,detail,start:a*timingScale,end:template.hook&&i===cards.length-1?total:b*timingScale,accent:template.accent,background:template.id==='recipe'?'#283423':'#141a22',y:template.hook ? .18 : .16,role:'headline',presentation:'plain',size:template.hook&&i===0?50:template.id==='recipe'?32:36,stroke:3,animation:template.hook?'none':template.id==='cinema'?'fade':'slide',kind:template.id==='quiz'&&i===0?'countdown':'card'}));
}

export function saveCustomTemplate(name, project, {id} = {}) {
  const total = project.clips.reduce((sum, clip) => sum + clip.end - clip.start, 0) / project.speed;
  const settings = visualPreset(project);
  for (const layer of [settings.design.title, settings.design.credit]) {
    layer.start = Math.min(total, Math.max(0, layer.start)) / total;
    if (layer.end != null) layer.end = Math.min(total, layer.end) / total;
  }
  return { id:id ?? `custom-${newCard(total).id}`,custom:true,relativeTiming:true,name:name.trim().slice(0,40),category:'내 템플릿',accent:project.captionAccent,tag:'내가 저장한 구성',
    title:[...project.design.title.lines],description:'이 브라우저에 저장한 스타일과 장면 카드입니다.',flow:['저장한 스타일','시간에 맞춘 카드'],settings,
    cards:structuredClone(projectStructure(project)).map(card=>({...card,start:card.start/total,end:card.end/total})) };
}

/** Presentation metadata only; never pass this view to applyTemplate or persistence. */
export function templateDisplay(template, locale) {
  const lookup = key => locale ? translateFor(locale, key) : t(key);
  if (template.custom) return {name:template.name,
    category:template.category==='내 템플릿'?lookup('templates.category.custom'):template.category,
    tag:template.tag,description:template.description,flow:[...template.flow]};
  const prefix = 'templates.builtin.' + template.id + '.';
  return {name:lookup(prefix+'name'),category:lookup(templateCategoryKey(template.category)),
    tag:lookup(prefix+'tag'),description:lookup(prefix+'description'),
    flow:template.flow.map((_, i)=>lookup(prefix+'flow'+i))};
}
const categoryKeys = {"전체":"templates.category.all","초반 훅":"templates.category.hook","리뷰":"templates.category.review","정보":"templates.category.info","라이프":"templates.category.life","대화":"templates.category.conversation","참여":"templates.category.participation","즐겨찾기":"templates.category.favorites","내 템플릿":"templates.category.custom"};
export function templateCategoryKey(category) { return categoryKeys[category]; }
export function templateSearchText(template) {
  const original = [template.name,template.tag,template.category,template.description].join(' ');
  if (template.custom) return original;
  return original + ' ' + ['ko','en','zh-CN'].map(locale => {
    const view=templateDisplay(template, locale);
    return [view.name,view.tag,view.category,view.description,
      translateFor(locale,'templates.builtin.'+template.id+'.search')].join(' ');
  }).join(' ');
}
