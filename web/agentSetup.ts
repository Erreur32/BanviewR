import template from '../docker-compose.agent.yml?raw';

// The repository's agent compose file, filled with this central's address and a fresh code
export const agentCompose = (centralUrl: string, code: string) =>
  template.replace('https://banviewr.example.org', centralUrl).replace('bvre_paste-the-code-here', code);
