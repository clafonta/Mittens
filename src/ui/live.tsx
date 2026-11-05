import { raw } from "hono/html";
import { BASE } from "../http/paths.js";
import { FLOW_SCRIPT } from "./flow.js";
import { SPARK_SCRIPT } from "./spark.js";

/**
 * One EventSource per page; each request is re-dispatched as a
 * `mimic:request` DOM event for the diagram and sparklines to pick up.
 */
const CONNECT_SCRIPT = `
(function () {
  if (!window.EventSource || window.__mimicLive) return;
  window.__mimicLive = true;
  function status(text) { document.querySelectorAll('[data-live-status]').forEach(function (s) { s.textContent = text; }); }
  var es = new EventSource('${BASE}/api/events');
  es.addEventListener('request', function (m) {
    var r; try { r = JSON.parse(m.data); } catch (e) { return; }
    document.dispatchEvent(new CustomEvent('mimic:request', { detail: r }));
  });
  es.addEventListener('open', function () { status('Live'); });
  es.addEventListener('error', function () { status('Reconnecting…'); });
})();`;

/** Live behaviour for a page: the listeners it needs, then the connection. Include once per page. */
export const LiveScripts = ({ flow = false, sparks = false }: { flow?: boolean; sparks?: boolean }) => (
  <script>{raw([flow && FLOW_SCRIPT, sparks && SPARK_SCRIPT, CONNECT_SCRIPT].filter(Boolean).join("\n"))}</script>
);
