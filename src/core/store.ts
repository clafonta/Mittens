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
  /** The service as defined on disk. */
  service: Service;
  compiled: CompiledPath;
}

/** What is selected for a service right now. Lives in memory only. */
export interface LiveState {
  mode: ServiceMode;
  defaultScenario: string | undefined;
}

/**
 * In-memory source of truth for definitions, written through to a Repo.
 *
 * Definitions (YAML) hold each service's *starting* mode and default scenario.
 * Switching modes, picking a default and applying profiles change only the
 * live state, which is kept in memory and resets on restart; `saveLiveState()`
 * writes it back to the definitions on purpose. Reads (`getService`,
 * `listServices`, `resolve`) return the live view.
 */
export class Store {
  private entries = new Map<string, Entry>();
  private profiles = new Map<string, Profile>();
  /** Overrides for services whose live state differs from their definition. */
  private live = new Map<string, LiveState>();

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
    this.live.clear();
    for (const s of services) this.entries.set(s.id, { service: s, compiled: compilePath(s.path) });
    this.profiles = new Map(profiles.map((p) => [p.id, p]));
  }

  /** All services, live view. */
  listServices(): Service[] {
    return [...this.entries.values()].map((e) => this.withLive(e.service)).sort((a, b) => a.name.localeCompare(b.name));
  }

  /** A service, live view: mode and default scenario reflect the current selection. */
  getService(id: string): Service {
    return this.withLive(this.getDefinition(id));
  }

  /** A service exactly as defined on disk (starting mode and default scenario). */
  getDefinition(id: string): Service {
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
    for (const { service: definition, compiled } of this.entries.values()) {
      const service = this.withLive(definition);
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

  /**
   * Updates a service's definition (written to disk); scenarios are managed
   * separately. Changing the starting mode or default scenario also makes it
   * the live value for that field, so the edit takes effect immediately.
   */
  async updateService(id: string, patch: Record<string, unknown>): Promise<Service> {
    const before = this.getDefinition(id);
    const service = Service.parse({ ...before, ...patch, id, scenarios: before.scenarios });
    this.validateRefs(service);
    await this.persist(() => this.repo.saveService(service));
    this.entries.set(id, { service, compiled: compilePath(service.path) });

    const live = this.live.get(id);
    if (live) {
      const next: LiveState = {
        mode: service.mode !== before.mode ? service.mode : live.mode,
        defaultScenario: service.defaultScenario !== before.defaultScenario ? service.defaultScenario : live.defaultScenario,
      };
      // If the edit made the override impossible (e.g. upstream removed while live in proxy), drop it.
      if (this.liveProblems(service, next).length) this.live.delete(id);
      else this.storeLive(service, next);
    }
    return this.getService(id);
  }

  async deleteService(id: string): Promise<void> {
    this.getDefinition(id);
    await this.persist(() => this.repo.deleteService(id));
    this.entries.delete(id);
    this.live.delete(id);
  }

  // ----------------------------------------------------------- live state

  /** Changes what a service does right now, without touching its definition. */
  setLiveState(id: string, patch: Partial<LiveState>): Service {
    const definition = this.getDefinition(id);
    const current = this.liveOf(definition);
    const next: LiveState = {
      mode: patch.mode ?? current.mode,
      defaultScenario: "defaultScenario" in patch ? patch.defaultScenario : current.defaultScenario,
    };
    const problems = this.liveProblems(definition, next);
    if (problems.length) {
      const [first] = problems;
      throw new ConflictError(first!.message, first!.field);
    }
    this.storeLive(definition, next);
    return this.getService(id);
  }

  /** IDs of services whose live state differs from their definition. */
  modifiedServiceIds(): string[] {
    return [...this.live.keys()].sort();
  }

  isModified(id: string): boolean {
    return this.live.has(id);
  }

  /** Discards live changes for one service, or all services, returning to the definitions. */
  resetLiveState(id?: string): string[] {
    if (id !== undefined) {
      this.getDefinition(id);
      return this.live.delete(id) ? [id] : [];
    }
    const ids = this.modifiedServiceIds();
    this.live.clear();
    return ids;
  }

  /** Writes the live state of every modified service back to its definition. */
  async saveLiveState(): Promise<string[]> {
    const ids = this.modifiedServiceIds();
    for (const id of ids) {
      const live = this.live.get(id)!;
      await this.updateService(id, { mode: live.mode, defaultScenario: live.defaultScenario });
      this.live.delete(id);
    }
    return ids;
  }

  /** Creates or replaces a scenario. With `create`, an existing id is a conflict. */
  async putScenario(serviceId: string, input: unknown, opts: { create?: boolean } = {}): Promise<Scenario> {
    const service = this.getDefinition(serviceId);
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
    const service = this.getDefinition(serviceId);
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
    const live = this.live.get(serviceId);
    if (live?.defaultScenario === scenarioId) this.storeLive(next, { ...live, defaultScenario: undefined });
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
      const service = this.entries.has(serviceId) ? this.getService(serviceId) : undefined;
      return (
        !!service &&
        (entry.mode === undefined || service.mode === entry.mode) &&
        (entry.scenario === undefined || service.defaultScenario === entry.scenario)
      );
    });
  }

  /**
   * Applies a profile to the live state, all-or-nothing: if anything is
   * invalid, nothing changes. Definitions on disk are not touched.
   */
  applyProfile(id: string): Service[] {
    const profile = this.getProfile(id);
    const problems = this.profileProblems(profile);
    if (problems.length) throw new ConflictError(`Cannot apply '${profile.name}': ${problems.join("; ")}`);

    const changed: string[] = [];
    for (const [serviceId, entry] of Object.entries(profile.services)) {
      const definition = this.getDefinition(serviceId);
      const current = this.liveOf(definition);
      const next: LiveState = { mode: entry.mode ?? current.mode, defaultScenario: entry.scenario ?? current.defaultScenario };
      if (next.mode !== current.mode || next.defaultScenario !== current.defaultScenario) {
        this.storeLive(definition, next);
        changed.push(serviceId);
      }
    }
    return changed.map((sid) => this.getService(sid));
  }

  // ------------------------------------------------------------- internals

  private liveOf(definition: Service): LiveState {
    return this.live.get(definition.id) ?? { mode: definition.mode, defaultScenario: definition.defaultScenario };
  }

  private withLive(definition: Service): Service {
    const live = this.live.get(definition.id);
    return live ? { ...definition, mode: live.mode, defaultScenario: live.defaultScenario } : definition;
  }

  /** Records a live state, dropping the override when it matches the definition. */
  private storeLive(definition: Service, state: LiveState) {
    if (state.mode === definition.mode && state.defaultScenario === definition.defaultScenario) this.live.delete(definition.id);
    else this.live.set(definition.id, state);
  }

  private liveProblems(definition: Service, state: LiveState): { message: string; field: string }[] {
    const problems: { message: string; field: string }[] = [];
    if (state.defaultScenario && !definition.scenarios.some((s) => s.id === state.defaultScenario)) {
      problems.push({ message: `'${state.defaultScenario}' is not a scenario of '${definition.id}'`, field: "defaultScenario" });
    }
    if (state.mode === "proxy" && !definition.upstream) {
      problems.push({ message: `Proxy mode needs an upstream URL`, field: "mode" });
    }
    return problems;
  }

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
