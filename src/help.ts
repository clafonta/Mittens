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
  headings: HelpHeading[];
}

export interface Help {
  home: HelpTopic;
  /** In the order the home page lists them. */
  topics: HelpTopic[];
  get(slug: string): HelpTopic | undefined;
  /** Every `slug#anchor` (and bare slug) that exists, for link checking. */
  targets: Set<string>;
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
  return { slug, title, html, headings };
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
  return { home, topics, get: (slug) => (slug === "" ? home : bySlug.get(slug)), targets };
}

/** Shows examples with the address Mimic is really on. */
export const withOrigin = (html: string, origin: string) => (origin === EXAMPLE_ORIGIN ? html : html.split(EXAMPLE_ORIGIN).join(origin));
