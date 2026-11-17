export function browserUserAgent(userAgent: string): string {
  return userAgent.replace(/(?:^|\s)(?:terminal-browser|Electron)\/\S+/g, "").trim();
}
