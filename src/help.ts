import { readdirSync, readFileSync } from "node:fs";
import { Marked, type Tokens } from "marked";

/**
 * In-app help, rendered from docs/help/*.md. The same files read well on
 * GitHub: links between topics are plain `other.md#anchor` links (rewritten
 * to dashboard URLs here), heading anchors follow GitHub's rules, and
 * examples use http://localhost:4000, which is replaced with the address
 * Mimic is actually running on.
 */

export interface HelpHeading {
  id: string;
  text: string;
  depth: number;
}

export interface HelpTopic {
  /** "" for the help home (README.md). */
  slug: string;
  title: string;
  html: string;
  /** The source, for tools that want plain text (e.g. the MCP read_help tool). */
  markdown: string;
  headings: HelpHeading[];
  /** Plain-text sections, split at h2/h3, for search. */
  sections: HelpSection[];
}

export interface HelpSection {
  /** Heading id, or "" for the text before the first section. */
  id: string;
  heading: string;
  text: string;
}

export interface SearchResult {
  slug: string;
  topicTitle: string;
  id: string;
  heading: string;
  /** Escaped HTML with the matched words in <mark>. */
  snippet: string;
  score: number;
}

export interface Help {
  home: HelpTopic;
  /** In the order the home page lists them. */
  topics: HelpTopic[];
  get(slug: string): HelpTopic | undefined;
  /** Every `slug#anchor` (and bare slug) that exists, for link checking. */
  targets: Set<string>;
  /** Sections containing every word of the query (words match at their start), best first. */
  search(query: string, limit?: number): SearchResult[];
}

/** The origin used in the Markdown examples. */
export const EXAMPLE_ORIGIN = "http://localhost:4000";
const DEFAULT_DIR = new URL("../docs/help/", import.meta.url);

/** GitHub's heading anchor rule: lowercase, drop punctuation, spaces to dashes. */
export function headingId(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/<[^>]*>/g, "")
    .replace(/[^\p{L}\p{N}\- _]/gu, "")
    .replace(/ /g, "-");
}

const escapeAttr = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

function render(markdown: string, slug: string, base: string): HelpTopic {
  const headings: HelpHeading[] = [];
  const used = new Map<string, number>();
  const marked = new Marked({ gfm: true });
  marked.use({
    renderer: {
      heading(this: { parser: { parseInline(t: Tokens.Generic[]): string } }, token: Tokens.Heading) {
        const inner = this.parser.parseInline(token.tokens);
        let id = headingId(token.text.replace(/`/g, ""));
        const seen = used.get(id) ?? 0;
        used.set(id, seen + 1);
        if (seen) id = `${id}-${seen}`;
        headings.push({ id, text: token.text.replace(/`/g, ""), depth: token.depth });
        const anchor = token.depth > 1 ? `<a class="anchor" href="#${id}" aria-label="Link to this section">#</a>` : "";
        return `<h${token.depth} id="${id}">${inner}${anchor}</h${token.depth}>\n`;
      },
      link(this: { parser: { parseInline(t: Tokens.Generic[]): string } }, token: Tokens.Link) {
        const inner = this.parser.parseInline(token.tokens);
        const local = /^([\w-]+)\.md(#[\w-]*)?$/.exec(token.href);
        if (local) {
          const target = local[1] === "README" ? `${base}/help` : `${base}/help/${local[1]}`;
          return `<a href="${escapeAttr(target + (local[2] ?? ""))}">${inner}</a>`;
        }
        const external = /^https?:\/\//.test(token.href) && !token.href.startsWith(EXAMPLE_ORIGIN);
        return `<a href="${escapeAttr(token.href)}"${external ? ' target="_blank" rel="noopener"' : ""}>${inner}</a>`;
      },
    },
  });
  const html = marked.parse(markdown, { async: false });
  const title = headings.find((h) => h.depth === 1)?.text ?? slug;
  return { slug, title, html, markdown, headings, sections: sectionsOf(markdown, headings) };
}

/** Markdown → plain text, near enough for searching and snippets. */
function plain(md: string): string {
  return md
    .replace(/```[^\n]*\n/g, "")
    .replace(/```/g, "")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1") // links: keep the text
    .replace(/^\s*\|?[-: |]+\|?\s*$/gm, "") // table separator rows
    .replace(/^\s*(?:[-*>]|\d+\.)\s+/gm, "") // list markers, quotes
    .replace(/\*\*|`/g, "") // bold and code markers; _ and * stay (HTTP_PROXY, [*])
    .replace(/\|/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function sectionsOf(markdown: string, headings: HelpHeading[]): HelpSection[] {
  const sections: HelpSection[] = [];
  // Headings come back in document order, so the nth h2/h3 here is the nth in `headings`.
  const deep = headings.filter((h) => h.depth === 2 || h.depth === 3);
  let current: HelpSection = { id: "", heading: "", text: "" };
  let n = 0;
  let inFence = false;
  for (const line of markdown.split("\n")) {
    if (line.startsWith("```")) inFence = !inFence;
    const m = !inFence && /^(#{1,3}) (.*)$/.exec(line);
    if (m && m[1]!.length === 1) continue;
    if (m) {
      sections.push(current);
      const h = deep[n++];
      current = { id: h?.id ?? "", heading: h?.text ?? m[2]!, text: "" };
    } else current.text += `${line}\n`;
  }
  sections.push(current);
  return sections.map((s) => ({ ...s, text: plain(s.text) })).filter((s) => s.heading || s.text);
}

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Words in a query: lowercase, punctuation that isn't part of a word dropped. */
export function searchTerms(query: string): string[] {
  return [...new Set(query.toLowerCase().match(/[\p{L}\p{N}$][\p{L}\p{N}_.$-]*/gu) ?? [])].map((t) => t.replace(/[.-]+$/, "")).filter(Boolean).slice(0, 8);
}

/** How often `term` starts a word in `text`. */
function hits(text: string, term: string): number {
  return (text.match(new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegex(term)}`, "giu")) ?? []).length;
}

function snippet(text: string, terms: string[], width = 180): string {
  const lower = text.toLowerCase();
  const found = terms.map((t) => lower.indexOf(t)).filter((i) => i >= 0);
  const first = found.length ? Math.min(...found) : 0; // only the heading matched: show the start
  let start = Math.max(0, first - 50);
  if (start > 0) start = text.indexOf(" ", start) + 1 || start;
  let piece = text.slice(start, start + width);
  if (start + width < text.length) piece = piece.slice(0, piece.lastIndexOf(" ") > 0 ? piece.lastIndexOf(" ") : piece.length);
  const marked = escapeHtml(piece).replace(
    new RegExp(`(?<![\\p{L}\\p{N}])(${terms.map((t) => escapeRegex(escapeHtml(t))).join("|")})`, "giu"),
    "<mark>$1</mark>",
  );
  return `${start > 0 ? "… " : ""}${marked}${start + width < text.length ? " …" : ""}`;
}

/** Loads and renders every topic. `base` is the dashboard path, e.g. /_mimic. */
export function loadHelp(base: string, dir: URL | string = DEFAULT_DIR): Help {
  const folder = typeof dir === "string" ? dir : dir.pathname;
  const read = (name: string) => readFileSync(new URL(name, typeof dir === "string" ? `file://${dir.replace(/\/?$/, "/")}` : dir), "utf8");
  const homeText = read("README.md");
  const home = render(homeText, "", base);

  // Topic order comes from the links on the home page; files it doesn't link go last.
  const linked = [...homeText.matchAll(/\]\(([\w-]+)\.md\)/g)].map((m) => m[1]!).filter((s) => s !== "README");
  const files = readdirSync(folder)
    .filter((f) => f.endsWith(".md") && f !== "README.md")
    .map((f) => f.slice(0, -3));
  const order = [...new Set([...linked.filter((s) => files.includes(s)), ...files.sort()])];
  const topics = order.map((slug) => render(read(`${slug}.md`), slug, base));

  const bySlug = new Map(topics.map((t) => [t.slug, t]));
  const targets = new Set<string>([""]);
  for (const t of [home, ...topics]) {
    targets.add(t.slug);
    for (const h of t.headings) targets.add(`${t.slug}#${h.id}`);
  }
  const search = (query: string, limit = 20): SearchResult[] => {
    const terms = searchTerms(query);
    if (terms.length === 0) return [];
    const results: SearchResult[] = [];
    for (const topic of topics) {
      for (const section of topic.sections) {
        let score = 0;
        let all = true;
        for (const term of terms) {
          const inHeading = hits(section.heading, term);
          const inTitle = hits(topic.title, term);
          const inText = Math.min(hits(section.text, term), 5);
          if (!inHeading && !inTitle && !inText) {
            all = false;
            break;
          }
          score += inHeading * 6 + inTitle * 3 + inText;
        }
        if (!all) continue;
        results.push({
          slug: topic.slug,
          topicTitle: topic.title,
          id: section.id,
          heading: section.heading || topic.title,
          snippet: snippet(section.text, terms),
          score,
        });
      }
    }
    return results.sort((a, b) => b.score - a.score).slice(0, limit);
  };

  return { home, topics, get: (slug) => (slug === "" ? home : bySlug.get(slug)), targets, search };
}

/** Shows examples with the address Mimic is really on. */
export const withOrigin = (html: string, origin: string) => (origin === EXAMPLE_ORIGIN ? html : html.split(EXAMPLE_ORIGIN).join(origin));
