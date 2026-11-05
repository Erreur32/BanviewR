// Browser and system read from a user agent, enough to recognise a session. Order matters:
// Edge also says Chrome, Chrome also says Safari, Android also says Linux.
const BROWSERS: [RegExp, string][] = [
  [/Edg\//, 'Edge'],
  [/Firefox\//, 'Firefox'],
  [/Chrome\//, 'Chrome'],
  [/Safari\//, 'Safari'],
];
const SYSTEMS: [RegExp, string][] = [
  [/Windows/, 'Windows'],
  [/Android/, 'Android'],
  [/iPhone|iPad/, 'iOS'],
  [/Mac OS X/, 'macOS'],
  [/Linux/, 'Linux'],
];

const firstMatch = (list: [RegExp, string][], agent: string) => list.find(([pattern]) => pattern.test(agent))?.[1];

export function describeAgent(agent: string) {
  const known = [firstMatch(BROWSERS, agent), firstMatch(SYSTEMS, agent)].filter(Boolean);
  return known.length ? known.join(', ') : agent.slice(0, 40) || '?';
}
