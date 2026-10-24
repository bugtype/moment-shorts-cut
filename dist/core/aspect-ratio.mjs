export const SUPPORTED_ASPECT_RATIOS = Object.freeze(['9:16', '4:5', '1:1', '16:9']);

// Export quality is the short edge, unlike the preview's fixed portrait width.
// Callers validate the supported ratio and quality before allocating a surface.
export function outputDimensions(ratio, quality) {
  const [rw, rh] = ratio.split(':').map(Number);
  return {
    width: rw > rh ? Math.round(quality * rw / rh) : quality,
    height: rh > rw ? Math.round(quality * rh / rw) : quality,
  };
}
