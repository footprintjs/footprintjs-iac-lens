import { useId, useState, type FormEvent } from 'react';
import type { ConnectionAdapterSchema, ConnectionProfileRegistration } from '../../src/core/connection-profiles.ts';

/** Form values are request-local. Passwords never enter dashboard state or browser storage. */
export function connectionRegistration(schema: ConnectionAdapterSchema, data: FormData): ConnectionProfileRegistration {
  const config: Record<string, string> = {}, secrets: Record<string, string> = {};
  for (const field of schema.fields) {
    const value = data.get('field:' + field.name);
    if (typeof value !== 'string' || (!value && !field.required)) continue;
    (field.secret || field.kind === 'password' ? secrets : config)[field.name] = value;
  }
  return { label: String(data.get('profile-label') ?? '').trim(), adapterId: schema.id, config, secrets };
}

export function ConnectionProfileForm({ schemas, disabled, onSave }: {
  schemas: readonly ConnectionAdapterSchema[]; disabled: boolean; onSave(input: ConnectionProfileRegistration): Promise<void>;
}) {
  const [adapterId, setAdapterId] = useState(schemas[0]?.id);
  const schema = schemas.find(schema => schema.id === adapterId) ?? schemas[0];
  const prefix = useId();
  if (!schema) return <p>This host has no connection types available.</p>;
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const form = event.currentTarget;
    const registration = connectionRegistration(schema, new FormData(form));
    form.reset(); // Clear secret controls before the asynchronous request completes, including failure paths.
    void onSave(registration);
  };
  return <form className="connection-profile-form" autoComplete="off" onSubmit={submit}>
    <p>Choose the system to connect. This host checks which targets are allowed.</p>
    <label htmlFor={prefix + '-adapter'}>Connection type</label>
    <select id={prefix + '-adapter'} value={schema.id} disabled={disabled} onChange={event => setAdapterId(event.target.value)}>
      {schemas.map(schema => <option value={schema.id} key={schema.id}>{schema.label}</option>)}
    </select>
    {schema.description && <p>{schema.description}</p>}
    <label htmlFor={prefix + '-label'}>Connection name</label>
    <input id={prefix + '-label'} name="profile-label" type="text" maxLength={160} required disabled={disabled} placeholder="Office connection"/>
    <fieldset key={schema.id} disabled={disabled}><legend className="sr-only">Connection fields</legend>{schema.fields.map(field => <div className="connection-profile-field" key={field.name}>
      <label htmlFor={prefix + '-' + field.name}>{field.label}{field.required ? '' : ' (optional)'}</label>
      <input id={prefix + '-' + field.name} name={'field:' + field.name} required={field.required}
        type={field.secret || field.kind === 'password' ? 'password' : field.kind === 'integer' ? 'number' : field.kind === 'url' ? 'url' : 'text'}
        step={field.kind === 'integer' ? 1 : undefined} maxLength={4096} autoComplete="off" spellCheck={false}/>
      {field.description && <small>{field.description}</small>}
    </div>)}</fieldset>
    <p className="connection-secret-note">Passwords are cleared when submitted and are never displayed in Lens.</p>
    <button className="simple-button simple-primary" type="submit" disabled={disabled}>{disabled ? 'Saving…' : 'Save connection'}</button>
  </form>;
}
