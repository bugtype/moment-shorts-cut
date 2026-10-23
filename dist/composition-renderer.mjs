import { captionClock, findCaption } from './captions.mjs';
import { clipEffects, drawSceneCards } from './effects.mjs';
import { videoFrame, createTypographyRenderer } from './typography.mjs';

// One renderer/cache serves template previews, the editor and recorded output.
export function createCompositionRenderer(makeCanvas) {
  const typography = createTypographyRenderer(makeCanvas);

  function draw(context, width, height, project, media) {
    const frame = videoFrame(project.design, width, height);
    const effects = project.effects;
    const fx = clipEffects(effects, media.elapsed, media.remaining, media.progress);
    context.fillStyle = project.design.background;
    context.fillRect(0, 0, width, height);

    if (media.ready && media.sw && media.sh) {
      const fitScale = project.fit === 'cover'
        ? Math.max(frame.w / media.sw, frame.h / media.sh)
        : Math.min(frame.w / media.sw, frame.h / media.sh);
      const scale = fitScale * project.zoom * fx.zoom;
      const dw = media.sw * scale, dh = media.sh * scale;
      const x = frame.x + (frame.w - dw) / 2 + project.panX * frame.w;
      const y = frame.y + (frame.h - dh) / 2 + project.panY * frame.h;
      context.save();
      context.beginPath();
      context.rect(frame.x, frame.y, frame.w, frame.h);
      context.clip();
      context.filter = `brightness(${effects.brightness}) contrast(${effects.contrast}) saturate(${effects.saturation})`;
      context.drawImage(media.source, x, y, dw, dh);
      context.restore();
      if (effects.vignette > 0) {
        const gradient = context.createRadialGradient(width * .5, height * .5, width * .15, width * .5, height * .5, height * .7);
        gradient.addColorStop(0, '#00000000');
        gradient.addColorStop(1, `rgba(0,0,0,${effects.vignette})`);
        context.fillStyle = gradient;
        context.fillRect(0, 0, width, height);
      }
    }

    const caption = findCaption(project.captions, media.sourceTime, media.time * project.speed);
    const captionTime = caption
      ? captionClock(caption, media.sourceTime, media.time * project.speed)
      : media.sourceTime;
    typography.draw(context, width, height, project, captionTime, media.time, caption);
    drawSceneCards(context, width, height, project, media.time, media.total, typography);
    if (fx.opacity > 0) {
      context.save();
      context.globalAlpha = fx.opacity * (effects.transition === 'flash' ? .75 : 1);
      context.fillStyle = effects.transition === 'flash' ? '#ffffff' : '#000000';
      context.fillRect(0, 0, width, height);
      context.restore();
    }
  }

  return { draw, clear: typography.clear };
}
