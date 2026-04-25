# Agent Catalog

Generated from `src/agents/definitions.ts` and `agents/*.md`.
Do not edit by hand. Run `npm run docs:generate` to refresh.

Total agents (filesystem): 36.

| Name | Model | In registry | Description |
| --- | --- | --- | --- |
| accessibility-auditor | claude-sonnet-4-6 | yes | WCAG compliance auditing (sonnet) — keyboard nav, contrast, ARIA, semantic HTML. |
| analyst | claude-opus-4-7 | yes | Pre-planning consultant that analyzes requests before implementation to identify hidden requirements, edge cases, and potential risks. Use before creating a work plan. |
| architect | claude-opus-4-7 | yes | Read-only consultation agent. High-IQ reasoning specialist for debugging hard problems and high-difficulty architecture design. |
| brand-architect | claude-opus-4-7 | yes | Designs the brand system (Jungian archetype, core metaphor, variation grammar) — self-sufficient discovery; produces .omc/brand/core.md + grammar.md (opus). |
| brand-steward | claude-opus-4-7 | yes | Product constitution owner (opus) — brand identity, tone, visual language governance. |
| campaign-composer | claude-sonnet-4-6 | yes | Generates N brand-coherent marketing/design/copy variations from grammar + brief, with grammar-traceability per variation (sonnet). |
| code-reviewer | claude-opus-4-7 | yes | Expert code review specialist (Opus). Use for comprehensive code quality review. |
| code-simplifier | claude-opus-4-7 | yes | Simplifies and refines code for clarity, consistency, and maintainability (Opus). |
| competitor-scout | claude-sonnet-4-6 | yes | Competitive intelligence scout with structural recency bias — produces evidence-cited dossiers with Disruption/7-Powers/Wardley classification (sonnet). |
| copywriter | claude-sonnet-4-6 | yes | UX copywriter (sonnet) — microcopy, onboarding flows, error messages, i18n-aware copy management. |
| creative-director | claude-opus-4-7 | yes | Brand-variation guardrail — enforces grammar invariants and variance gate on campaign variations; produces per-variation PASS/REVISE/REJECT verdict (opus, read-only). |
| critic | claude-opus-4-7 | yes | Expert reviewer for evaluating work plans against rigorous clarity, verifiability, and completeness standards. Use after planner creates a work plan to validate it before execution. |
| debugger | claude-sonnet-4-6 | yes | Root-cause analysis, regression isolation, failure diagnosis (Sonnet). |
| designer | claude-sonnet-4-6 | yes | Designer-turned-developer who crafts stunning UI/UX even without design mockups. Use for VISUAL changes only (styling, layout, animation). Pure logic changes in frontend files should be handled directly. |
| document-specialist | claude-sonnet-4-6 | yes | Document Specialist for documentation research and reference finding. Use for local repo docs, official docs, Context Hub / chub or other curated docs backends for API/framework correctness, GitHub examples, OSS implementations, external literature, academic papers, and reference/database lookups. Avoid internal implementation search; use explore for code discovery. |
| domain-expert-reviewer | claude-opus-4-7 | yes | Explicit proxy for domain-expert review — runs multi-persona pre-launch audit and produces a "questions for real expert" list (opus, read-only). |
| executor | claude-sonnet-4-6 | yes | Focused task executor. Execute tasks directly. NEVER delegate or spawn other agents. Same discipline as OMC, no delegation. |
| explore | claude-haiku-4-5 | yes | Fast codebase exploration and pattern search. Use for finding files, understanding structure, locating implementations. Searches INTERNAL codebase only; external docs, literature, papers, and reference databases belong to document-specialist. |
| git-master | claude-sonnet-4-6 | yes | Git expert for atomic commits, rebasing, and history management with style detection |
| ideate | claude-opus-4-7 | yes | Divergent idea generator grounded in JTBD/ODI, TRIZ, Blue Ocean, SCAMPER — produces scored, falsifiable hypotheses (opus). |
| performance-guardian | claude-sonnet-4-6 | yes | Performance auditing (sonnet) — Core Web Vitals, bundle size, runtime patterns. |
| planner | claude-opus-4-7 | yes | Strategic planning consultant. Interviews users to understand requirements, then creates comprehensive work plans. NEVER implements - only plans. |
| priority-engine | claude-sonnet-4-6 | yes | Product portfolio prioritization (sonnet) — ranks candidate moves and emits opportunities plus rolling roadmap. |
| product-cycle-controller | claude-sonnet-4-6 | yes | Product learning loop controller (sonnet) — owns discover/rank/select/spec/build/verify/learn cycle state. |
| product-ecosystem-architect | claude-opus-4-7 | yes | Product ecosystem architecture (opus) — maps app/content/data/distribution loops and deeper feature paths. |
| product-strategist | claude-sonnet-4-6 | yes | Product strategy evaluator (sonnet) — feature evaluation, constitution alignment, roadmap prioritization. |
| qa-tester | claude-sonnet-4-6 | yes | Interactive CLI testing specialist using tmux. Tests CLI applications, background services, and interactive tools. Manages test sessions, sends commands, verifies output, and ensures cleanup. |
| scientist | claude-sonnet-4-6 | yes | Data analysis and research execution specialist. Executes Python code for EDA, statistical analysis, and generating data-driven findings. Works with CSV, JSON, Parquet files using pandas, numpy, scipy. |
| security-reviewer | claude-sonnet-4-6 | yes | Security vulnerability detection specialist (Sonnet). Use for security audits and OWASP detection. |
| technology-strategist | claude-opus-4-7 | yes | Technology strategy decision owner (opus) — selects and expands stack choices, application blocks, and skill provisioning targets. |
| test-engineer | claude-sonnet-4-6 | yes | Test strategy, coverage, flaky test hardening (Sonnet). |
| tracer | claude-sonnet-4-6 | yes | Evidence-driven causal tracing specialist. Explains observed outcomes using competing hypotheses, evidence for and against, uncertainty tracking, and next-probe recommendations. |
| ux-architect | claude-sonnet-4-6 | yes | Macro-level UX (sonnet) — user flows, information architecture, app/screen states, navigation patterns. |
| ux-researcher | claude-sonnet-4-6 | yes | UX research synthesis (sonnet) — user feedback analysis, study plans, usability pattern extraction. |
| verifier | claude-sonnet-4-6 | yes | Completion evidence, claim validation, test adequacy (Sonnet). |
| writer | claude-haiku-4-5 | yes | Technical writer who crafts clear, comprehensive documentation. Specializes in README files, API docs, architecture docs, and user guides. |
