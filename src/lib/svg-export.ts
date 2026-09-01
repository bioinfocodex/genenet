/**
 * Turning an on-screen SVG into a file someone can put in a figure.
 *
 * The catch is that the SVG on screen is not self-contained. Its colours come
 * from CSS custom properties on the document -- var(--text-primary) and the
 * rest -- and a serialised copy carries the reference without the definition.
 * Opened on its own, or drawn into a canvas, every one of those resolves to
 * nothing: black on black, or invisible. So the styles that actually applied
 * are read back off the live elements and written onto the clone as
 * attributes, which survive the trip.
 */

/** Properties that decide how an SVG node looks, and are worth carrying over. */
const CARRIED = [
  'fill', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-opacity',
  'stroke-linecap', 'stroke-linejoin', 'stroke-dasharray',
  'font-family', 'font-size', 'font-weight', 'font-style',
  'text-anchor', 'dominant-baseline', 'opacity',
] as const;

export interface ExportOptions {
  /** Painted behind the drawing. Null leaves it transparent. */
  background?: string | null;
  /** Extra room around the edges, in px. */
  padding?: number;
}

/** A standalone copy of `svg` with every computed style written in. */
export function inlineSvg(svg: SVGSVGElement, opts: ExportOptions = {}): SVGSVGElement {
  const { background = '#ffffff', padding = 12 } = opts;

  const clone = svg.cloneNode(true) as SVGSVGElement;
  const live = [svg, ...Array.from(svg.querySelectorAll('*'))];
  const copied = [clone, ...Array.from(clone.querySelectorAll('*'))];

  live.forEach((el, i) => {
    const target = copied[i] as SVGElement | undefined;
    if (!target) return;
    const cs = window.getComputedStyle(el as Element);
    for (const prop of CARRIED) {
      const value = cs.getPropertyValue(prop).trim();
      // 'none' on fill is meaningful; an empty string is not.
      if (value) target.setAttribute(prop, value);
    }
  });

  /*
   * The viewBox first, because it is the drawing's own coordinate system.
   *
   * A width attribute of "100%" parses as NaN, and clientWidth is whatever the
   * page happened to give the element — neither describes the picture. Reading
   * the viewBox means an exported map is the size it was drawn at rather than
   * the size the browser window made it.
   */
  const box = svg.getAttribute('viewBox')?.split(/[\s,]+/).map(Number);
  const fromBox = box?.length === 4 && box.every(Number.isFinite)
    ? { w: box[2], h: box[3] }
    : null;

  const w = fromBox?.w || Number(svg.getAttribute('width')) || svg.clientWidth || 800;
  const h = fromBox?.h || Number(svg.getAttribute('height')) || svg.clientHeight || 600;

  // Layout styles belong to the page, not to a file going into a figure.
  clone.removeAttribute('style');
  clone.removeAttribute('class');

  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
  clone.setAttribute('width', String(w + padding * 2));
  clone.setAttribute('height', String(h + padding * 2));
  clone.setAttribute('viewBox', `${-padding} ${-padding} ${w + padding * 2} ${h + padding * 2}`);

  if (background) {
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('x', String(-padding));
    rect.setAttribute('y', String(-padding));
    rect.setAttribute('width', String(w + padding * 2));
    rect.setAttribute('height', String(h + padding * 2));
    rect.setAttribute('fill', background);
    clone.insertBefore(rect, clone.firstChild);
  }
  return clone;
}

export function svgToString(svg: SVGSVGElement): string {
  return new XMLSerializer().serializeToString(svg);
}

function save(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoking immediately can cancel the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Vector: what a journal will ask for. */
export function downloadSvg(svg: SVGSVGElement, filename: string, opts: ExportOptions = {}) {
  const text = svgToString(inlineSvg(svg, opts));
  save(new Blob([text], { type: 'image/svg+xml;charset=utf-8' }), filename);
}

/**
 * Raster, for slides and documents that will not take an SVG.
 *
 * Drawn at a multiple of the on-screen size because a drawing exported at 1x
 * is unreadable the moment it is scaled up in a document; 3x is roughly print
 * resolution for a figure this size.
 */
export function downloadPng(
  svg: SVGSVGElement,
  filename: string,
  opts: ExportOptions & { scale?: number } = {},
): Promise<void> {
  const { scale = 3, ...rest } = opts;
  const node = inlineSvg(svg, rest);
  const w = Number(node.getAttribute('width'));
  const h = Number(node.getAttribute('height'));
  const text = svgToString(node);

  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(w * scale);
      canvas.height = Math.round(h * scale);
      const ctx = canvas.getContext('2d');
      if (!ctx) { reject(new Error('Could not get a drawing context.')); return; }
      ctx.setTransform(scale, 0, 0, scale, 0, 0);
      ctx.drawImage(img, 0, 0);
      canvas.toBlob(blob => {
        if (!blob) { reject(new Error('Could not encode the image.')); return; }
        save(blob, filename);
        resolve();
      }, 'image/png');
    };
    img.onerror = () => reject(new Error('Could not render the drawing to an image.'));
    // A data: URL rather than a blob: URL -- a blob URL taints the canvas in
    // some browsers, and toBlob then throws on a tainted canvas.
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(text);
  });
}
