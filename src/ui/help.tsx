import { raw } from "hono/html";
import type { Help, HelpTopic } from "../help.js";
import { BASE } from "../http/paths.js";

const topicHref = (slug: string) => (slug ? `${BASE}/help/${slug}` : `${BASE}/help`);

/**
 * A small "?" that opens a help section in a new tab, so nothing typed into
 * a form is lost. `to` is "topic" or "topic#section" (checked by tests).
 */
export const HelpLink = ({ to, label }: { to: string; label?: string }) => {
  const [slug = "", anchor] = to.split("#");
  return (
    <a class="help-link" href={`${topicHref(slug)}${anchor ? `#${anchor}` : ""}`} target="_blank" rel="noopener" title={label ?? "Help"} aria-label={label ?? "Help"}>
      ?
    </a>
  );
};

/** Copy buttons for code blocks; the only script on help pages. */
const copyScript = `
document.querySelectorAll('.prose pre').forEach(function (pre) {
  var b = document.createElement('button');
  b.type = 'button'; b.className = 'copy'; b.textContent = 'Copy';
  b.addEventListener('click', function () {
    navigator.clipboard.writeText(pre.querySelector('code') ? pre.querySelector('code').innerText : pre.innerText).then(function () {
      b.textContent = 'Copied'; setTimeout(function () { b.textContent = 'Copy'; }, 1500);
    });
  });
  pre.appendChild(b);
});`;

export function HelpPage({ help, topic, html }: { help: Help; topic: HelpTopic; html: string }) {
  const index = help.topics.findIndex((t) => t.slug === topic.slug);
  const prev = index > 0 ? help.topics[index - 1] : index === 0 ? help.home : undefined;
  const next = index >= 0 ? help.topics[index + 1] : help.topics[0];
  return (
    <div class="help">
      <nav class="help-nav" aria-label="Help topics">
        <a class={topic.slug === "" ? "current" : undefined} href={topicHref("")}>
          Overview
        </a>
        <ol>
          {help.topics.map((t) => (
            <li>
              <a class={t.slug === topic.slug ? "current" : undefined} href={topicHref(t.slug)} aria-current={t.slug === topic.slug ? "page" : undefined}>
                {t.title}
              </a>
              {t.slug === topic.slug && (
                <ul>
                  {t.headings
                    .filter((h) => h.depth === 2)
                    .map((h) => (
                      <li>
                        <a href={`#${h.id}`}>{h.text}</a>
                      </li>
                    ))}
                </ul>
              )}
            </li>
          ))}
        </ol>
      </nav>
      <article class="prose">
        {raw(html)}
        <nav class="pager" aria-label="More help">
          {prev ? (
            <a href={topicHref(prev.slug)}>
              <span class="muted">Previous</span>
              {prev.slug ? prev.title : "Overview"}
            </a>
          ) : (
            <span></span>
          )}
          {next && (
            <a class="next" href={topicHref(next.slug)}>
              <span class="muted">Next</span>
              {next.title}
            </a>
          )}
        </nav>
      </article>
      <script>{raw(copyScript)}</script>
    </div>
  );
}
