// What a check run's agents are doing right now, built from the agent's event stream
// (`claude -p --output-format stream-json`) and sent to the hub with the worker's heartbeat, so
// the feedback admin panel can show it: the lead agent's step, every subagent with its state and
// latest step, the latest steps, the pull requests opened and, at the end, the cost.
//
// The stream's shapes, as Claude Code 2.1 sends them:
//   assistant, parent_tool_use_id null    the lead's own tool calls and words
//   assistant, parent_tool_use_id <id>    a subagent's tool calls; <id> is the Agent call that started it
//   system task_started / task_progress   a subagent's task id, tool count and tokens
//   system task_updated / task_notification  completed, stopped, killed or failed
//   system task_started, a known task id   a finished subagent was resumed (SendMessage); its
//                                          new events carry the SendMessage call's id
//   system task_summary / post_turn_summary  one line on what the lead is doing
//   system background_tasks_changed       the subagents still running
//   system code_change_published          a pull request was opened
//   result                                the end of a turn, with cost and turn count
// Anything else is ignored, so a stream this file does not know still gives the lead's steps.

/** The hub keeps at most 24,000 characters (RUN_ACTIVITY_MAX in hub_feedback.ts). */
export const ACTIVITY_MAX = 20000;
const FEED_MAX = 40;
const AGENTS_MAX = 40;
/** A feedback note id, e.g. HUB-0007 or WORLD-0012. */
const NOTE_ID = /\b[A-Z][A-Z0-9]{1,15}-\d{3,6}\b/g;

export function short(text, max) {
  const flat = String(text ?? '').replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/** "Bash: Run the tests" for one tool call. */
export function stepOf(part) {
  const input = part.input ?? {};
  return short(`${part.name}: ${input.description || input.command || input.file_path || input.pattern || input.url || input.message || ''}`.replace(/: $/, ''), 140);
}

const END_STATE = { completed: 'done', done: 'done', stopped: 'stopped', killed: 'stopped', failed: 'failed', error: 'failed' };

/**
 * `now` is the clock (a test passes its own). → { apply(event), note(who, text), finish(ok),
 * working(), snapshot(), take() }.
 */
export function createActivity(now = () => new Date()) {
  /** Agent call id → the subagent it started. */
  const agents = new Map();
  /** The stream's task id → that Agent call id. */
  const byTask = new Map();
  /** The call that resumed a subagent → the Agent call that first started it. */
  const alias = new Map();
  const feed = [];
  const prs = [];
  const lead = { step: '', steps: 0, status: '' };
  let result = null;
  let background = 0;
  let dirty = true;

  const stamp = () => now().toISOString();
  const say = (who, text) => {
    feed.push({ t: stamp(), who, text: short(text, 220) });
    if (feed.length > FEED_MAX) feed.shift();
    dirty = true;
  };
  const agentOf = (call, name = 'subagent') => {
    const id = alias.get(call) ?? call;
    let agent = agents.get(id);
    if (!agent) {
      agent = { id, name: short(name, 80), kind: '', state: 'working', step: '', tools: 0, tokens: 0, started: stamp(), ended: '', notes: [] };
      agents.set(id, agent);
      dirty = true;
    }
    return agent;
  };
  /** A subagent that had ended is at work again: the lead sent it back to its task. */
  const reopen = (agent) => {
    if (agent.state === 'working') return;
    agent.state = 'working';
    agent.ended = '';
    dirty = true;
    say(agent.name, 'resumed');
  };
  const end = (agent, state, at) => {
    // The first ending stands: a subagent that was stopped does not turn "done" afterwards.
    if (!agent || agent.state !== 'working') return;
    agent.state = state;
    agent.ended = at ? new Date(at).toISOString() : stamp();
    dirty = true;
    say(agent.name, state === 'done' ? 'finished' : state);
  };
  const forTask = (event) => agents.get(alias.get(event.tool_use_id) ?? event.tool_use_id) ?? agents.get(byTask.get(event.task_id));

  function assistant(event) {
    const parent = event.parent_tool_use_id;
    for (const part of event.message?.content ?? []) {
      if (part.type === 'tool_use') {
        const input = part.input ?? {};
        if (parent) {
          const agent = agentOf(parent);
          if (part.name === 'SubagentHandback') {
            agent.step = short(`Reported: ${input.message ?? ''}`, 140);
            end(agent, 'done');
          } else {
            reopen(agent);
            agent.step = stepOf(part);
            agent.tools += 1;
            say(agent.name, agent.step);
          }
        } else if (part.name === 'Agent' || part.name === 'Task') {
          const agent = agentOf(part.id, input.description || 'subagent');
          agent.kind = short(input.subagent_type ?? '', 40);
          agent.notes = [...new Set(`${input.description ?? ''} ${input.prompt ?? ''}`.match(NOTE_ID) ?? [])].slice(0, 8);
          agent.step = 'Starting';
          lead.steps += 1;
          say('', `started subagent: ${agent.name}`);
        } else {
          lead.step = stepOf(part);
          lead.steps += 1;
          say('', lead.step);
        }
        dirty = true;
      } else if (part.type === 'text' && part.text?.trim() && !parent) {
        say('', `says: ${part.text}`);
      }
    }
  }

  function system(event) {
    switch (event.subtype) {
      case 'task_started':
      case 'task_progress': {
        if (event.task_type && event.task_type !== 'local_agent') return;
        // A subagent's task: one whose tool call is an Agent call we saw, or that says so itself.
        const known = forTask(event);
        if (!known && event.task_type !== 'local_agent' && !event.subagent_type) return;
        if (!known && !event.tool_use_id) return;
        if (known && event.tool_use_id && !agents.has(event.tool_use_id)) alias.set(event.tool_use_id, known.id);
        const agent = known ?? agentOf(event.tool_use_id, event.description);
        if (event.task_id && !byTask.has(event.task_id)) byTask.set(event.task_id, agent.id);
        // A task that starts again is a subagent sent back to work.
        if (event.subtype === 'task_started') reopen(agent);
        if (event.subagent_type) agent.kind = short(event.subagent_type, 40);
        if (event.usage) {
          agent.tools = Math.max(agent.tools, Number(event.usage.tool_uses) || 0);
          agent.tokens = Number(event.usage.total_tokens) || agent.tokens;
        }
        dirty = true;
        return;
      }
      case 'task_updated': {
        const state = END_STATE[event.patch?.status];
        if (state) end(forTask(event), state, event.patch?.end_time);
        return;
      }
      case 'task_notification': {
        const state = END_STATE[event.status];
        if (state) end(forTask(event), state);
        return;
      }
      case 'task_summary':
        if (event.detail) lead.status = short(event.detail, 160);
        dirty = true;
        return;
      case 'post_turn_summary':
        if (event.status_detail) lead.status = short(event.status_detail, 160);
        dirty = true;
        return;
      case 'background_tasks_changed':
        background = (event.tasks ?? []).filter((t) => t.task_type === 'local_agent').length;
        return;
      case 'code_change_published':
        if (typeof event.url === 'string' && /^https:\/\//.test(event.url) && !prs.includes(event.url)) {
          prs.push(event.url);
          if (prs.length > 30) prs.shift();
          say('', `pull request ${event.action ?? 'published'}: ${event.url}`);
        }
        return;
      default:
    }
  }

  function snapshot() {
    const rank = { working: 0, failed: 1, stopped: 2, done: 3 };
    const list = [...agents.values()].sort((a, b) => rank[a.state] - rank[b.state] || (a.started < b.started ? 1 : -1)).slice(0, AGENTS_MAX);
    // Copies: a report must not change after it was taken.
    const report = { v: 1, at: stamp(), lead: { ...lead }, agents: list.map((agent) => ({ ...agent, notes: [...agent.notes] })), feed: feed.map((line) => ({ ...line })), prs: [...prs], result: result && { ...result } };
    // Under the hub's limit: the oldest steps go first, then the subagents that finished first.
    while (JSON.stringify(report).length > ACTIVITY_MAX && report.feed.length > 5) report.feed.shift();
    while (JSON.stringify(report).length > ACTIVITY_MAX && report.agents.length > 1) report.agents.pop();
    return report;
  }

  return {
    apply(event) {
      if (!event || typeof event !== 'object') return;
      if (event.type === 'assistant') assistant(event);
      else if (event.type === 'system') system(event);
      else if (event.type === 'result') {
        result = { ok: event.subtype === 'success', cost: Number(event.total_cost_usd) || 0, turns: Number(event.num_turns) || 0, ms: Number(event.duration_ms) || 0 };
        dirty = true;
      }
    },
    /** A line of the worker's own in the steps, e.g. that the agent read the owner's message. */
    note: say,
    /** The agent process is gone: nothing is "working" any more. */
    finish(ok) {
      for (const agent of agents.values()) end(agent, ok ? 'done' : 'stopped');
      background = 0;
    },
    /** Subagents still at work, by their own events and by the stream's own count. */
    working() {
      let n = 0;
      for (const agent of agents.values()) if (agent.state === 'working') n += 1;
      return Math.max(n, background);
    },
    snapshot,
    /** The report as JSON when it changed since the last take, else ''. */
    take() {
      if (!dirty) return '';
      dirty = false;
      return JSON.stringify(snapshot());
    },
  };
}
