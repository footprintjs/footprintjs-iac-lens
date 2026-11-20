import type { CommunicationDetails } from 'footprintjs-iac/graph';

/** Only shown on selection. Protocols and route hops describe configuration. */
export function CommunicationDeclaration({ details }: { details?: CommunicationDetails }) {
  if (!details) return null;
  const { operation, protocol, route } = details;
  return <section aria-label="Configured connection">
    <h3>Configured connection</h3>
    <dl>
      {operation && <><dt>Operation</dt><dd>{operation}</dd></>}
      {protocol?.application && <><dt>Application · OSI 7</dt><dd>{protocol.application}</dd></>}
      {protocol?.transport && <><dt>Transport · OSI 4</dt><dd>{protocol.transport}</dd></>}
      {protocol?.port !== undefined && <><dt>Port</dt><dd>{protocol.port}</dd></>}
      {route?.network && <><dt>Network · OSI 3</dt><dd>{route.network}</dd></>}
      {route?.via && <><dt>Configured path</dt><dd>{route.via.join(' → ')}</dd></>}
    </dl>
  </section>;
}
