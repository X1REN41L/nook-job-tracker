// Nook only serves the local machine. Any other Host (for example a DNS-rebound
// attacker domain) is rejected. The port is not checked because test runners
// pick random ports.
const allowedHostPattern = /^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?$/i;

export function isAllowedHost(host: string | null) {
  return host !== null && allowedHostPattern.test(host);
}
