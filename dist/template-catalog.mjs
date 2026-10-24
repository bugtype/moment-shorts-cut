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
  }[template.id] || [];
  project.overlays = cards.map(([label,text,detail,a,b],i) => ({...newCard(total),id:`${template.id}-${i}-${Date.now()}`,label,text,detail,start:a*total,end:b*total,accent:template.accent,background:template.id==='recipe'?'#283423':'#141a22',y:.16,role:'headline',presentation:'plain',size:template.id==='recipe'?32:36,stroke:3,animation:template.id==='cinema'?'fade':'slide',kind:template.id==='quiz'&&i===0?'countdown':'card'}));
}

export function saveCustomTemplate(name, project) {
  const total = project.clips.reduce((sum, clip) => sum + clip.end - clip.start, 0) / project.speed;
  const settings = visualPreset(project);
  for (const layer of [settings.design.title, settings.design.credit]) {
    layer.start = Math.min(total, Math.max(0, layer.start)) / total;
    if (layer.end != null) layer.end = Math.min(total, layer.end) / total;
  }
  return { id:`custom-${newCard(total).id}`,custom:true,relativeTiming:true,name:name.trim().slice(0,40),category:'내 템플릿',accent:project.captionAccent,tag:'내가 저장한 구성',
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
const categoryKeys = {"전체":"templates.category.all","리뷰":"templates.category.review","정보":"templates.category.info","라이프":"templates.category.life","대화":"templates.category.conversation","참여":"templates.category.participation","즐겨찾기":"templates.category.favorites","내 템플릿":"templates.category.custom"};
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
