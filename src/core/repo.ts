import { randomBytes } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { z } from "zod";
import { type Profile, ProfileFile, type Scenario, ScenarioFile, type Service, ServiceFile, Slug } from "./schema.js";

/**
 * Persists definitions as a git-friendly directory tree:
 *
 *   <root>/services/<service-id>/service.yaml
 *   <root>/services/<service-id>/scenarios/<scenario-id>.yaml
 *   <root>/profiles/<profile-id>.yaml
 */
export interface Repo {
  loadAll(): Promise<Service[]>;
  loadProfiles(): Promise<Profile[]>;
  saveProfile(profile: Profile): Promise<void>;
  deleteProfile(profileId: string): Promise<void>;
  saveService(service: Service): Promise<void>;
  deleteService(serviceId: string): Promise<void>;
  saveScenario(serviceId: string, scenario: Scenario): Promise<void>;
  deleteScenario(serviceId: string, scenarioId: string): Promise<void>;
}

export class LoadError extends Error {
  constructor(
    readonly file: string,
    cause: unknown,
  ) {
    const detail = cause instanceof z.ZodError ? z.prettifyError(cause) : String(cause);
    super(`Invalid definition in ${file}:\n${detail}`);
  }
}

const dump = (value: unknown) => YAML.stringify(value, { lineWidth: 0, blockQuote: "literal" });

/**
 * Write via a temp file + rename so readers (including the file watcher) never
 * see a half-written file. Temp names don't end in .yaml, so loaders skip them.
 */
async function writeAtomic(file: string, content: string) {
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.${randomBytes(4).toString("hex")}.tmp`);
  await writeFile(tmp, content);
  try {
    await rename(tmp, file);
  } catch (err) {
    await rm(tmp, { force: true });
    throw err;
  }
}

export class FileRepo implements Repo {
  constructor(readonly root: string) {}

  private servicesDir() {
    return path.join(this.root, "services");
  }
  private serviceDir(id: string) {
    return path.join(this.servicesDir(), Slug.parse(id));
  }
  private profilePath(id: string) {
    return path.join(this.root, "profiles", `${Slug.parse(id)}.yaml`);
  }
  private scenarioPath(serviceId: string, scenarioId: string) {
    return path.join(this.serviceDir(serviceId), "scenarios", `${Slug.parse(scenarioId)}.yaml`);
  }

  async loadAll(): Promise<Service[]> {
    const dir = this.servicesDir();
    if (!existsSync(dir)) return [];
    const entries = await readdir(dir, { withFileTypes: true });
    const services: Service[] = [];
    for (const entry of entries.filter((e) => e.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
      if (!Slug.safeParse(entry.name).success) continue;
      const serviceFile = path.join(dir, entry.name, "service.yaml");
      if (!existsSync(serviceFile)) continue;
      const def = await parseFile(serviceFile, ServiceFile);
      services.push({ ...def, id: entry.name, scenarios: await this.loadScenarios(entry.name) });
    }
    return services;
  }

  private async loadScenarios(serviceId: string): Promise<Scenario[]> {
    const dir = path.join(this.serviceDir(serviceId), "scenarios");
    if (!existsSync(dir)) return [];
    const files = (await readdir(dir)).filter((f) => f.endsWith(".yaml")).sort();
    const scenarios: Scenario[] = [];
    for (const file of files) {
      const id = file.slice(0, -".yaml".length);
      if (!Slug.safeParse(id).success) continue;
      scenarios.push({ ...(await parseFile(path.join(dir, file), ScenarioFile)), id });
    }
    return scenarios;
  }

  async loadProfiles(): Promise<Profile[]> {
    const dir = path.join(this.root, "profiles");
    if (!existsSync(dir)) return [];
    const profiles: Profile[] = [];
    for (const file of (await readdir(dir)).filter((f) => f.endsWith(".yaml")).sort()) {
      const id = file.slice(0, -".yaml".length);
      if (!Slug.safeParse(id).success) continue;
      profiles.push({ ...(await parseFile(path.join(dir, file), ProfileFile)), id });
    }
    return profiles;
  }

  async saveProfile(profile: Profile): Promise<void> {
    const { id, ...def } = profile;
    const file = this.profilePath(id);
    await mkdir(path.dirname(file), { recursive: true });
    await writeAtomic(file, dump(ProfileFile.parse(def)));
  }

  async deleteProfile(profileId: string): Promise<void> {
    await rm(this.profilePath(profileId), { force: true });
  }

  async saveService(service: Service): Promise<void> {
    const { id, scenarios: _scenarios, ...def } = service;
    const dir = this.serviceDir(id);
    await mkdir(path.join(dir, "scenarios"), { recursive: true });
    await writeAtomic(path.join(dir, "service.yaml"), dump(ServiceFile.parse(def)));
  }

  async deleteService(serviceId: string): Promise<void> {
    await rm(this.serviceDir(serviceId), { recursive: true, force: true });
  }

  async saveScenario(serviceId: string, scenario: Scenario): Promise<void> {
    const { id, ...def } = scenario;
    const file = this.scenarioPath(serviceId, id);
    await mkdir(path.dirname(file), { recursive: true });
    await writeAtomic(file, dump(ScenarioFile.parse(def)));
  }

  async deleteScenario(serviceId: string, scenarioId: string): Promise<void> {
    await rm(this.scenarioPath(serviceId, scenarioId), { force: true });
  }
}

/** Repo that keeps nothing on disk; used in tests. */
export class MemoryRepo implements Repo {
  constructor(
    private readonly seed: Service[] = [],
    private readonly profiles: Profile[] = [],
  ) {}
  async loadAll() {
    return structuredClone(this.seed);
  }
  async loadProfiles() {
    return structuredClone(this.profiles);
  }
  async saveProfile() {}
  async deleteProfile() {}
  async saveService() {}
  async deleteService() {}
  async saveScenario() {}
  async deleteScenario() {}
}

async function parseFile<T extends z.ZodType>(file: string, schema: T): Promise<z.infer<T>> {
  try {
    return schema.parse(YAML.parse(await readFile(file, "utf8")) ?? {});
  } catch (err) {
    throw new LoadError(file, err);
  }
}
