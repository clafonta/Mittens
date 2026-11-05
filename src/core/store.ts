import { type CompiledPath, compilePath, matchPath } from "./path.js";
import type { Repo } from "./repo.js";
import { Scenario, Service, type ServiceMode } from "./schema.js";

export class NotFoundError extends Error {}
export class ConflictError extends Error {}

export interface StoreOptions {
  /** When true, changes live in memory only and are never written to disk. */
  readOnly?: boolean;
}

interface Entry {
  service: Service;
  compiled: CompiledPath;
}

/** In-memory source of truth for definitions, written through to a Repo. */
export class Store {
  private entries = new Map<string, Entry>();

  constructor(
    private readonly repo: Repo,
    private readonly options: StoreOptions = {},
  ) {}

  get readOnly() {
    return this.options.readOnly ?? false;
  }

  async load(): Promise<void> {
    const services = await this.repo.loadAll();
    this.entries.clear();
    for (const s of services) this.entries.set(s.id, { service: s, compiled: compilePath(s.path) });
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
    if (this.entries.has(service.id)) throw new ConflictError(`Service '${service.id}' already exists`);
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

  /** Creates or replaces a scenario. */
  async putScenario(serviceId: string, input: unknown): Promise<Scenario> {
    const service = this.getService(serviceId);
    const scenario = Scenario.parse(input);
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

  private replace(service: Service) {
    const entry = this.entries.get(service.id)!;
    this.entries.set(service.id, { ...entry, service });
  }

  private validateRefs(service: Service) {
    const ids = new Set(service.scenarios.map((s) => s.id));
    for (const key of ["defaultScenario", "errorScenario"] as const) {
      const ref = service[key];
      if (ref && !ids.has(ref)) throw new NotFoundError(`${key} '${ref}' is not a scenario of '${service.id}'`);
    }
    if (service.mode === "proxy" && !service.upstream) {
      throw new ConflictError(`Service '${service.id}' is in proxy mode but has no upstream URL`);
    }
  }

  private async persist(write: () => Promise<void>) {
    if (!this.readOnly) await write();
  }
}
