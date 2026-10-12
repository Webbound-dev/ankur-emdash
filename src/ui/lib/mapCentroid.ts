/** Visual center of an SVG path's filled area, not its bounding box.
 *
 * `getBBox()` centers a marker on the midpoint of a shape's bounding
 * rectangle, which looks fine for roughly-round states but drifts badly for
 * concave or elongated ones — Gujarat's bbox is dragged northwest by the
 * Kutch peninsula, Jammu & Kashmir's long diagonal shape pulls its bbox
 * center down toward Himachal, and the tightly packed northeast states end
 * up with bbox centers that don't land on the state at all.
 *
 * This rasterizes the path onto an offscreen canvas and averages the
 * coordinates of every filled pixel — the actual area centroid, which for
 * a state's roughly-convex silhouette reliably lands inside the shape
 * itself rather than off to one side of it.
 */

let sharedCanvas: HTMLCanvasElement | null = null;

export function computePathCentroid(d: string, viewBoxWidth: number, viewBoxHeight: number): { x: number; y: number } | null {
  if (!sharedCanvas) sharedCanvas = document.createElement('canvas');
  const canvas = sharedCanvas;
  const width = Math.max(1, Math.ceil(viewBoxWidth));
  const height = Math.max(1, Math.ceil(viewBoxHeight));
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = '#000';
  ctx.fill(new Path2D(d));

  const { data } = ctx.getImageData(0, 0, width, height);
  let sumX = 0;
  let sumY = 0;
  let count = 0;
  // Every 2nd pixel in both axes — 4x fewer samples, no visible precision
  // loss at marker scale, and keeps ~36 states cheap to compute on mount.
  const step = 2;
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const alpha = data[(y * width + x) * 4 + 3];
      if (alpha > 0) {
        sumX += x;
        sumY += y;
        count++;
      }
    }
  }
  if (count === 0) return null;
  return { x: sumX / count, y: sumY / count };
}
