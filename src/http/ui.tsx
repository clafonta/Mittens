import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { type Context, Hono } from "hono";
import type { Child } from "hono/jsx";
import { z } from "zod";
import type { History } from "../core/history.js";
import { ServiceMode } from "../core/schema.js";
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
import { ProfileForm, ScenarioForm, ServiceForm } from "../ui/forms.js";
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
  ServiceRow,
  ServicesPage,
} from "../ui/pages.js";
import { errorStatus } from "./errors.js";
import { BASE } from "./paths.js";

const htmxSource = readFileSync(createRequire(import.meta.url).resolve("htmx.org/dist/htmx.min.js"), "utf8");

/** Redirect target after a POST, carrying a one-off status message. */
const withFlash = (path: string, flash: string) => `${path}?flash=${encodeURIComponent(flash)}`;

/** Only allow redirects back into the dashboard. */
const safeReturn = (v: string | undefined, fallback: string) =>
  v && (v === BASE || v.startsWith(`${BASE}/`)) && !v.startsWith("//") ? v : fallback;

/** HTML dashboard, mounted at /_mimic. */
export function createUi(store: Store, history: History) {
  const ui = new Hono();

  const page = (c: Context, title: string, body: Child, status: 200 | 404 | 422 = 200) =>
    c.html(
      <Layout title={title} readOnly={store.readOnly} flash={c.req.query("flash")}>
        {body}
      </Layout>,
      status,
    );

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

  ui.get("/assets/htmx.min.js", (c) => {
    c.header("content-type", "text/javascript; charset=utf-8");
    c.header("cache-control", "public, max-age=86400");
    return c.body(htmxSource);
  });

  // ------------------------------------------------------------- services

  ui.get("/", (c) =>
    page(c, "Services", <ServicesPage services={store.listServices()} profiles={profileInfos()} modified={store.modifiedServiceIds()} />),
  );

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
    return page(c, service.name, <ServicePage service={service} modified={store.isModified(service.id)} allModified={store.modifiedServiceIds()} />);
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
    return c.redirect(withFlash(BASE, `Deleted service '${service.name}'`), 303);
  });

  // ------------------------------------------------------------ scenarios

  const scenarioForm = (serviceId: string, values: FormValues, errors: FormErrors, scenarioId?: string) => (
    <ScenarioForm service={store.getService(serviceId)} scenarioId={scenarioId} values={values} errors={errors} />
  );

  ui.get("/services/:id/scenarios/new", (c) => {
    const service = store.getService(c.req.param("id"));
    const title = `New scenario for ${service.name}`;
    const defaults = { status: "200", headers: "content-type: application/json" };
    return page(c, title, <FormPage title={title}>{scenarioForm(service.id, defaults, {})}</FormPage>);
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
    if (!body.id) return c.redirect(safeReturn(body.return, BASE), 303);
    return apply(c, body.id, BASE);
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
    return c.redirect(withFlash(safeReturn(body.return, BASE), msg), 303);
  });
  ui.post("/state/reset", async (c) => {
    const body = toValues(await c.req.parseBody());
    const reset = store.resetLiveState();
    return c.redirect(withFlash(safeReturn(body.return, BASE), `Reset ${reset.length} service${reset.length === 1 ? "" : "s"} to starting state`), 303);
  });

  // -------------------------------------------------------------- history

  ui.get("/history", (c) => page(c, "History", <HistoryPage />));
  ui.get("/history/:id", (c) => {
    const entry = history.get(c.req.param("id"));
    if (!entry) return page(c, "Not found", <NotFoundPage message="That request is no longer in history." />, 404);
    return page(c, "Request", <HistoryEntryPage entry={entry} />);
  });

  // -------------------------------------------------------- htmx fragments

  ui.get("/ui/history", (c) => {
    const limit = Math.min(Number(c.req.query("limit") ?? 50) || 50, 500);
    const entries = history.list({ serviceId: c.req.query("service") }).slice(0, limit);
    return c.html(<HistoryTable entries={entries} />);
  });
  // Mode/default switcher: changes live state only.
  ui.post("/ui/services/:id", async (c) => {
    const form = toValues(await c.req.parseBody());
    const service = store.setLiveState(c.req.param("id"), {
      mode: ServiceMode.parse(form.mode),
      defaultScenario: form.defaultScenario || undefined,
    });
    c.header("HX-Trigger", "live-changed");
    return c.html(<ServiceRow service={service} modified={store.isModified(service.id)} />);
  });
  ui.post("/ui/services/:id/reset", (c) => {
    const id = c.req.param("id");
    store.resetLiveState(id);
    c.header("HX-Trigger", "live-changed");
    return c.html(<ServiceRow service={store.getService(id)} modified={false} />);
  });
  ui.get("/ui/live-banner", (c) =>
    c.html(<LiveStateBanner modified={store.modifiedServiceIds()} returnTo={safeReturn(c.req.query("return"), BASE)} />),
  );

  ui.all("*", (c) => page(c, "Not found", <NotFoundPage message={`No page at ${c.req.path}`} />, 404));
  return ui;
}
