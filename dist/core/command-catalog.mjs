import { SUPPORTED_ASPECT_RATIOS } from './aspect-ratio.mjs';
import { clipSchema, captionSchema, MAX_CLIPS } from './project.mjs';
import { MAX_CAPTIONS } from '../captions.mjs';
import { object, string, number, choice, boolean, array, CommandError } from './validation.mjs';
import { message as msg } from '../i18n.mjs';

// Command discovery and argument contracts. Execution stays in commands.mjs.
export const API_VERSION = 1;
const patchSchema = object({
  name: string(200),
  ratio: choice(...SUPPORTED_ASPECT_RATIOS),
  fit: choice('cover', 'contain'),
  zoom: number(1, 3),
  panX: number(-1, 1),
  panY: number(-1, 1),
  speed: number(.25, 4),
  volume: number(0, 1),
  audioVolume: number(0, 1),
});
const titleSchema = object({
  lines: array(string(200), 2, 2),
  colors: array(string(9), 2, 2),
  enabled: boolean,
  x: number(.05, .95),
  y: number(.06, .93),
  size: number(18, 72),
  stroke: number(0, 12),
  italic: boolean,
  start: number(0, 86400),
  end: {type: ['number', 'null'], minimum: 0, maximum: 86400},
});
const captionColorSchema = {...string(9), pattern: '^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$'};
const creditSchema = object({
  text: string(100),
  enabled: boolean,
  italic: boolean,
  color: captionColorSchema,
  x: number(0, 1),
  y: number(0, 1),
  size: number(10, 120),
  start: {type: 'number', minimum: 0},
  end: {type: ['number', 'null'], minimum: 0},
});
const captionPatchSchema = object(Object.fromEntries(['text', 'start', 'end', 'speaker', 'keywords'].map(key => [key, captionSchema.properties[key]])));
const captionStyleSchema = object({
  style: choice('impact', 'accent', 'highlight', 'minimal'),
  speakerLabels: array(string(80), 2, 2), speakerColors: array(captionColorSchema, 2, 2),
  captionSize: number(10, 120), captionX: number(0, 1), captionY: number(0, 1),
  captionColor: captionColorSchema, captionAccent: captionColorSchema,
  captionStroke: number(0, 20), captionItalic: boolean,
  captionAnimation: choice('none', 'fade', 'slide', 'pop'),
});
const effectsSchema = object({
  motion: choice('none', 'in', 'out'), strength: number(0, .4),
  transition: choice('none', 'fadeBlack', 'flash'), transitionDuration: number(.05, .7),
  brightness: number(.7, 1.3), contrast: number(.7, 1.5), saturation: number(0, 1.6), vignette: number(0, .6),
  progress: boolean, progressPosition: choice('top', 'bottom'), progressColor: captionColorSchema,
});
const overlayPatchSchema = object({
  text: string(2000), detail: string(2000), label: string(2000),
  color: captionColorSchema, accent: captionColorSchema, background: captionColorSchema,
  x: number(0, 1), y: number(0, 1), width: number(0, 1), size: number(10, 120), stroke: number(0, 20),
  backgroundOpacity: number(0, 1), presentation: choice('plain', 'panel'), role: choice('headline', 'free'),
  animation: choice('none', 'fade', 'slide', 'pop'), kind: choice('card', 'countdown'), enabled: boolean,
  start: {type: 'number', minimum: 0}, end: {type: 'number', minimum: 0},
});
const command = (name, description, inputSchema, mutates = false) => ({name, description, inputSchema, mutates});
const definitions = [
  command(
    'project.get',
    '편집 설정을 이식 가능한 JSON으로 읽습니다. 미디어 파일은 포함하지 않습니다.',
    object()
  ),
  command(
    'project.summary',
    '프로젝트 종류·화면 비율·속도·시간·항목 수와 저장된 미디어 요구사항을 읽습니다. 이름·본문·파일 경로는 포함하지 않으며 미디어 연결이나 내보내기 준비 상태를 확인하지 않습니다.',
    object()
  ),
  command(
    'project.update',
    '이름, 화면 비율, 구도, 배속과 볼륨을 수정합니다.',
    object({patch: patchSchema}, ['patch']),
    true
  ),
  command(
    'effects.update',
    '움직임·색감·클립 시작과 끝 효과·진행 막대의 지정한 설정만 수정합니다.',
    object({patch: effectsSchema}, ['patch']),
    true
  ),
  command(
    'project.import',
    '검증된 편집 설정 JSON을 적용합니다. 미디어 파일은 별도로 연결해야 합니다.',
    object({document: {type: 'object'}}, ['document']),
    true
  ),
  command(
    'template.export',
    '현재 스타일·제목·크레딧·장면 카드를 재사용 가능한 템플릿 파일로 읽습니다. 미디어와 자막은 포함하지 않습니다.',
    object({id: {...string(200), minLength: 1}, name: {...string(40), minLength: 1}}, ['id', 'name'])
  ),
  command(
    'templates.list',
    '기본 템플릿 목록을 읽습니다.',
    object()
  ),
  command(
    'template.inspect',
    '기본 템플릿을 적용하지 않고 예시 구성과 적용 후 제목·크레딧·카드의 문구와 시간을 읽습니다.',
    object({templateId: string(100), withContent: boolean}, ['templateId'])
  ),
  command(
    'template.apply',
    '기본 템플릿을 적용합니다. withContent=true는 제목과 구간 문구를 예시로 교체합니다.',
    object({templateId: string(100), withContent: boolean}, ['templateId']),
    true
  ),
  command(
    'template.apply.document',
    '템플릿 파일의 스타일을 적용합니다. withContent=true는 제목·크레딧·장면 카드도 교체하며 자막은 유지합니다.',
    object({document: {type: 'object'}, withContent: boolean}, ['document']),
    true
  ),
  command(
    'timeline.list',
    '클립의 원본 구간과 배속 전·후 편집 위치를 제한된 페이지로 읽습니다.',
    object({offset: {type: 'integer', minimum: 0, maximum: MAX_CLIPS}, limit: {type: 'integer', minimum: 1, maximum: 50}})
  ),
  command(
    'timeline.move',
    '클립을 지정한 최종 위치로 이동합니다. 원본 구간과 자막·출력 레이어의 시간 값은 유지합니다.',
    object({clipIndex: {type: 'integer', minimum: 0, maximum: MAX_CLIPS-1}, toIndex: {type: 'integer', minimum: 0, maximum: MAX_CLIPS-1}}, ['clipIndex', 'toIndex']),
    true
  ),
  command(
    'timeline.duplicate',
    '선택한 연속 클립 구간을 원래 구간 바로 뒤에 한 번 복제합니다. count 생략 시 클립 하나이며, 출력 글자 시간은 편집 길이에 비례 조정됩니다.',
    object({clipIndex: {type: 'integer', minimum: 0, maximum: MAX_CLIPS-1}, count: {type: 'integer', minimum: 1, maximum: MAX_CLIPS}}, ['clipIndex']),
    true
  ),
  command(
    'timeline.split',
    '지정한 클립을 원본 영상 시간에서 둘로 나눕니다. 각 구간은 0.1초 이상이어야 합니다.',
    object({clipIndex: {type: 'integer', minimum: 0, maximum: MAX_CLIPS-1}, sourceTime: number(0, 86400)}, ['clipIndex', 'sourceTime']),
    true
  ),
  command(
    'timeline.replace',
    '원본 영상 시간 기준 클립 목록을 교체합니다.',
    object({clips: array(clipSchema, MAX_CLIPS, 1)}, ['clips']),
    true
  ),
  command(
    'credit.update',
    '크레딧 문구·스타일·표시 시간의 지정한 설정만 수정합니다.',
    object({patch: creditSchema}, ['patch']),
    true
  ),
  command(
    'title.update',
    '기본 제목의 두 줄 문구와 스타일을 수정합니다.',
    object({patch: titleSchema}, ['patch']),
    true
  ),
  command(
    'overlays.move',
    '장면 카드의 쌓임 순서를 변경합니다. 마지막 카드가 앞쪽입니다.',
    object({id: {...string(2000), minLength: 1}, toIndex: {type: 'integer', minimum: 0, maximum: 11}}, ['id', 'toIndex']),
    true
  ),
  command(
    'overlays.add',
    '장면 카드를 지정한 ID로 끝에 추가합니다. 표시 시간은 배속 후 출력 초입니다.',
    object({id: {...string(2000), minLength: 1}, patch: {...overlayPatchSchema, required: ['text', 'start', 'end']}}, ['id', 'patch']),
    true
  ),
  command(
    'overlays.remove',
    '지정한 ID의 장면 카드 하나를 삭제합니다.',
    object({id: {...string(2000), minLength: 1}}, ['id']),
    true
  ),
  command(
    'overlays.update',
    '기존 장면 카드의 지정한 문구·스타일·출력 표시 시간만 수정합니다. 카드 ID와 순서는 유지합니다.',
    object({id: {...string(2000), minLength: 1}, patch: overlayPatchSchema}, ['id', 'patch']),
    true
  ),
  command(
    'captions.import',
    'SRT/VTT 문자열로 자막을 가져옵니다. 기본 replace는 전체 교체, append는 기존 행 뒤에 추가합니다. source 또는 배속 전 timeline 기준을 명시하세요.',
    object({text: string(100000), basis: choice('source', 'timeline'), mode: choice('replace', 'append'), report: boolean}, ['text', 'basis']),
    true
  ),
  command(
    'captions.split.long',
    '선택한 원본 자막 배열 범위의 긴 자막을 나눕니다. 범위 생략 시 전체이며, 경계 공백을 정리하고 글자 수에 비례한 추정 시간을 사용합니다.',
    object({limit: choice(12, 18, 24), captionIndex: {type: 'integer', minimum: 0, maximum: 9999}, count: {type: 'integer', minimum: 1, maximum: MAX_CAPTIONS}}),
    true
  ),
  command(
    'captions.split',
    '자막 하나를 문자 커서 위치에서 나눕니다. 시간은 문자 수 비례 추정이며 음성과 확인해야 합니다.',
    object({captionIndex: {type: 'integer', minimum: 0, maximum: 9999}, textOffset: {type: 'integer', minimum: 1, maximum: 1999}}, ['captionIndex', 'textOffset']),
    true
  ),
  command(
    'captions.merge',
    '인접한 두 자막을 합칩니다. 시간 기준·화자·강조 단어가 같고 시간이 겹치지 않아야 합니다.',
    object({captionIndex: {type: 'integer', minimum: 0, maximum: 9998}}, ['captionIndex']),
    true
  ),
  command(
    'captions.insert',
    '원본 순서의 지정한 위치에 자막 하나를 삽입합니다. 기존 자막의 상대 순서와 시간은 유지합니다.',
    object({captionIndex: {type: 'integer', minimum: 0, maximum: MAX_CAPTIONS}, caption: captionSchema}, ['captionIndex', 'caption']),
    true
  ),
  command(
    'captions.append',
    '기존 자막을 유지하고 원본 배열 끝에 자막들을 추가합니다. 시간 정렬·이동은 하지 않으며 재시도하면 중복 추가됩니다.',
    object({captions: array(captionSchema, MAX_CAPTIONS, 1)}, ['captions']),
    true
  ),
  command(
    'captions.remove',
    '원본 순서의 지정한 위치부터 자막을 삭제합니다. count 생략 시 하나를 삭제하며 나머지 자막과 시간은 유지합니다.',
    object({captionIndex: {type: 'integer', minimum: 0, maximum: MAX_CAPTIONS-1}, count: {type: 'integer', minimum: 1, maximum: MAX_CAPTIONS}}, ['captionIndex']),
    true
  ),
  command(
    'captions.update',
    '지정한 자막 하나의 본문·시간·화자·강조 단어만 수정합니다. 시간 기준과 추정 시간 경고는 유지합니다.',
    object({captionIndex: {type: 'integer', minimum: 0, maximum: 9999}, patch: captionPatchSchema}, ['captionIndex', 'patch']),
    true
  ),
  command(
    'captions.replace',
    '자막을 교체합니다. source는 원본, timeline은 배속 전 편집 시간입니다.',
    object({captions: array(captionSchema, MAX_CAPTIONS)}, ['captions']),
    true
  ),
  command(
    'captions.text.replace',
    '지정한 원본 자막 범위에서 대소문자를 구분해 같은 문자열을 모두 바꿉니다. 범위 생략 시 전체에 적용하며 시간과 메타데이터는 유지합니다.',
    object({
      find: {...string(2000), minLength: 1},
      replacement: string(2000),
      captionIndex: {type: 'integer', minimum: 0, maximum: 9999},
      count: {type: 'integer', minimum: 1, maximum: 10000},
    }, ['find', 'replacement']),
    true
  ),
  command(
    'captions.timing.shift',
    '지정한 원본 배열 범위에서 선택한 시간 기준의 자막을 배속 전 초 단위로 이동합니다. 범위 생략 시 전체에 적용하며 시간 범위를 벗어나면 변경하지 않습니다.',
    object({
      basis: choice('source', 'timeline'),
      delta: {type: 'number'},
      captionIndex: {type: 'integer', minimum: 0, maximum: 9999},
      count: {type: 'integer', minimum: 1, maximum: 10000},
    }, ['basis', 'delta']),
    true
  ),
  command(
    'captions.speaker.assign',
    '원본 순서의 자막 범위에 기존 화자 슬롯을 지정합니다. 본문·시간·소유권은 바꾸지 않습니다.',
    object({
      captionIndex: {type: 'integer', minimum: 0, maximum: 9999},
      count: {type: 'integer', minimum: 1, maximum: 10000},
      speaker: choice('', '0', '1'),
    }, ['captionIndex', 'count', 'speaker']),
    true
  ),
  command(
    'captions.style.update',
    '자막의 공통 크기·위치·색상·표현만 수정합니다. 본문·시간과 SRT/VTT 내용은 유지합니다.',
    object({patch: captionStyleSchema}, ['patch']),
    true
  ),
  command(
    'captions.list',
    '원본 순서의 자막을 제한된 페이지로 읽습니다. 시간 기준·문구·메타데이터는 변환하지 않습니다.',
    object({offset: {type: 'integer', minimum: 0, maximum: MAX_CAPTIONS}, limit: {type: 'integer', minimum: 1, maximum: 50}})
  ),
  command(
    'captions.overlaps',
    '컷과 배속을 반영한 출력 자막의 시간 겹침을 읽습니다. 각 해당 구간마다 대표 충돌 하나를 반환하며 편집하지 않습니다.',
    object({limit: {type: 'integer', minimum: 1, maximum: 100}})
  ),
  command(
    'captions.inspect',
    '편집·배속 후 자막을 읽기 속도 또는 선택한 review의 속도·출력 길이·겹침 기준으로 검사합니다. 프로젝트를 수정하지 않습니다.',
    {
      ...object({
        maxGraphemesPerSecond: {type: 'number', exclusiveMinimum: 0},
        limit: {type: 'integer', minimum: 1, maximum: 100},
        review: { ...object({
          maxGraphemesPerSecond: {type: 'number', exclusiveMinimum: 0},
          minDuration: {type: 'number', exclusiveMinimum: 0},
          maxDuration: {type: 'number', exclusiveMinimum: 0},
          includeOverlaps: boolean,
          filter: choice('all', 'reading-speed', 'too-short', 'too-long', 'overlap'),
        }), anyOf: [
          {not: {required: ['includeOverlaps'], properties: {includeOverlaps: {const: false}}}},
          {required: ['maxGraphemesPerSecond']}, {required: ['minDuration']}, {required: ['maxDuration']},
        ] },
      }),
      anyOf: [
        {required: ['maxGraphemesPerSecond'], not: {required: ['review']}},
        {required: ['review'], not: {required: ['maxGraphemesPerSecond']}},
      ],
    }
  ),
  command(
    'captions.export',
    '편집 구간과 배속을 반영한 SRT, WebVTT 또는 TXT 대본을 반환합니다. 선택한 원본 자막 배열 범위를 내보내며 범위 생략 시 전체를 내보냅니다. TXT의 review 옵션은 출력 시간과 지정된 화자명을 포함합니다.',
    object({
      format: choice('srt', 'vtt', 'txt'), review: boolean,
      captionIndex: {type: 'integer', minimum: 0, maximum: 9999},
      count: {type: 'integer', minimum: 1, maximum: 10000},
    })
  ),
  command(
    'render.plan',
    '렌더러가 사용할 프로젝트 스냅샷과 출력 설정을 반환합니다. 영상을 생성하지 않습니다.',
    object({quality: choice(720, 1080), format: choice('mp4', 'webm')})
  ),
];
// Closed trust boundary: new commands require explicit opt-in. Import has a
// separate browser media-relink guard; reads and provider jobs never participate.
const batchCommands = [
  'project.update', 'effects.update', 'template.apply', 'template.apply.document',
  'timeline.move', 'timeline.duplicate', 'timeline.split', 'timeline.replace', 'credit.update', 'title.update',
  'overlays.move', 'overlays.add', 'overlays.remove', 'overlays.update',
  'captions.import', 'captions.split', 'captions.split.long', 'captions.merge', 'captions.replace', 'captions.update', 'captions.insert', 'captions.append', 'captions.remove',
  'captions.text.replace', 'captions.timing.shift', 'captions.style.update', 'captions.speaker.assign',
];
definitions.push(command(
  'project.batch', '최대 20개 편집을 순서대로 검증하고 한 번에 적용합니다. 하나라도 실패하면 적용하지 않습니다.',
  object({
    operations: array(object({
      command: choice(...batchCommands),
      arguments: {type: 'object'},
    }, ['command', 'arguments']), 20, 1),
  }, ['operations']),
  true
));

definitions.push(command(
  'project.preview', '편집 묶음을 적용하지 않고 검증하여 변경 필드와 전후 개수·길이를 반환합니다.',
  definitions.find(c => c.name === 'project.batch').inputSchema
));

export function commandDefinitions() {
  return structuredClone(definitions);
}
export function commandDefinition(name) {
  const value = definitions.find(command => command.name === name);
  if (!value) throw new CommandError('UNKNOWN_COMMAND', msg('errors.unknownCommand'));
  return structuredClone(value);
}

// Expose membership, never the mutable trust-boundary array.
export function isBatchCommand(name) {
  return batchCommands.includes(name);
}
