import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { type Context, Hono } from "hono";
import type { Child } from "hono/jsx";
import { z } from "zod";
import { type Engine, renderScenario } from "../core/engine.js";
import type { History } from "../core/history.js";
import type { Hooks } from "../core/hooks.js";
import type { Rates } from "../core/rates.js";
import type { McpActivity } from "../mcp/activity.js";
import { scenarioFromHistory } from "../core/record.js";
import { applyImport, ImportError, importOptionsFrom, parseSpec, planImport, summarize } from "../core/openapi.js";
import { upstreamUrl } from "../core/rewrite.js";
import { hasAnyTag, ServiceMode } from "../core/schema.js";
import { StoreError, type Store } from "../core/store.js";
import {
  FormError,
  type FormErrors,
  type FormValues,
  PROFILE_FIELDS,
  profileFromForm,
  profileToValues,
  SCENARIO_FIELDS,
  scenarioFromForm,
  scenarioToValues,
  SERVICE_FIELDS,
  serviceFromForm,
  serviceToValues,
  toValues,
  zodToFormErrors,
} from "../ui/form-data.js";
import { loadHelp, withOrigin } from "../help.js";
import { ProfileForm, refValue, ScenarioForm, ServiceForm, SettingsForm } from "../ui/forms.js";
import { HelpPage, SearchDropdown, SearchPage } from "../ui/help.js";
import { HomePage } from "../ui/home.js";
import { AssistantActivity, AssistantsPage } from "../ui/assistants.js";
import { MCP_PATH } from "../mcp/http.js";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { Layout } from "../ui/layout.js";
import {
  FormPage,
  LiveStateBanner,
  HistoryEntryPage,
  HistoryPage,
  HistoryTable,
  NotFoundPage,
  type ProfileInfo,
  ProfilesPage,
  ServicePage,
  ServiceFlowLive,
  ServiceLive,
  ImportPage,
  ServicesPage,
  SettingsPage,
  RenderedPreview,
  UpstreamPreview,
} from "../ui/pages.js";
import { errorStatus } from "./errors.js";
import { BASE, SERVICES } from "./paths.js";

const htmxSource = readFileSync(createRequire(import.meta.url).resolve("htmx.org/dist/htmx.min.js"), "utf8");

const FAVICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="#4f46e5"/><path d="M8 23V9h3.2l4.8 7.2L20.8 9H24v14h-3V14.4l-5 7.3-5-7.3V23z" fill="#fff"/></svg>`;

/** Redirect target after a POST, carrying a one-off status message. */
const withFlash = (path: string, flash: string) => `${path}${path.includes("?") ? "&" : "?"}flash=${encodeURIComponent(flash)}`;

/** Only allow redirects back into the dashboard. */
const safeReturn = (v: string | undefined, fallback: string) =>
  v && (v === BASE || v.startsWith(`${BASE}/`) || v.startsWith(`${BASE}?`)) && !v.startsWith("//") ? v : fallback;

/** HTML dashboard, mounted at /_mimic. */
export function createUi(store: Store, history: History, engine: Engine, hooks: Hooks, rates: Rates, activity: McpActivity) {
  const rateOf = (id: string) => rates.series(id);
  const ui = new Hono();

  const page = (c: Context, title: string, body: Child, status: 200 | 404 | 422 = 200) =>
    c.html(
      <Layout title={title} readOnly={store.readOnly} flash={c.req.query("flash")} reloadError={store.reloadError} path={c.req.path}>
        {body}
      </Layout>,
      status,
    );

  const hookInfo = (id: string) => {
    const loaded = hooks.get(id);
    const error = hooks.error(id);
    return loaded || error ? { file: loaded?.name, exports: loaded?.exports ?? [], error, enabled: hooks.enabled } : undefined;
  };

  const profileInfos = (): ProfileInfo[] =>
    store.listProfiles().map((profile) => ({
      profile,
      active: store.isProfileActive(profile),
      problems: store.profileProblems(profile),
    }));

  /**
   * Shared POST handling: run `action` with the submitted values and redirect to
   * the URL it returns; on a validation or store error, re-render the form with
   * the submitted values and per-field messages.
   */
  async function submit(
    c: Context,
    opts: {
      title: string;
      fields: string[];
      render: (values: FormValues, errors: FormErrors) => Child;
      action: (values: FormValues) => Promise<string>;
    },
  ) {
    const values = toValues(await c.req.parseBody());
    try {
      return c.redirect(await opts.action(values), 303);
    } catch (err) {
      let errors: FormErrors;
      if (err instanceof FormError) errors = err.errors;
      else if (err instanceof z.ZodError) errors = zodToFormErrors(err, opts.fields);
      else if (err instanceof StoreError) errors = { [err.field ?? "_form"]: err.message };
      else throw err;
      return page(c, opts.title, <FormPage title={opts.title}>{opts.render(values, errors)}</FormPage>, 422);
    }
  }

  ui.onError((err, c) => {
    const status = errorStatus(err);
    if (status === 500) console.error(err);
    if (c.req.header("hx-request")) return c.text(err.message, status);
    return page(c, "Error", <NotFoundPage message={err.message} />, 404);
  });

  // ----------------------------------------------------------------- help

  const help = loadHelp(BASE);
  const helpPage = (c: Context, slug: string) => {
    const topic = help.get(slug);
    if (!topic) {
      return page(c, "Not found", <NotFoundPage message={`There's no help topic called '${slug}'.`} />, 404);
    }
    const html = withOrigin(topic.html, new URL(c.req.url).origin);
    return page(c, slug ? `${topic.title} · Help` : "Help", <HelpPage help={help} topic={topic} html={html} />);
  };
  ui.get("/help", (c) => helpPage(c, ""));
  ui.get("/help/search", (c) => {
    const query = (c.req.query("q") ?? "").slice(0, 200);
    if (c.req.header("hx-request")) {
      const results = help.search(query, 50);
      return c.html(<SearchDropdown query={query} results={results.slice(0, 8)} total={results.length} />);
    }
    const title = query.trim() ? `Search: ${query}` : "Search help";
    return page(c, `${title} · Help`, <SearchPage help={help} query={query} results={help.search(query, 50)} />);
  });
  ui.get("/help/:slug", (c) => helpPage(c, c.req.param("slug")));

  // With an icon of its own, the browser doesn't ask for /favicon.ico, which would land in History as mock traffic.
  ui.get("/assets/favicon.svg", (c) => {
    c.header("content-type", "image/svg+xml");
    c.header("cache-control", "public, max-age=86400");
    return c.body(FAVICON);
  });

  ui.get("/assets/htmx.min.js", (c) => {
    c.header("content-type", "text/javascript; charset=utf-8");
    c.header("cache-control", "public, max-age=86400");
    return c.body(htmxSource);
  });

  // ------------------------------------------------------------- services

  ui.get("/", (c) => {
    // Links from before the services list moved (e.g. /_mimic?tag=x) still land on it.
    const tag = c.req.query("tag");
    if (tag !== undefined) return c.redirect(`${SERVICES}?tag=${encodeURIComponent(tag)}`, 302);
    const services = store.listServices();
    const data = {
      services,
      modified: new Set(store.modifiedServiceIds()),
      inactive: new Set(services.filter((s) => !store.isActive(s)).map((s) => s.id)),
      activeProfile: store.listProfiles().find((p) => store.isProfileActive(p))?.name,
      activeTags: store.activeTags,
      history: history.list(),
      historyLimit: history.limit,
      origin: new URL(c.req.url).origin,
      rateOf,
    };
    return page(c, "Home", <HomePage data={data} />);
  });

  ui.get("/services", (c) => {
    const viewTag = c.req.query("tag")?.trim().toLowerCase() || undefined;
    const all = store.listServices();
    const services = viewTag ? all.filter((s) => hasAnyTag(s, [viewTag])) : all;
    return page(
      c,
      "Services",
      <ServicesPage
        services={services}
        profiles={profileInfos()}
        modified={store.modifiedServiceIds()}
        tags={store.allTags()}
        viewTag={viewTag}
        activeTags={store.activeTags}
        inactive={all.filter((s) => !store.isActive(s)).map((s) => s.id)}
        totalServices={all.length}
        rateOf={rateOf}
      />,
    );
  });

  const serviceForm = (values: FormValues, errors: FormErrors, id?: string) => (
    <ServiceForm service={id ? store.getDefinition(id) : undefined} values={values} errors={errors} />
  );

  ui.get("/services/new", (c) =>
    page(
      c,
      "New service",
      <FormPage title="New service">{serviceForm({ method: "ANY", mode: "static", delayMs: "0" }, {})}</FormPage>,
    ),
  );
  ui.post("/services", (c) =>
    submit(c, {
      title: "New service",
      fields: SERVICE_FIELDS,
      render: (v, e) => serviceForm(v, e),
      action: async (v) => {
        const service = await store.createService(serviceFromForm(v));
        return withFlash(`${BASE}/services/${service.id}`, `Created service '${service.name}'`);
      },
    }),
  );
  ui.get("/services/:id", (c) => {
    const service = store.getService(c.req.param("id"));
    return page(
      c,
      service.name,
      <ServicePage
        service={service}
        modified={store.isModified(service.id)}
        allModified={store.modifiedServiceIds()}
        inactive={!store.isActive(service)}
        globalError={store.getSettings().errorScenario}
        hook={hookInfo(service.id)}
        history={history.list({ serviceId: service.id })}
        rate={rateOf(service.id)}
      />,
    );
  });
  ui.get("/services/:id/edit", (c) => {
    const service = store.getDefinition(c.req.param("id"));
    return page(c, `Edit ${service.name}`, <FormPage title={`Edit ${service.name}`}>{serviceForm(serviceToValues(service), {}, service.id)}</FormPage>);
  });
  ui.post("/services/:id", (c) => {
    const id = c.req.param("id");
    const service = store.getService(id);
    return submit(c, {
      title: `Edit ${service.name}`,
      fields: SERVICE_FIELDS,
      render: (v, e) => serviceForm({ ...v, id }, e, id),
      action: async (v) => {
        const { id: _ignored, ...patch } = serviceFromForm(v);
        const updated = await store.updateService(id, patch);
        return withFlash(`${BASE}/services/${id}`, `Saved '${updated.name}'`);
      },
    });
  });
  ui.post("/services/:id/delete", async (c) => {
    const service = store.getService(c.req.param("id"));
    await store.deleteService(service.id);
    return c.redirect(withFlash(SERVICES, `Deleted service '${service.name}'`), 303);
  });

  // ------------------------------------------------------------ scenarios

  const scenarioForm = (serviceId: string, values: FormValues, errors: FormErrors, scenarioId?: string) => (
    <ScenarioForm service={store.getService(serviceId)} scenarioId={scenarioId} values={values} errors={errors} />
  );

  ui.get("/services/:id/scenarios/new", (c) => {
    const service = store.getService(c.req.param("id"));
    const title = `New scenario for ${service.name}`;
    const fromId = c.req.query("from");
    if (!fromId) {
      const defaults = { status: "200", headers: "content-type: application/json" };
      return page(c, title, <FormPage title={title}>{scenarioForm(service.id, defaults, {})}</FormPage>);
    }

    // Prefill from a recorded request/response.
    const entry = history.get(fromId);
    if (!entry) return page(c, "Not found", <NotFoundPage message="That request is no longer in history." />, 404);
    const draft = scenarioFromHistory(entry, service);
    const warnings = draft.warnings.map((w) => <div class={`banner${draft.blocked ? " error-banner" : ""}`}>{w}</div>);
    if (draft.blocked) {
      return page(
        c,
        title,
        <FormPage title={title}>
          {warnings}
          <a href={`${BASE}/history/${entry.id}`}>Back to the request</a>
        </FormPage>,
      );
    }
    return page(
      c,
      title,
      <FormPage title={`Save recorded response as a scenario of ${service.name}`}>
        {warnings}
        {scenarioForm(service.id, scenarioToValues(draft.scenario), {})}
      </FormPage>,
    );
  });
  ui.post("/services/:id/scenarios", (c) => {
    const service = store.getService(c.req.param("id"));
    return submit(c, {
      title: `New scenario for ${service.name}`,
      fields: SCENARIO_FIELDS,
      render: (v, e) => scenarioForm(service.id, v, e),
      action: async (v) => {
        const scenario = await store.putScenario(service.id, scenarioFromForm(v), { create: true });
        // The first scenario of a service becomes its default, so static mode works straight away.
        if (!store.getDefinition(service.id).defaultScenario) await store.updateService(service.id, { defaultScenario: scenario.id });
        return withFlash(`${BASE}/services/${service.id}`, `Created scenario '${scenario.name}'`);
      },
    });
  });
  ui.get("/services/:id/scenarios/:sid/edit", (c) => {
    const scenario = store.getScenario(c.req.param("id"), c.req.param("sid"));
    const title = `Edit ${scenario.name}`;
    return page(c, title, <FormPage title={title}>{scenarioForm(c.req.param("id"), scenarioToValues(scenario), {}, scenario.id)}</FormPage>);
  });
  ui.post("/services/:id/scenarios/:sid", (c) => {
    const serviceId = c.req.param("id");
    const scenario = store.getScenario(serviceId, c.req.param("sid"));
    return submit(c, {
      title: `Edit ${scenario.name}`,
      fields: SCENARIO_FIELDS,
      render: (v, e) => scenarioForm(serviceId, { ...v, id: scenario.id }, e, scenario.id),
      action: async (v) => {
        const saved = await store.putScenario(serviceId, { ...scenarioFromForm(v), id: scenario.id });
        return withFlash(`${BASE}/services/${serviceId}`, `Saved scenario '${saved.name}'`);
      },
    });
  });
  ui.post("/services/:id/scenarios/:sid/delete", async (c) => {
    const serviceId = c.req.param("id");
    const scenario = store.getScenario(serviceId, c.req.param("sid"));
    await store.deleteScenario(serviceId, scenario.id);
    return c.redirect(withFlash(`${BASE}/services/${serviceId}`, `Deleted scenario '${scenario.name}'`), 303);
  });

  // ------------------------------------------------------------- profiles

  const profileForm = (values: FormValues, errors: FormErrors, profileId?: string) => (
    <ProfileForm services={store.listServices()} profileId={profileId} values={values} errors={errors} />
  );

  async function apply(c: Context, id: string, fallback: string) {
    const body = toValues(await c.req.parseBody());
    const profile = store.getProfile(id);
    const changed = store.applyProfile(profile.id);
    const msg = `Applied '${profile.name}' (${changed.length} service${changed.length === 1 ? "" : "s"} changed)`;
    return c.redirect(withFlash(safeReturn(body.return, fallback), msg), 303);
  }

  ui.get("/profiles", (c) => page(c, "Profiles", <ProfilesPage profiles={profileInfos()} />));
  ui.get("/profiles/new", (c) => {
    // Start from the current state so "save what I have now" is one click.
    const values = profileToValues({ id: "", name: "", description: "", services: store.currentSettings() });
    return page(c, "New profile", <FormPage title="New profile">{profileForm({ ...values, id: "", name: "" }, {})}</FormPage>);
  });
  ui.post("/profiles", (c) =>
    submit(c, {
      title: "New profile",
      fields: PROFILE_FIELDS,
      render: (v, e) => profileForm(v, e),
      action: async (v) => {
        const profile = await store.putProfile(profileFromForm(v), { create: true });
        return withFlash(`${BASE}/profiles`, `Created profile '${profile.name}'`);
      },
    }),
  );
  ui.post("/profiles/apply", async (c) => {
    const body = toValues(await c.req.parseBody());
    if (!body.id) return c.redirect(safeReturn(body.return, SERVICES), 303);
    return apply(c, body.id, SERVICES);
  });
  ui.get("/profiles/:id/edit", (c) => {
    const profile = store.getProfile(c.req.param("id"));
    const title = `Edit ${profile.name}`;
    return page(c, title, <FormPage title={title}>{profileForm(profileToValues(profile), {}, profile.id)}</FormPage>);
  });
  ui.post("/profiles/:id", (c) => {
    const profile = store.getProfile(c.req.param("id"));
    return submit(c, {
      title: `Edit ${profile.name}`,
      fields: PROFILE_FIELDS,
      render: (v, e) => profileForm({ ...v, id: profile.id }, e, profile.id),
      action: async (v) => {
        const saved = await store.putProfile({ ...profileFromForm(v), id: profile.id });
        return withFlash(`${BASE}/profiles`, `Saved profile '${saved.name}'`);
      },
    });
  });
  ui.post("/profiles/:id/apply", (c) => apply(c, c.req.param("id"), `${BASE}/profiles`));
  ui.post("/profiles/:id/delete", async (c) => {
    const profile = store.getProfile(c.req.param("id"));
    await store.deleteProfile(profile.id);
    return c.redirect(withFlash(`${BASE}/profiles`, `Deleted profile '${profile.name}'`), 303);
  });

  // ----------------------------------------------------------- live state

  ui.post("/state/save", async (c) => {
    const body = toValues(await c.req.parseBody());
    const saved = await store.saveLiveState();
    const msg = store.readOnly
      ? `Read-only: kept ${saved.length} change${saved.length === 1 ? "" : "s"} in memory only`
      : `Saved ${saved.length} service${saved.length === 1 ? "" : "s"} as starting state`;
    return c.redirect(withFlash(safeReturn(body.return, SERVICES), msg), 303);
  });
  ui.post("/state/reset", async (c) => {
    const body = toValues(await c.req.parseBody());
    const reset = store.resetLiveState();
    return c.redirect(withFlash(safeReturn(body.return, SERVICES), `Reset ${reset.length} service${reset.length === 1 ? "" : "s"} to starting state`), 303);
  });

  ui.post("/services/:id/hook/reset", async (c) => {
    const id = store.getService(c.req.param("id")).id;
    hooks.resetState(id);
    return c.redirect(withFlash(`${BASE}/services/${id}`, "Cleared hook state"), 303);
  });

  ui.post("/state/tags", async (c) => {
    const body = toValues(await c.req.parseBody());
    const tags = store.setActiveTags((body.tags ?? "").split(","));
    const msg = tags.length ? `Only serving services tagged ${tags.join(", ")}` : "Serving all services";
    return c.redirect(withFlash(safeReturn(body.return, SERVICES), msg), 303);
  });

  // --------------------------------------------------------------- import

  ui.get("/import", (c) => page(c, "Import OpenAPI", <ImportPage values={{}} />));
  ui.post("/import", async (c) => {
    const body = await c.req.parseBody();
    const values = toValues(body);
    // An uploaded file wins over the textarea; either way the text goes back into the textarea for the next step.
    const file = body.file;
    const uploaded = file instanceof File && file.size > 0 ? await file.text() : undefined;
    const spec = uploaded ?? values.spec ?? "";
    const shown = { ...values, spec };
    if (!spec.trim()) return page(c, "Import OpenAPI", <ImportPage values={shown} error="Choose a file or paste a spec." />, 422);
    try {
      const plan = planImport(parseSpec(spec), {
        ...importOptionsFrom(values),
        existing: store.listServices().map((s) => ({ id: s.id, method: s.method, path: s.path })),
      });
      if (values.action !== "import") return page(c, "Import OpenAPI", <ImportPage values={shown} summary={summarize(plan)} />);
      const result = await applyImport(store, plan);
      return page(c, "Import OpenAPI", <ImportPage values={shown} summary={summarize(result)} imported />);
    } catch (err) {
      if (!(err instanceof ImportError)) throw err;
      return page(c, "Import OpenAPI", <ImportPage values={shown} error={err.message} />, 422);
    }
  });

  // ------------------------------------------------------------- settings

  const settingsPage = (c: Context, values: FormValues, errors: FormErrors, status: 200 | 422 = 200) =>
    page(
      c,
      "Settings",
      <SettingsPage problems={store.settingsProblems()}>
        <SettingsForm services={store.listServices()} values={values} errors={errors} />
      </SettingsPage>,
      status,
    );

  ui.get("/settings", (c) => settingsPage(c, { errorScenario: refValue(store.getSettings().errorScenario) }, {}));
  ui.post("/settings", async (c) => {
    const values = toValues(await c.req.parseBody());
    const [service, scenario] = (values.errorScenario ?? "").split("/");
    try {
      await store.putSettings({ ...store.getSettings(), errorScenario: service && scenario ? { service, scenario } : undefined });
    } catch (err) {
      if (!(err instanceof StoreError || err instanceof z.ZodError)) throw err;
      return settingsPage(c, values, { errorScenario: err instanceof StoreError ? err.message : "Choose a scenario from the list" }, 422);
    }
    return c.redirect(withFlash(`${BASE}/settings`, "Saved settings"), 303);
  });

  // -------------------------------------------------------------- history

  const validationFilter = (v: string | undefined) => (v === "pass" || v === "fail" ? v : undefined);
  ui.get("/history", (c) => page(c, "History", <HistoryPage validation={validationFilter(c.req.query("validation"))} persistedTo={history.persistedTo} limit={history.limit} />));
  ui.get("/history/:id", (c) => {
    const entry = history.get(c.req.param("id"));
    if (!entry) return page(c, "Not found", <NotFoundPage message="That request is no longer in history." />, 404);
    const service = entry.serviceId ? store.listServices().find((s) => s.id === entry.serviceId) : undefined;
    const original = entry.replayOf ? history.get(entry.replayOf) : undefined;
    return page(c, "Request", <HistoryEntryPage entry={entry} service={service} original={original} />);
  });
  ui.post("/history/:id/replay", async (c) => {
    const entry = history.get(c.req.param("id"));
    if (!entry) return page(c, "Not found", <NotFoundPage message="That request is no longer in history." />, 404);
    const replayed = await engine.replay(entry);
    if (!replayed) return c.redirect(withFlash(`${BASE}/history/${entry.id}`, "The request body was truncated, so it can't be replayed"), 303);
    return c.redirect(withFlash(`${BASE}/history/${replayed.id}`, `Replayed ${entry.request.method} ${entry.request.path}`), 303);
  });

  // -------------------------------------------------------- htmx fragments

  ui.get("/ui/history", (c) => {
    const limit = Math.min(Number(c.req.query("limit") ?? 50) || 50, 500);
    const entries = history.list({ serviceId: c.req.query("service"), validation: validationFilter(c.req.query("validation")) }).slice(0, limit);
    return c.html(<HistoryTable entries={entries} />);
  });
  const viewOf = (v: string | undefined) => (v === "bar" ? "bar" : "row");
  // Mode/default switcher: changes live state only.
  ui.post("/ui/services/:id", async (c) => {
    const form = toValues(await c.req.parseBody());
    const service = store.setLiveState(c.req.param("id"), {
      mode: ServiceMode.parse(form.mode),
      defaultScenario: form.defaultScenario || undefined,
    });
    c.header("HX-Trigger", "live-changed");
    return c.html(
      <ServiceLive service={service} modified={store.isModified(service.id)} inactive={!store.isActive(service)} view={viewOf(form.view)} rate={rateOf(service.id)} />,
    );
  });
  ui.post("/ui/services/:id/reset", async (c) => {
    const form = toValues(await c.req.parseBody());
    const id = c.req.param("id");
    store.resetLiveState(id);
    c.header("HX-Trigger", "live-changed");
    const service = store.getService(id);
    return c.html(<ServiceLive service={service} modified={false} inactive={!store.isActive(service)} view={viewOf(form.view)} rate={rateOf(service.id)} />);
  });
  ui.get("/ui/services/:id/upstream", (c) => {
    const service = store.getService(c.req.param("id"));
    const raw = c.req.query("path")?.trim();
    if (!raw) return c.html("");
    const url = new URL(raw.startsWith("/") ? raw : `/${raw}`, "http://mimic.local");
    const target = upstreamUrl(service, url);
    if (!target) return c.html("");
    const method = service.method === "ANY" ? "GET" : service.method;
    const matches = store.resolve(method, url.pathname, { includeInactive: true })?.service.id === service.id;
    return c.html(<UpstreamPreview url={target.toString()} matches={matches} />);
  });
  ui.post("/ui/services/:id/scenarios/:sid/render", async (c) => {
    const service = store.getService(c.req.param("id"));
    const scenario = store.getScenario(service.id, c.req.param("sid"));
    const form = toValues(await c.req.parseBody());
    return c.html(<RenderedPreview {...renderScenario(service, scenario, { method: form.method, path: form.path, body: form.body })} />);
  });
  ui.get("/ui/services/:id/flow", (c) => {
    const service = store.getService(c.req.param("id"));
    return c.html(
      <ServiceFlowLive
        service={service}
        history={history.list({ serviceId: service.id })}
        requestHook={!!hooks.get(service.id)?.exports.includes("request")}
        inactive={!store.isActive(service)}
      />,
    );
  });
  // ------------------------------------------------------- AI assistants

  // Installed from npm, assistants can launch the bridge with npx; from a checkout, with this copy's dist/cli.js.
  const packageRoot = fileURLToPath(new URL("../../", import.meta.url));
  const stdioCommand = packageRoot.includes(`${path.sep}node_modules${path.sep}`)
    ? { command: "npx", args: ["-y", "@clafonta/mimic"] }
    : { command: "node", args: [path.join(packageRoot, "dist", "cli.js")] };

  ui.get("/assistants", (c) =>
    page(c, "AI assistants", <AssistantsPage data={{ endpoint: `${new URL(c.req.url).origin}${BASE}${MCP_PATH}`, stdioCommand, activity }} />),
  );
  ui.get("/ui/assistants/activity", (c) => c.html(<AssistantActivity activity={activity} />));

  ui.get("/ui/live-banner", (c) =>
    c.html(<LiveStateBanner modified={store.modifiedServiceIds()} returnTo={safeReturn(c.req.query("return"), SERVICES)} />),
  );

  ui.all("*", (c) => page(c, "Not found", <NotFoundPage message={`No page at ${c.req.path}`} />, 404));
  return ui;
}
