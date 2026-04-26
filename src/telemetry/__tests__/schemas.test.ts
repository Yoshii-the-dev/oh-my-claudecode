/**
 * schemas.test.ts
 *
 * Covers Zod-based validation:
 * - Each stream: valid envelope passes, missing required field fails,
 *   unknown field rejected, wrong type rejected.
 * - validate() API: returns { success: true } or { success: false, error }.
 * - validatePayload() legacy shim still works.
 */

import { describe, it, expect } from 'vitest';
import {
  validate,
  validatePayload,
  agentHandoffSchema,
  verdictSchema,
  skillEventsSchema,
  hookEventsSchema,
  llmInteractionSchema,
} from '../schemas.js';
import type { StreamName } from '../schemas.js';

// ---------------------------------------------------------------------------
// validate() — per stream
// ---------------------------------------------------------------------------

describe('schemas/validate — agent-handoff', () => {
  it('accepts a valid start payload', () => {
    const result = validate('agent-handoff', { event: 'start', agent_type: 'executor' });
    expect(result.success).toBe(true);
  });

  it('accepts a valid end payload with optional fields', () => {
    const result = validate('agent-handoff', {
      event: 'end',
      agent_type: 'executor',
      parent_agent_id: 'parent-123',
      model: 'claude-sonnet-4-6',
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing required field (agent_type)', () => {
    const result = validate('agent-handoff', { event: 'start' });
    expect(result.success).toBe(false);
  });

  it('rejects invalid event value', () => {
    const result = validate('agent-handoff', { event: 'invalid', agent_type: 'executor' });
    expect(result.success).toBe(false);
  });

  it('rejects unknown field (strict mode)', () => {
    const result = validate('agent-handoff', {
      event: 'start',
      agent_type: 'executor',
      unknown_field: 'oops',
    });
    expect(result.success).toBe(false);
  });

  it('rejects wrong type for agent_type', () => {
    const result = validate('agent-handoff', { event: 'start', agent_type: 42 });
    expect(result.success).toBe(false);
  });
});

describe('schemas/validate — verdict', () => {
  it('accepts a valid verdict payload', () => {
    const result = validate('verdict', {
      event: 'verdict',
      agent_type: 'executor',
      verdict: 'propose',
    });
    expect(result.success).toBe(true);
  });

  it('accepts verdict with all optional fields', () => {
    const result = validate('verdict', {
      event: 'verdict',
      agent_type: 'executor',
      verdict: 'propose',
      duration_ms: 1234,
      tokens_in: 100,
      tokens_out: 200,
      reason: 'all tests pass',
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing verdict field', () => {
    const result = validate('verdict', { event: 'verdict', agent_type: 'executor' });
    expect(result.success).toBe(false);
  });

  it('rejects wrong event value (not "verdict")', () => {
    const result = validate('verdict', { event: 'start', agent_type: 'executor', verdict: 'propose' });
    expect(result.success).toBe(false);
  });

  it('rejects unknown field (strict mode)', () => {
    const result = validate('verdict', {
      event: 'verdict',
      agent_type: 'executor',
      verdict: 'propose',
      extra_field: 'not_allowed',
    });
    expect(result.success).toBe(false);
  });
});

describe('schemas/validate — skill-events', () => {
  it('accepts a valid detected payload', () => {
    const result = validate('skill-events', { event: 'detected', skill_slug: 'autopilot' });
    expect(result.success).toBe(true);
  });

  it('accepts with optional fields', () => {
    const result = validate('skill-events', {
      event: 'invoked',
      skill_slug: 'autopilot',
      keyword: 'autopilot',
      latency_ms: 12,
      outcome: 'matched',
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing skill_slug', () => {
    const result = validate('skill-events', { event: 'detected' });
    expect(result.success).toBe(false);
  });

  it('rejects invalid event value', () => {
    const result = validate('skill-events', { event: 'started', skill_slug: 'autopilot' });
    expect(result.success).toBe(false);
  });

  it('rejects unknown field (strict mode)', () => {
    const result = validate('skill-events', {
      event: 'detected',
      skill_slug: 'autopilot',
      mystery: true,
    });
    expect(result.success).toBe(false);
  });
});

describe('schemas/validate — hook-events', () => {
  it('accepts a valid hook payload', () => {
    const result = validate('hook-events', { hook_name: 'factcheck', event: 'fired' });
    expect(result.success).toBe(true);
  });

  it('accepts extra fields (passthrough — hooks have arbitrary details)', () => {
    const result = validate('hook-events', {
      hook_name: 'keyword-detector',
      event: 'matched',
      keyword: 'autopilot',
      latency_ms: 5,
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing hook_name', () => {
    const result = validate('hook-events', { event: 'fired' });
    expect(result.success).toBe(false);
  });

  it('rejects missing event', () => {
    const result = validate('hook-events', { hook_name: 'factcheck' });
    expect(result.success).toBe(false);
  });

  it('rejects wrong type for hook_name', () => {
    const result = validate('hook-events', { hook_name: 123, event: 'fired' });
    expect(result.success).toBe(false);
  });
});

describe('schemas/validate — llm-interaction', () => {
  it('accepts a valid llm-interaction payload', () => {
    const result = validate('llm-interaction', {
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
      tokens_in: 500,
      tokens_out: 200,
    });
    expect(result.success).toBe(true);
  });

  it('accepts with all optional fields', () => {
    // agent_id is an envelope-level field (lifted by writer.ts before validation),
    // NOT a stream-payload field — it is intentionally absent here.
    const result = validate('llm-interaction', {
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
      tokens_in: 500,
      tokens_out: 200,
      cache_read: 100,
      cache_write: 50,
      latency_ms: 340,
    });
    expect(result.success).toBe(true);
  });

  it('rejects agent_id in stream payload (envelope-level field, not stream payload)', () => {
    // agent_id belongs at the envelope level — passing it in the payload is rejected
    // by the strict schema.  writer.ts lifts it before validation.
    const result = validate('llm-interaction', {
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
      tokens_in: 500,
      tokens_out: 200,
      agent_id: 'agent-abc',
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing provider', () => {
    const result = validate('llm-interaction', {
      model: 'claude-sonnet-4-6',
      tokens_in: 500,
      tokens_out: 200,
    });
    expect(result.success).toBe(false);
  });

  it('rejects non-numeric tokens_in', () => {
    const result = validate('llm-interaction', {
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
      tokens_in: 'many',
      tokens_out: 200,
    });
    expect(result.success).toBe(false);
  });

  it('rejects unknown field (strict mode)', () => {
    const result = validate('llm-interaction', {
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
      tokens_in: 500,
      tokens_out: 200,
      secret_field: 'oops',
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// validate() — edge cases
// ---------------------------------------------------------------------------

describe('schemas/validate — edge cases', () => {
  it('returns false with error for unknown stream name', () => {
    const result = validate('unknown-stream' as StreamName, { hook_name: 'x', event: 'y' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/unknown stream/);
    }
  });

  it('returns success:false with error message string when failing', () => {
    const result = validate('verdict', { event: 'start' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(typeof result.error).toBe('string');
      expect(result.error.length).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// validatePayload() legacy shim
// ---------------------------------------------------------------------------

describe('schemas/validatePayload (legacy shim)', () => {
  it('returns null for a valid hook-events payload', () => {
    const error = validatePayload('hook-events', { hook_name: 'factcheck', event: 'fired' });
    expect(error).toBeNull();
  });

  it('returns error string for missing hook_name', () => {
    const error = validatePayload('hook-events', { event: 'fired' });
    expect(typeof error).toBe('string');
    expect((error as string).length).toBeGreaterThan(0);
  });

  it('returns error string for non-object payload', () => {
    const error = validatePayload('hook-events', null as unknown as Record<string, unknown>);
    expect(typeof error).toBe('string');
  });

  it('returns null for valid agent-handoff', () => {
    const error = validatePayload('agent-handoff', { event: 'start', agent_type: 'executor' });
    expect(error).toBeNull();
  });

  it('returns error for invalid agent-handoff (unknown field)', () => {
    const error = validatePayload('agent-handoff', {
      event: 'start',
      agent_type: 'executor',
      bad_field: true,
    });
    expect(typeof error).toBe('string');
  });
});

// ---------------------------------------------------------------------------
// Exported Zod schemas are accessible
// ---------------------------------------------------------------------------

describe('schemas/exported Zod schemas', () => {
  it('agentHandoffSchema is a valid Zod schema', () => {
    expect(agentHandoffSchema.safeParse).toBeDefined();
  });

  it('verdictSchema is a valid Zod schema', () => {
    expect(verdictSchema.safeParse).toBeDefined();
  });

  it('skillEventsSchema is a valid Zod schema', () => {
    expect(skillEventsSchema.safeParse).toBeDefined();
  });

  it('hookEventsSchema is a valid Zod schema', () => {
    expect(hookEventsSchema.safeParse).toBeDefined();
  });

  it('llmInteractionSchema is a valid Zod schema', () => {
    expect(llmInteractionSchema.safeParse).toBeDefined();
  });
});
