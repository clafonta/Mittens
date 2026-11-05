import { type CompiledPath, compilePath, matchPath } from "./path.js";
import type { Repo } from "./repo.js";
import { Profile, ProfileEntry, Scenario, Service, type ServiceMode } from "./schema.js";

/** Store errors may name the input field at fault so forms can show the message in place. */
export class StoreError extends Error {
  constructor(
    message: string,
    readonly field?: string,
  ) {
    super(message);
  }
}
export class NotFoundError extends StoreError {}
export class ConflictError extends StoreError {}

export interface StoreOptions {
  /** When true, changes live in memory only and are never written to disk. */
  readOnly?: boolean;
}

/** IDs that would collide with dashboard routes such as /services/new. */
const RESERVED_IDS = new Set(["new", "apply"]);
function assertNotReserved(id: string) {
  if (RESERVED_IDS.has(id)) throw new ConflictError(`'${id}' is reserved; choose another ID`, "id");
}

interface Entry {
  service: Service;
  compiled: CompiledPath;
}

/** In-memory source of truth for definitions, written through to a Repo. */
export class Store {
  private entries = new Map<string, Entry>();
  private profiles = new Map<string, Profile>();

  constructor(
    private readonly repo: Repo,
    private readonly options: StoreOptions = {},
  ) {}

  get readOnly() {
    return this.options.readOnly ?? false;
  }

  async load(): Promise<void> {
    const [services, profiles] = await Promise.all([this.repo.loadAll(), this.repo.loadProfiles()]);
    this.entries.clear();
    for (const s of services) this.entries.set(s.id, { service: s, compiled: compilePath(s.path) });
    this.profiles = new Map(profiles.map((p) => [p.id, p]));
  }

  listServices(): Service[] {
    return [...this.entries.values()].map((e) => e.service).sort((a, b) => a.name.localeCompare(b.name));
  }

  getService(id: string): Service {
    const entry = this.entries.get(id);
    if (!entry) throw new NotFoundError(`Service '${id}' not found`);
    return entry.service;
  }

  getScenario(serviceId: string, scenarioId: string): Scenario {
    const scenario = this.getService(serviceId).scenarios.find((s) => s.id === scenarioId);
    if (!scenario) throw new NotFoundError(`Scenario '${scenarioId}' not found in service '${serviceId}'`);
    return scenario;
  }

  /**
   * Finds the service for an incoming request. When several services match,
   * the most specific path wins, then an exact method beats ANY.
   */
  resolve(method: string, path: string): { service: Service; params: Record<string, string> } | null {
    let best: { service: Service; params: Record<string, string>; rank: number } | null = null;
    for (const { service, compiled } of this.entries.values()) {
      if (service.method !== "ANY" && service.method !== method.toUpperCase()) continue;
      const params = matchPath(compiled, path);
      if (!params) continue;
      const rank = compiled.specificity * 2 + (service.method === "ANY" ? 0 : 1);
      if (!best || rank > best.rank) best = { service, params, rank };
    }
    return best && { service: best.service, params: best.params };
  }

  async createService(input: unknown): Promise<Service> {
    const service = Service.parse(input);
    assertNotReserved(service.id);
    if (this.entries.has(service.id)) throw new ConflictError(`Service '${service.id}' already exists`, "id");
    this.validateRefs(service);
    await this.persist(async () => {
      await this.repo.saveService(service);
      for (const sc of service.scenarios) await this.repo.saveScenario(service.id, sc);
    });
    this.entries.set(service.id, { service, compiled: compilePath(service.path) });
    return service;
  }

  /** Updates service-level fields; scenarios are managed separately. */
  async updateService(id: string, patch: Record<string, unknown>): Promise<Service> {
    const current = this.getService(id);
    const service = Service.parse({ ...current, ...patch, id, scenarios: current.scenarios });
    this.validateRefs(service);
    await this.persist(() => this.repo.saveService(service));
    this.entries.set(id, { service, compiled: compilePath(service.path) });
    return service;
  }

  setMode(id: string, mode: ServiceMode) {
    return this.updateService(id, { mode });
  }

  async deleteService(id: string): Promise<void> {
    this.getService(id);
    await this.persist(() => this.repo.deleteService(id));
    this.entries.delete(id);
  }

  /** Creates or replaces a scenario. With `create`, an existing id is a conflict. */
  async putScenario(serviceId: string, input: unknown, opts: { create?: boolean } = {}): Promise<Scenario> {
    const service = this.getService(serviceId);
    const scenario = Scenario.parse(input);
    if (opts.create && service.scenarios.some((s) => s.id === scenario.id)) {
      throw new ConflictError(`Scenario '${scenario.id}' already exists in '${serviceId}'`, "id");
    }
    await this.persist(() => this.repo.saveScenario(serviceId, scenario));
    const scenarios = service.scenarios.filter((s) => s.id !== scenario.id).concat(scenario);
    scenarios.sort((a, b) => a.id.localeCompare(b.id));
    this.replace({ ...service, scenarios });
    return scenario;
  }

  async deleteScenario(serviceId: string, scenarioId: string): Promise<void> {
    const service = this.getService(serviceId);
    this.getScenario(serviceId, scenarioId);
    const next: Service = {
      ...service,
      scenarios: service.scenarios.filter((s) => s.id !== scenarioId),
      defaultScenario: service.defaultScenario === scenarioId ? undefined : service.defaultScenario,
      errorScenario: service.errorScenario === scenarioId ? undefined : service.errorScenario,
    };
    await this.persist(async () => {
      await this.repo.deleteScenario(serviceId, scenarioId);
      await this.repo.saveService(next);
    });
    this.replace(next);
  }

  // ------------------------------------------------------------- profiles

  listProfiles(): Profile[] {
    return [...this.profiles.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  getProfile(id: string): Profile {
    const profile = this.profiles.get(id);
    if (!profile) throw new NotFoundError(`Profile '${id}' not found`);
    return profile;
  }

  /** Creates or replaces a profile. With `create`, an existing id is a conflict. */
  async putProfile(input: unknown, opts: { create?: boolean } = {}): Promise<Profile> {
    const profile = Profile.parse(input);
    if (opts.create) assertNotReserved(profile.id);
    if (opts.create && this.profiles.has(profile.id)) throw new ConflictError(`Profile '${profile.id}' already exists`, "id");
    await this.persist(() => this.repo.saveProfile(profile));
    this.profiles.set(profile.id, profile);
    return profile;
  }

  async deleteProfile(id: string): Promise<void> {
    this.getProfile(id);
    await this.persist(() => this.repo.deleteProfile(id));
    this.profiles.delete(id);
  }

  /** Every service's current mode and default scenario, in profile form. */
  currentSettings(): Record<string, ProfileEntry> {
    const services: Record<string, ProfileEntry> = {};
    for (const s of this.listServices()) {
      services[s.id] = s.defaultScenario ? { mode: s.mode, scenario: s.defaultScenario } : { mode: s.mode };
    }
    return services;
  }

  /** Problems that would stop a profile from applying (missing services, scenarios, upstreams). */
  profileProblems(profile: Profile): string[] {
    const problems: string[] = [];
    for (const [serviceId, entry] of Object.entries(profile.services)) {
      const service = this.entries.get(serviceId)?.service;
      if (!service) {
        problems.push(`Service '${serviceId}' does not exist`);
        continue;
      }
      if (entry.scenario && !service.scenarios.some((s) => s.id === entry.scenario)) {
        problems.push(`Scenario '${entry.scenario}' does not exist in '${serviceId}'`);
      }
      if (entry.mode === "proxy" && !service.upstream) problems.push(`'${serviceId}' has no upstream for proxy mode`);
    }
    return problems;
  }

  /** True when every service the profile lists currently has the profile's settings. */
  isProfileActive(profile: Profile): boolean {
    const entries = Object.entries(profile.services);
    if (entries.length === 0) return false;
    return entries.every(([serviceId, entry]) => {
      const service = this.entries.get(serviceId)?.service;
      return (
        !!service &&
        (entry.mode === undefined || service.mode === entry.mode) &&
        (entry.scenario === undefined || service.defaultScenario === entry.scenario)
      );
    });
  }

  /** Applies a profile all-or-nothing: if anything is invalid, nothing changes. */
  async applyProfile(id: string): Promise<Service[]> {
    const profile = this.getProfile(id);
    const problems = this.profileProblems(profile);
    if (problems.length) throw new ConflictError(`Cannot apply '${profile.name}': ${problems.join("; ")}`);

    const changed: Service[] = [];
    for (const [serviceId, entry] of Object.entries(profile.services)) {
      const current = this.getService(serviceId);
      const next: Service = {
        ...current,
        mode: entry.mode ?? current.mode,
        defaultScenario: entry.scenario ?? current.defaultScenario,
      };
      if (next.mode !== current.mode || next.defaultScenario !== current.defaultScenario) changed.push(next);
    }
    await this.persist(async () => {
      for (const s of changed) await this.repo.saveService(s);
    });
    for (const s of changed) this.replace(s);
    return changed;
  }

  // ------------------------------------------------------------- internals

  private replace(service: Service) {
    const entry = this.entries.get(service.id)!;
    this.entries.set(service.id, { ...entry, service });
  }

  private validateRefs(service: Service) {
    const ids = new Set(service.scenarios.map((s) => s.id));
    for (const key of ["defaultScenario", "errorScenario"] as const) {
      const ref = service[key];
      if (ref && !ids.has(ref)) throw new NotFoundError(`'${ref}' is not a scenario of '${service.id}'`, key);
    }
    if (service.mode === "proxy" && !service.upstream) {
      throw new ConflictError(`Proxy mode needs an upstream URL`, "upstream");
    }
  }

  private async persist(write: () => Promise<void>) {
    if (!this.readOnly) await write();
  }
}
