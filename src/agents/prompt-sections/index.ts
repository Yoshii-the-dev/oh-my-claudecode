/**
 * Prompt Section Builders for Dynamic Orchestrator Prompt Generation
 *
 * This module provides functions to build different sections of the orchestrator prompt
 * dynamically from agent metadata. Adding a new agent automatically updates the orchestrator.
 */

import type { AgentConfig, AgentCategory } from '../types.js';

/**
 * Build the header section with core orchestrator identity
 */
export function buildHeader(): string {
  return `You are the orchestrator of a multi-agent development system.

## Execution Contract

You coordinate specialized subagents to accomplish complex software engineering tasks. Work continues until the completion gate passes or a verified blocker is reported with evidence and the next required action.`;
}

/**
 * Build the agent registry section with descriptions
 */
export function buildAgentRegistry(agents: AgentConfig[]): string {
  const lines: string[] = ['## Available Subagents', ''];

  // Group agents by tier (base vs variants)
  const baseAgents = agents.filter(a => !a.name.includes('-'));
  const tieredAgents = agents.filter(a => a.name.includes('-'));

  // Base agents
  if (baseAgents.length > 0) {
    lines.push('### Primary Agents');
    for (const agent of baseAgents) {
      const modelInfo = agent.model ? ` (${agent.model})` : '';
      lines.push(`- **${agent.name}**${modelInfo}: ${agent.description}`);
    }
    lines.push('');
  }

  // Tiered variants
  if (tieredAgents.length > 0) {
    lines.push('### Tiered Variants');
    lines.push('Use tiered variants for smart model routing based on task complexity:');
    lines.push('- **HIGH tier (opus)**: Complex analysis, architecture, debugging');
    lines.push('- **MEDIUM tier (sonnet)**: Standard tasks, moderate complexity');
    lines.push('- **LOW tier (haiku)**: Simple lookups, trivial operations');
    lines.push('');

    for (const agent of tieredAgents) {
      const modelInfo = agent.model ? ` (${agent.model})` : '';
      lines.push(`- **${agent.name}**${modelInfo}: ${agent.description}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Build the trigger table showing when to use each agent
 */
export function buildTriggerTable(agents: AgentConfig[]): string {
  const lines: string[] = ['## Key Triggers', ''];

  // Filter agents with metadata triggers
  const agentsWithTriggers = agents.filter(a => a.metadata?.triggers && a.metadata.triggers.length > 0);

  if (agentsWithTriggers.length === 0) {
    return '';
  }

  lines.push('| Agent | Domain | Trigger Condition |');
  lines.push('|-------|--------|------------------|');

  for (const agent of agentsWithTriggers) {
    const triggers = agent.metadata?.triggers ?? [];
    for (let i = 0; i < triggers.length; i++) {
      const trigger = triggers[i];
      const agentName = i === 0 ? `**${agent.name}**` : '';
      lines.push(`| ${agentName} | ${trigger.domain} | ${trigger.trigger} |`);
    }
  }

  lines.push('');
  return lines.join('\n');
}

/**
 * Build tool selection guidance section
 */
export function buildToolSelectionSection(agents: AgentConfig[]): string {
  const lines: string[] = ['## Tool Selection Guidance', ''];

  // Group by category
  const categorizedAgents = new Map<AgentCategory, AgentConfig[]>();
  for (const agent of agents) {
    const category = agent.metadata?.category || 'utility';
    if (!categorizedAgents.has(category)) {
      categorizedAgents.set(category, []);
    }
    const arr = categorizedAgents.get(category);
    if (arr) arr.push(agent);
  }

  for (const [category, categoryAgents] of categorizedAgents) {
    lines.push(`### ${capitalizeFirst(category)} Agents`);
    for (const agent of categoryAgents) {
      lines.push(`**${agent.name}** (${agent.model || 'sonnet'}):`);
      if (agent.tools?.length) {
        lines.push(`- Tools: ${agent.tools.join(', ')}`);
      }

      if (agent.metadata?.useWhen && agent.metadata.useWhen.length > 0) {
        lines.push(`- Use when: ${agent.metadata.useWhen.join('; ')}`);
      }

      if (agent.metadata?.avoidWhen && agent.metadata.avoidWhen.length > 0) {
        lines.push(`- Avoid when: ${agent.metadata.avoidWhen.join('; ')}`);
      }

      lines.push('');
    }
  }

  return lines.join('\n');
}

/**
 * Build delegation matrix/guide table
 */
export function buildDelegationMatrix(agents: AgentConfig[]): string {
  const lines: string[] = ['## Delegation Guide', ''];

  // Group by category
  const categorizedAgents = new Map<AgentCategory, AgentConfig[]>();
  for (const agent of agents) {
    const category = agent.metadata?.category || 'utility';
    if (!categorizedAgents.has(category)) {
      categorizedAgents.set(category, []);
    }
    const arr = categorizedAgents.get(category);
    if (arr) arr.push(agent);
  }

  lines.push('| Category | Agent | Model | Use Case |');
  lines.push('|----------|-------|-------|----------|');

  for (const [category, categoryAgents] of categorizedAgents) {
    const categoryName = capitalizeFirst(category);
    for (let i = 0; i < categoryAgents.length; i++) {
      const agent = categoryAgents[i];
      const catDisplay = i === 0 ? categoryName : '';
      const model = agent.model || 'sonnet';
      const useCase = agent.metadata?.useWhen?.[0] || agent.description;
      lines.push(`| ${catDisplay} | **${agent.name}** | ${model} | ${useCase} |`);
    }
  }

  lines.push('');
  return lines.join('\n');
}

/**
 * Build orchestration principles section
 */
export function buildOrchestrationPrinciples(): string {
  return `## Orchestration Principles
1. **Delegate Deliberately**: Use subagents for specialized work where they improve quality, speed, or coverage
2. **Parallelize Independent Work**: Launch concurrent subagents when tasks do not depend on each other
3. **Use Completion Gates**: Continue until tasks are complete or blockers are evidenced
4. **Communicate Progress**: Keep the user informed with concise updates while work is in flight
5. **Verify With Evidence**: Run the checks that prove the claim before reporting completion`;
}

/**
 * Build workflow section
 */
export function buildWorkflow(): string {
  return `## Workflow
1. Analyze the user's request and break it into tasks using TodoWrite
2. Mark the first task in_progress and BEGIN WORKING
3. Delegate to appropriate subagents based on task type
4. Coordinate results and handle issues as follow-up tasks or verified blockers
5. Mark tasks complete ONLY when verified
6. Loop back to step 2 until all tasks are completed or blocked with evidence
7. Final verification: re-read the todo list and report concrete evidence`;
}

/**
 * Build critical rules section
 */
export function buildCriticalRules(): string {
  return `## Completion Rules

1. **No Incomplete Completion Claims** - Pending or in-progress todos mean the completion gate has not passed
2. **Verify Claims** - Check todo state and run applicable tests or commands before concluding
3. **Use Parallel Execution** - Use it when it reduces elapsed time without duplicating work
4. **Keep Progress Moving** - Report concise progress and continue with the next actionable task
5. **Blockers Need Evidence** - A blocker report needs a reason, evidence, and next required action
6. **Ask Only When Necessary** - Clarifying questions are for real ambiguity or risky assumptions`;
}

/**
 * Build completion checklist section
 */
export function buildCompletionChecklist(): string {
  return `## Completion Checklist
Before concluding, you MUST verify:
- [ ] Every todo item is marked 'completed'
- [ ] All requested functionality is implemented
- [ ] Tests pass (if applicable)
- [ ] No errors remain unaddressed
- [ ] The user's original request is FULLY satisfied

If any checkbox is unchecked, continue with the next actionable task or report a verified blocker.`;
}

/**
 * Capitalize first letter of a string
 */
function capitalizeFirst(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}
