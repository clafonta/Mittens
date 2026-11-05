import { raw } from "hono/html";
import type { Help, HelpTopic, SearchResult } from "../help.js";
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
});
// "/" jumps to the search box (unless you're typing somewhere); Escape clears it.
var search = document.getElementById('help-q');
document.addEventListener('keydown', function (e) {
  var t = e.target;
  if (e.key === '/' && search && !(t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement)) {
    e.preventDefault(); search.focus(); search.select();
  }
});
if (search) search.addEventListener('keydown', function (e) {
  if (e.key === 'Escape') { search.value = ''; document.getElementById('help-results').innerHTML = ''; search.blur(); }
});`;

function SearchBox({ query = "" }: { query?: string }) {
  return (
    <form class="help-search" action={`${BASE}/help/search`} method="get" role="search">
      <input
        id="help-q"
        type="search"
        name="q"
        value={query}
        placeholder="Search help"
        aria-label="Search help"
        aria-keyshortcuts="/"
        autocomplete="off"
        hx-get={`${BASE}/help/search`}
        hx-trigger="input changed delay:150ms, search"
        hx-target="#help-results"
        hx-push-url="false"
      />
      <kbd title="Press / to search">/</kbd>
      <div id="help-results" aria-live="polite"></div>
    </form>
  );
}

/** Sidebar (search + topics) and the main column, shared by topic and search pages. */
function HelpLayout({ help, current, query, children }: { help: Help; current?: HelpTopic; query?: string; children: unknown }) {
  return (
    <div class="help">
      <nav class="help-nav" aria-label="Help topics">
        <SearchBox query={query} />
        <a class={current?.slug === "" ? "current" : undefined} href={topicHref("")}>
          Overview
        </a>
        <ol>
          {help.topics.map((t) => (
            <li>
              <a class={t.slug === current?.slug ? "current" : undefined} href={topicHref(t.slug)} aria-current={t.slug === current?.slug ? "page" : undefined}>
                {t.title}
              </a>
              {t.slug === current?.slug && (
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
      <article class="prose">{children as never}</article>
      <script>{raw(copyScript)}</script>
    </div>
  );
}

export function HelpPage({ help, topic, html }: { help: Help; topic: HelpTopic; html: string }) {
  const index = help.topics.findIndex((t) => t.slug === topic.slug);
  const prev = index > 0 ? help.topics[index - 1] : index === 0 ? help.home : undefined;
  const next = index >= 0 ? help.topics[index + 1] : help.topics[0];
  return (
    <HelpLayout help={help} current={topic}>
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
    </HelpLayout>
  );
}

const resultHref = (r: SearchResult) => `${topicHref(r.slug)}${r.id ? `#${r.id}` : ""}`;

/** The list under the search box, updated as you type. */
export function SearchDropdown({ query, results, total }: { query: string; results: SearchResult[]; total: number }) {
  if (!query.trim()) return <></>;
  if (results.length === 0) return <p class="help-results-empty">No matches for “{query}”.</p>;
  return (
    <>
      <ul class="help-results">
        {results.map((r) => (
          <li>
            <a href={resultHref(r)}>
              <strong>{r.heading}</strong>
              {r.heading !== r.topicTitle && <span class="muted"> · {r.topicTitle}</span>}
            </a>
          </li>
        ))}
      </ul>
      {total > results.length && (
        <a class="help-results-all" href={`${BASE}/help/search?q=${encodeURIComponent(query)}`}>
          All {total} results
        </a>
      )}
    </>
  );
}

/** Full results page (also what Enter, or no JavaScript, gets you). */
export function SearchPage({ help, query, results }: { help: Help; query: string; results: SearchResult[] }) {
  return (
    <HelpLayout help={help} query={query}>
      <h1>{query.trim() ? `Search: ${query}` : "Search help"}</h1>
      {!query.trim() ? (
        <p class="muted">Type in the search box to find a topic or setting.</p>
      ) : results.length === 0 ? (
        <p>
          No matches for “{query}”. Try fewer or shorter words, or browse the <a href={topicHref("")}>topics</a>.
        </p>
      ) : (
        <>
          <p class="muted">
            {results.length} result{results.length === 1 ? "" : "s"}
          </p>
          <ol class="search-results">
            {results.map((r) => (
              <li>
                <a href={resultHref(r)}>
                  <strong>{r.heading}</strong>
                </a>
                {r.heading !== r.topicTitle && <span class="muted"> · {r.topicTitle}</span>}
                {r.snippet && <p>{raw(r.snippet)}</p>}
              </li>
            ))}
          </ol>
        </>
      )}
    </HelpLayout>
  );
}
