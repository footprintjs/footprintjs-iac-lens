/** Known systemd execution resources run programs; a Kubernetes Service is a separate network resource. */
export function isSystemdComputeKind(kind: string): boolean {
  return kind === 'SystemdService' || kind === 'SystemdServiceGroup';
}
