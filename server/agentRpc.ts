import { type AgentReply, agentCall, agentMethods, parseJson } from '../shared/agents.ts';
import type { Fail2banConnector } from './connectors/connector.ts';
import { AppError } from './errors.ts';

// Agent side: one call from the central, answered by the local connector. Only the read methods of
// agentMethods exist here, anything else is not a call. null: nothing to answer.
export async function answerCall(connector: Fail2banConnector, data: unknown): Promise<AgentReply | null> {
  const call = agentCall.safeParse(parseJson(data));
  if (!call.success) return null;
  const { id, method } = call.data;
  const params = agentMethods[method].params.safeParse(call.data.params);
  if (!params.success) return { type: 'reply', id, ok: false, code: 'VALIDATION', error: 'Invalid parameters' };
  try {
    const run = connector[method] as (...args: unknown[]) => Promise<unknown>;
    return { type: 'reply', id, ok: true, value: await run(...params.data) };
  } catch (err) {
    // Same rule as the HTTP error handler: unexpected errors stay in this machine's log
    if (err instanceof AppError)
      return { type: 'reply', id, ok: false, code: err.code, error: err.message.slice(0, 500) };
    return { type: 'reply', id, ok: false, code: 'INTERNAL', error: 'Agent error' };
  }
}
