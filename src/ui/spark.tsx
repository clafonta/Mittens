import { RATE_BUCKET_MS, RATE_BUCKETS, type RateSeries } from "../core/rates.js";

// --------------------------------------------------------------- sparklines

/** Bar geometry, shared by the server render and the script so both draw the same thing. */
const SPARK = { w: 4, gap: 1, h: 22, minScale: 4 } as const;
export const SPARK_WIDTH = RATE_BUCKETS * (SPARK.w + SPARK.gap) - SPARK.gap;
const WINDOW_MIN = (RATE_BUCKETS * RATE_BUCKET_MS) / 60_000;

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

export const sparkTitle = (s: RateSeries) => {
  const total = sum(s.counts);
  const errors = sum(s.errors);
  return `${total} request${total === 1 ? "" : "s"} in the last ${WINDOW_MIN} minutes${errors ? `, ${errors} with errors` : ""}`;
};

/** The bars for one series: total in the accent colour, the error part in red at the bottom. */
function bars(s: RateSeries) {
  const max = Math.max(SPARK.minScale, ...s.counts);
  return s.counts.map((n, i) => {
    const x = i * (SPARK.w + SPARK.gap);
    const h = n ? Math.max(2, Math.round((n / max) * SPARK.h)) : 1;
    const eh = s.errors[i] ? Math.max(2, Math.round((s.errors[i]! / max) * SPARK.h)) : 0;
    return (
      <>
        <rect class={n ? "bar" : "bar empty"} x={x} y={SPARK.h - h} width={SPARK.w} height={h} />
        {eh > 0 && <rect class="bar err" x={x} y={SPARK.h - eh} width={SPARK.w} height={eh} />}
      </>
    );
  });
}

/**
 * Requests per 30 s over the last 10 minutes. `id` ties it to live updates:
 * a service id, or "" for unmatched requests. Use `x`/`y` to place it inside
 * another SVG.
 */
export function Sparkline({ id, series, x, y, label = true }: { id: string; series: RateSeries; x?: number; y?: number; label?: boolean }) {
  const total = sum(series.counts);
  const svg = (
    <svg
      class="spark"
      data-spark={id}
      data-end={series.end}
      data-counts={series.counts.join(",")}
      data-errors={series.errors.join(",")}
      width={SPARK_WIDTH}
      height={SPARK.h}
      viewBox={`0 0 ${SPARK_WIDTH} ${SPARK.h}`}
      x={x}
      y={y}
      role="img"
      aria-label={sparkTitle(series)}
    >
      <title>{sparkTitle(series)}</title>
      {bars(series)}
    </svg>
  );
  if (!label) return svg;
  return (
    <span class="spark-wrap">
      {svg}
      <span class="spark-total" data-spark-total={id} title={sparkTitle(series)}>
        {total}
      </span>
    </span>
  );
}

// ------------------------------------------------------------------ scripts

/**
 * Keeps sparklines current: adds each request to its service's newest bar,
 * and slides every sparkline left as 30-second buckets pass.
 */
export const SPARK_SCRIPT = `
(function () {
  var NS = 'http://www.w3.org/2000/svg', B = ${RATE_BUCKET_MS}, N = ${RATE_BUCKETS};
  var W = ${SPARK.w}, GAP = ${SPARK.gap}, H = ${SPARK.h}, MIN = ${SPARK.minScale}, MINUTES = ${WINDOW_MIN};
  function nums(s) { return (s || '').split(',').map(Number); }
  function slide(el) {
    var now = Math.floor(Date.now() / B), end = +el.getAttribute('data-end');
    var c = nums(el.getAttribute('data-counts')), e = nums(el.getAttribute('data-errors'));
    var shift = Math.min(Math.max(now - end, 0), N);
    for (var i = 0; i < shift; i++) { c.shift(); c.push(0); e.shift(); e.push(0); }
    if (shift) { el.setAttribute('data-end', now); }
    return { c: c, e: e, changed: shift > 0 };
  }
  function draw(el, c, e) {
    el.setAttribute('data-counts', c.join(',')); el.setAttribute('data-errors', e.join(','));
    var max = Math.max(MIN, Math.max.apply(null, c));
    var title = el.querySelector('title'); var keep = title ? title.cloneNode(true) : null;
    while (el.firstChild) el.removeChild(el.firstChild);
    var total = 0, errs = 0;
    for (var i = 0; i < c.length; i++) {
      total += c[i]; errs += e[i];
      var h = c[i] ? Math.max(2, Math.round(c[i] / max * H)) : 1;
      var r = document.createElementNS(NS, 'rect');
      r.setAttribute('class', c[i] ? 'bar' : 'bar empty');
      r.setAttribute('x', i * (W + GAP)); r.setAttribute('y', H - h); r.setAttribute('width', W); r.setAttribute('height', h);
      el.appendChild(r);
      if (e[i]) {
        var eh = Math.max(2, Math.round(e[i] / max * H)), x = document.createElementNS(NS, 'rect');
        x.setAttribute('class', 'bar err');
        x.setAttribute('x', i * (W + GAP)); x.setAttribute('y', H - eh); x.setAttribute('width', W); x.setAttribute('height', eh);
        el.appendChild(x);
      }
    }
    var text = total + ' request' + (total === 1 ? '' : 's') + ' in the last ' + MINUTES + ' minutes' + (errs ? ', ' + errs + ' with errors' : '');
    if (keep) { keep.textContent = text; el.insertBefore(keep, el.firstChild); }
    el.setAttribute('aria-label', text);
    var id = el.getAttribute('data-spark');
    document.querySelectorAll('[data-spark-total="' + id + '"]').forEach(function (t) { t.textContent = total; t.title = text; });
  }
  document.addEventListener('mittens:request', function (ev) {
    var r = ev.detail, key = r.serviceId || '';
    document.querySelectorAll('svg.spark[data-spark="' + key + '"]').forEach(function (el) {
      var s = slide(el); s.c[N - 1]++; if (r.status >= 400) s.e[N - 1]++; draw(el, s.c, s.e);
    });
  });
  setInterval(function () {
    document.querySelectorAll('svg.spark').forEach(function (el) { var s = slide(el); if (s.changed) draw(el, s.c, s.e); });
  }, 5000);
})();`;

