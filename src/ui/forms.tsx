import type { Child } from "hono/jsx";
import { HttpMethod, ServiceMode, type Service } from "../core/schema.js";
import { BASE, SERVICES } from "../http/paths.js";
import type { FormErrors, FormValues } from "./form-data.js";
import { HelpLink } from "./help.js";

interface FieldProps {
  name: string;
  label: string;
  values: FormValues;
  errors: FormErrors;
  hint?: Child;
  /** Help section for a "?" next to the label, e.g. "services#modes". */
  help?: string;
}

const fieldId = (name: string) => `f-${name.replace(/[^a-zA-Z0-9-]/g, "-")}`;

function Field(props: FieldProps & { children: Child }) {
  const error = props.errors[props.name];
  return (
    <div class={`field${error ? " invalid" : ""}`}>
      <label for={fieldId(props.name)}>
        {props.label}
        {props.help && <HelpLink to={props.help} label={`Help: ${props.label}`} />}
      </label>
      {props.children}
      {error ? <div class="error">{error}</div> : props.hint && <div class="hint">{props.hint}</div>}
    </div>
  );
}

export function Text(props: FieldProps & { required?: boolean; placeholder?: string; readonly?: boolean; type?: string }) {
  return (
    <Field {...props}>
      <input
        id={fieldId(props.name)}
        name={props.name}
        type={props.type ?? "text"}
        value={props.values[props.name] ?? ""}
        required={props.required}
        placeholder={props.placeholder}
        readonly={props.readonly}
        aria-invalid={props.errors[props.name] ? "true" : undefined}
      />
    </Field>
  );
}

export function TextArea(props: FieldProps & { rows?: number; placeholder?: string; mono?: boolean }) {
  return (
    <Field {...props}>
      <textarea
        id={fieldId(props.name)}
        name={props.name}
        rows={props.rows ?? 3}
        placeholder={props.placeholder}
        class={props.mono ? "mono" : undefined}
        spellcheck={props.mono ? false : undefined}
        aria-invalid={props.errors[props.name] ? "true" : undefined}
      >
        {props.values[props.name] ?? ""}
      </textarea>
    </Field>
  );
}

export function Checkbox(props: FieldProps) {
  const error = props.errors[props.name];
  return (
    <div class={`field${error ? " invalid" : ""}`}>
      <label class="check">
        <input type="checkbox" name={props.name} checked={!!props.values[props.name]} /> {props.label}
        {props.help && <HelpLink to={props.help} label={`Help: ${props.label}`} />}
      </label>
      {error ? <div class="error">{error}</div> : props.hint && <div class="hint">{props.hint}</div>}
    </div>
  );
}

export function Select(props: FieldProps & { options: { value: string; label: string; disabled?: boolean }[] }) {
  const current = props.values[props.name] ?? "";
  return (
    <Field {...props}>
      <select id={fieldId(props.name)} name={props.name}>
        {props.options.map((o) => (
          <option value={o.value} selected={o.value === current} disabled={o.disabled}>
            {o.label}
          </option>
        ))}
      </select>
    </Field>
  );
}

const FormErrorBanner = ({ errors }: { errors: FormErrors }) =>
  errors._form ? <div class="banner error-banner">{errors._form}</div> : null;

const Actions = ({ submit, cancel }: { submit: string; cancel: string }) => (
  <div class="actions">
    <button type="submit" class="primary">
      {submit}
    </button>
    <a class="button ghost" href={cancel}>
      Cancel
    </a>
  </div>
);

/** A POST button that asks for confirmation first. */
export const DeleteButton = ({ action, what }: { action: string; what: string }) => (
  <form method="post" action={action} class="inline" onsubmit={`return confirm(${JSON.stringify(`Delete ${what}?`)})`}>
    <button type="submit" class="danger">
      Delete
    </button>
  </form>
);

const slugHint = "Lowercase letters, digits and dashes. Used as the file name; can't be changed later.";
const modeOptions = ServiceMode.options.map((m) => ({ value: m, label: m }));

// ------------------------------------------------------------------ services

export function ServiceForm(props: { service?: Service; values: FormValues; errors: FormErrors }) {
  const { service, values, errors } = props;
  const editing = !!service;
  const scenarioOptions = [
    { value: "", label: "— none —" },
    ...(service?.scenarios ?? []).map((s) => ({ value: s.id, label: `${s.name} (${s.id})` })),
  ];
  return (
    <form method="post" action={editing ? `${BASE}/services/${service.id}` : `${BASE}/services`} class="form">
      <FormErrorBanner errors={errors} />
      <div class="row">
        <Text name="name" label="Name" values={values} errors={errors} required />
        <Text name="id" label="ID" values={values} errors={errors} required readonly={editing} hint={editing ? undefined : slugHint} />
      </div>
      <TextArea name="description" label="Description" values={values} errors={errors} rows={2} />
      <div class="row">
        <Select name="method" label="Method" help="services#methods" values={values} errors={errors} options={HttpMethod.options.map((m) => ({ value: m, label: m }))} />
        <Text
          name="path"
          label="Path"
          values={values}
          errors={errors}
          required
          help="services#paths"
          placeholder="/api/users/{id}"
          hint={
            <>
              <code>{"{name}"}</code> captures a segment; a trailing <code>/*</code> matches any suffix.
            </>
          }
        />
      </div>
      <div class="row">
        <Select
          name="mode"
          label="Starting mode"
          help="services#modes"
          values={values}
          errors={errors}
          options={modeOptions}
          hint="Saved to YAML. Switching modes on the dashboard only changes the live state."
        />
        <Text name="delayMs" label="Delay (ms)" help="services#delays" values={values} errors={errors} type="number" />
      </div>
      <Text
        name="upstream"
        label="Upstream URL"
        help="proxying#upstreams"
        values={values}
        errors={errors}
        placeholder="https://api.example.com"
        hint="Required for proxy mode. The request path (after the rewrites below) and query are appended; the URL may include a base path."
      />
      <fieldset>
        <legend>
          Path rewrites (proxy mode) <HelpLink to="proxying#path-rewrites" label="Help: path rewrites" />
        </legend>
        <Text name="stripPrefix" label="Strip prefix" values={values} errors={errors} placeholder="/mock-api" hint="Removed from the start of the path before it is sent upstream." />
        <TextArea
          name="rewrite"
          label="Rewrite rules"
          values={values}
          errors={errors}
          rows={3}
          mono
          placeholder={"^/users/(\\d+)$ -> /people/$1"}
          hint={
            <>
              One <code>{"regex -> replacement"}</code> per line, applied in order after the prefix is stripped. Use <code>$1</code> for
              capture groups.
            </>
          }
        />
      </fieldset>
      {editing && (
        <div class="row">
          <Select name="defaultScenario" label="Starting default scenario" help="services#default-and-error-scenarios" values={values} errors={errors} options={scenarioOptions} />
          <Select
            name="errorScenario"
            label="Error scenario"
            help="scenarios#error-scenarios"
            values={values}
            errors={errors}
            options={scenarioOptions}
            hint="Used when proxying fails, or as the last fallback in dynamic mode."
          />
        </div>
      )}
      <TextArea
        name="responseSchema"
        label="Response schema (JSON)"
        help="schemas"
        values={values}
        errors={errors}
        rows={6}
        mono
        placeholder={'{\n  "2xx": { "type": "object", "required": ["id"] },\n  "default": { "type": "object" }\n}'}
        hint={
          <>
            JSON Schemas keyed by status (<code>"200"</code>, <code>"2xx"</code> or <code>"default"</code>; most specific wins). Every
            response, mocked or proxied, is checked and the result shown in History. Draft-07 if <code>$schema</code> says so,
            otherwise 2020-12.
          </>
        }
      />
      <Text name="tags" label="Tags" help="services#tags" values={values} errors={errors} hint="Comma-separated." />
      <Actions submit={editing ? "Save service" : "Create service"} cancel={editing ? `${BASE}/services/${service.id}` : SERVICES} />
    </form>
  );
}

// ----------------------------------------------------------------- scenarios

export function ScenarioForm(props: { service: Service; scenarioId?: string; values: FormValues; errors: FormErrors }) {
  const { service, scenarioId, values, errors } = props;
  const editing = !!scenarioId;
  const base = `${BASE}/services/${service.id}/scenarios`;
  return (
    <form method="post" action={editing ? `${base}/${scenarioId}` : base} class="form">
      <FormErrorBanner errors={errors} />
      <div class="row">
        <Text name="name" label="Name" values={values} errors={errors} required />
        <Text name="id" label="ID" values={values} errors={errors} required readonly={editing} hint={editing ? undefined : slugHint} />
      </div>
      <div class="row">
        <Text name="status" label="Status" values={values} errors={errors} type="number" />
        <Text name="delayMs" label="Delay (ms)" values={values} errors={errors} type="number" hint="Blank uses the service delay." />
      </div>
      <TextArea name="headers" label="Response headers" values={values} errors={errors} rows={3} mono placeholder="content-type: application/json" hint="One “name: value” per line." />
      <TextArea name="body" label="Response body" values={values} errors={errors} rows={12} mono />
      <Checkbox
        name="template"
        label="Template: fill in {{ … }} from the request"
        help="templates"
        values={values}
        errors={errors}
        hint={
          <>
            Fills in the body and header values, e.g. <code>{"{{params.id}}"}</code> or <code>{'"name": {{body.name | json}}'}</code>.
          </>
        }
      />
      <fieldset>
        <legend>
          Match rule (dynamic mode) <HelpLink to="scenarios#match-rules" label="Help: match rules" />
        </legend>
        <p class="hint">
          Every criterion you fill in must match. When several scenarios match, the one with the most criteria wins. Leave all
          blank to only use this scenario as a default.
        </p>
        <div class="row">
          <Select
            name="match.method"
            label="Method"
            values={values}
            errors={errors}
            options={[{ value: "", label: "— any —" }, ...HttpMethod.options.filter((m) => m !== "ANY").map((m) => ({ value: m, label: m }))]}
          />
          <Text name="match.bodyContains" label="Body contains" values={values} errors={errors} hint="Case-insensitive." />
        </div>
        <p class="hint">
          In the boxes below, <code>name: value</code> must be equal; <code>name ~ regex</code> tests a regular expression
          (<code>~i</code> ignores case). Exact criteria beat regexes when scores tie.
        </p>
        <div class="row3">
          <TextArea name="match.params" label="Path params" values={values} errors={errors} mono placeholder={"id: 404\nid ~ ^9\\d+$"} />
          <TextArea name="match.query" label="Query" values={values} errors={errors} mono placeholder="verbose: true" />
          <TextArea name="match.headers" label="Request headers" values={values} errors={errors} mono placeholder="x-tenant: acme" />
        </div>
        <TextArea
          name="match.json"
          label="JSON body (JSONPath)"
          help="scenarios#jsonpath"
          values={values}
          errors={errors}
          rows={3}
          mono
          placeholder={'$.user.role = admin\n$.items[*].sku ~ ^X-\n$.coupon exists'}
          hint={
            <>
              One per line: <code>$.path = value</code>, <code>$.path ~ regex</code>, <code>$.path exists</code> or <code>$.path missing</code>.
            </>
          }
        />
        <div class="row">
          <Text name="match.bodyMatches" label="Body matches (regex)" help="scenarios#regular-expressions" values={values} errors={errors} placeholder={'"type"\\s*:\\s*"refund"'} />
          <Text name="match.bodyMatchesFlags" label="Flags" values={values} errors={errors} placeholder="i" />
        </div>
        {errors.match && <div class="error">{errors.match}</div>}
      </fieldset>
      <Text name="tags" label="Tags" help="services#tags" values={values} errors={errors} hint="Comma-separated." />
      <Actions submit={editing ? "Save scenario" : "Create scenario"} cancel={`${BASE}/services/${service.id}`} />
    </form>
  );
}

// ------------------------------------------------------------------ profiles

export function ProfileForm(props: { services: Service[]; profileId?: string; values: FormValues; errors: FormErrors }) {
  const { services, profileId, values, errors } = props;
  const editing = !!profileId;
  const known = new Set(services.map((s) => s.id));
  const stale = Object.keys(values)
    .map((k) => /^svc\.([^.]+)\.include$/.exec(k)?.[1])
    .filter((id): id is string => !!id && !known.has(id));

  return (
    <form method="post" action={editing ? `${BASE}/profiles/${profileId}` : `${BASE}/profiles`} class="form">
      <FormErrorBanner errors={errors} />
      <div class="row">
        <Text name="name" label="Name" values={values} errors={errors} required />
        <Text name="id" label="ID" values={values} errors={errors} required readonly={editing} hint={editing ? undefined : slugHint} />
      </div>
      <TextArea name="description" label="Description" values={values} errors={errors} rows={2} />
      <h2>
        Services <HelpLink to="live-state#profiles" label="Help: profiles" />
      </h2>
      <p class="hint">Tick the services this profile controls. “Leave as is” keeps whatever the service has when the profile is applied.</p>
      {errors.services && <div class="error">{errors.services}</div>}
      <table>
        <thead>
          <tr>
            <th>Include</th>
            <th>Service</th>
            <th>Mode</th>
            <th>Default scenario</th>
          </tr>
        </thead>
        <tbody>
          {services.map((s) => {
            const key = `svc.${s.id}`;
            const mode = values[`${key}.mode`] ?? "";
            const scenario = values[`${key}.scenario`] ?? "";
            return (
              <tr>
                <td>
                  <input type="checkbox" name={`${key}.include`} checked={!!values[`${key}.include`]} aria-label={`Include ${s.name}`} />
                </td>
                <td>
                  {s.name} <span class="muted">({s.id})</span>
                </td>
                <td>
                  <select name={`${key}.mode`} aria-label={`Mode for ${s.name}`}>
                    <option value="">Leave as is</option>
                    {ServiceMode.options.map((m) => (
                      <option value={m} selected={m === mode} disabled={m === "proxy" && !s.upstream}>
                        {m}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <select name={`${key}.scenario`} aria-label={`Default scenario for ${s.name}`}>
                    <option value="">Leave as is</option>
                    {s.scenarios.map((sc) => (
                      <option value={sc.id} selected={sc.id === scenario}>
                        {sc.name}
                      </option>
                    ))}
                  </select>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {stale.length > 0 && (
        <p class="error">
          This profile references services that no longer exist: {stale.join(", ")}. Saving will drop them.
        </p>
      )}
      <Actions submit={editing ? "Save profile" : "Create profile"} cancel={`${BASE}/profiles`} />
    </form>
  );
}

// ------------------------------------------------------------------ settings

/** Form value for a scenario reference: "<service>/<scenario>". */
export const refValue = (ref: { service: string; scenario: string } | undefined) => (ref ? `${ref.service}/${ref.scenario}` : "");

export function SettingsForm(props: { services: Service[]; values: FormValues; errors: FormErrors }) {
  const { services, values, errors } = props;
  const current = values.errorScenario ?? "";
  const withScenarios = services.filter((s) => s.scenarios.length > 0);
  return (
    <form method="post" action={`${BASE}/settings`} class="form">
      <FormErrorBanner errors={errors} />
      <Field
        name="errorScenario"
        label="Global error scenario"
        help="scenarios#the-global-error-scenario"
        values={values}
        errors={errors}
        hint="Returned whenever Mimic would otherwise answer with its own error: no service matches the request, no scenario matches and the service has no fallback, or a proxy call fails and the service has no error scenario."
      >
        <select id={fieldId("errorScenario")} name="errorScenario">
          <option value="">— none (Mimic's JSON error) —</option>
          {withScenarios.map((s) => (
            <optgroup label={s.name}>
              {s.scenarios.map((sc) => {
                const value = refValue({ service: s.id, scenario: sc.id });
                return (
                  <option value={value} selected={value === current}>
                    {sc.name} ({sc.status})
                  </option>
                );
              })}
            </optgroup>
          ))}
        </select>
      </Field>
      <Actions submit="Save settings" cancel={SERVICES} />
    </form>
  );
}
