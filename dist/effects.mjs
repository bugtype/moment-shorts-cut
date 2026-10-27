export { splitCaptionAtOffset, splitCaptionText } from './caption-splitting.mjs';
const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
export function defaultEnhancements() {
  return {
    templateId: 'reference', overlays: [], globalKeywords: '',
    speakerLabels: ['진행자', '게스트'], speakerColors: ['#a5edff', '#ffd27c'],
    effects: { motion: 'none', strength: .12, transition: 'none', transitionDuration: .2,
      brightness: 1, contrast: 1, saturation: 1, vignette: 0,
      progress: false, progressColor: '#b5ff00', progressPosition: 'bottom' },
  };
}
export function clipEffects(effects, elapsed, remaining, progress) {
  const p = clamp(progress, 0, 1), strength = clamp(effects.strength, 0, .4);
  const zoom = effects.motion === 'in' ? 1 + strength * p : effects.motion === 'out' ? 1 + strength * (1 - p) : 1;
  const d = Math.min(Math.max(.05, effects.transitionDuration), (elapsed + remaining) / 2);
  const opacity = effects.transition === 'none' || d <= 0 ? 0 : clamp(Math.max(1 - elapsed / d, 1 - remaining / d), 0, 1);
  return { zoom, opacity };
}
export function cardAtTime(card, time) { return time >= card.start && time < card.end; }
export function retimeOutputLayers(project, previous, next) {
  if (!(previous > 0 && next > 0) || previous === next) return;
  const scale = next / previous;
  for (const layer of [project.design.title, project.design.credit, ...(project.overlays || [])]) {
    layer.start *= scale;
    if (layer.end != null) layer.end *= scale;
  }
}
export function newCard(total, time = 0) {
  const start = clamp(time, 0, Math.max(0, total - .1));
  return { id: globalThis.crypto?.randomUUID?.() || `card-${Date.now()}-${Math.random()}`, kind: 'card', label: 'POINT', text: '핵심 내용을 입력하세요', detail: '',
    start, end: Math.min(total, start + 3), x: .47, y: .16, width: .78, size: 34, enabled:true, role:'headline', presentation:'plain', backgroundOpacity:.65, stroke:3,
    color: '#ffffff', background: '#16201f', accent: '#b5ff00', animation: 'slide' };
}
// Timed copy uses the headline lane. Opaque cards are an explicit opt-in.
export function activeSceneLayers(project, time) {
  const active=(project.overlays||[]).filter(card=>card.enabled!==false&&cardAtTime(card,time));
  const headline=active.filter(card=>(card.role||'headline')==='headline').at(-1);
  return active.filter(card=>(card.role||'headline')!=='headline'||card===headline);
}
export function sceneBounds(card, w, h) {
  const u=Math.min(w/540,h/960), width=Math.min((card.width||.78)*w,w*.82);
  const height=132*u;
  const x=clamp((card.x??.47)*w,width/2+w*.05,w*.89-width/2);
  const y=clamp((card.y??.16)*h,height/2+h*.08,h*.83-height/2);
  return {x,y,width,height,u};
}
export function drawSceneCards(c, w, h, project, time, total, typography) {
  for (const card of activeSceneLayers(project, time)) {
    const { x, y, width: bw, height: bh, u } = sceneBounds(card, w, h);
    const enter = clamp((time - card.start) / .16, 0, 1),
      leave = clamp((card.end - time) / .12, 0, 1);
    const fade = card.animation === 'none' ? 1 : Math.min(enter, leave);
    c.save();
    c.globalAlpha = fade;
    c.translate(x, y + (card.animation === 'slide' ? (1 - enter) * 10 * u : 0));
    const scale = card.animation === 'pop' ? .96 + .04 * enter : 1;
    c.scale(scale, scale);
    if (card.presentation === 'panel') {
      c.save();
      c.globalAlpha = fade * clamp(card.backgroundOpacity ?? .65, 0, 1);
      c.fillStyle = card.background;
      c.beginPath();
      c.roundRect(-bw / 2, -bh / 2, bw, bh, 8 * u);
      c.fill();
      c.restore();
    }
    const stroke = (card.stroke ?? 3) * u;
    const count = card.kind === 'countdown' ? ` · ${Math.max(1,Math.ceil(card.end-time))}` : '';
    typography.label(c, (card.label || '') + count, 0, -bh / 2 + 14 * u, {
      size: 13 * u, color: card.accent, stroke: 1.5 * u,
      maxWidth: bw * .92, maxHeight: 22 * u, singleLine: true
    });
    typography.label(c, card.text, 0, card.detail ? -5 * u : 12 * u, {
      size: card.size * u, color: card.color, stroke, weight: 900,
      maxWidth: bw * .96, maxHeight: (card.detail ? 70 : 90) * u, lineHeight: 1.2
    });
    if (card.detail) typography.label(c, card.detail, 0, bh / 2 - 18 * u, {
      size: 16 * u, weight: 600, color: card.color, stroke: 1.5 * u,
      maxWidth: bw * .94, maxHeight: 30 * u, lineHeight: 1.25
    });
    c.restore();
  }
  if (project.effects?.progress) {
    const u = Math.min(w / 540, h / 960),
      y = project.effects.progressPosition === 'top' ? h * .08 : h * .84;
    c.fillStyle = '#ffffff35';
    c.fillRect(w * .07, y, w * .78, 3 * u);
    c.fillStyle = project.effects.progressColor;
    c.fillRect(w * .07, y, w * .78 * clamp(time / Math.max(.1, total), 0, 1), 3 * u);
  }
}
export function migrateSceneLayers(project) {
  project.overlays=(project.overlays||[]).map(card=>{
    if(card.presentation)return card;
    const atOldDefault=Math.abs((card.y??.42)-.42)<.001||Math.abs((card.y??.4)-.4)<.001;
    return {...card,enabled:card.enabled!==false,presentation:'plain',backgroundOpacity:.65,stroke:3,role:atOldDefault?'headline':'free',x:card.x??.47,y:atOldDefault?.16:card.y};
  });
}

export function projectStructure(project) {
  const seconds = project.clips.reduce((sum, clip) => sum + clip.end - clip.start, 0) / project.speed;
  // Array order owns card stacking and headline priority, not start time.
  return (project.overlays || []).filter(card => card.end > 0 && card.start < seconds)
    .map(card => ({ ...card, start: clamp(card.start, 0, seconds), end: clamp(card.end, 0, seconds) }));
}
