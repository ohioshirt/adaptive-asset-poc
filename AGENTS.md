# Agent instructions

- Preserve the separation of semantic intent, deterministic control plane, renderer, and offline provider/validator.
- Do not turn this into a general game engine. Prove the shared abstraction with one additional real media adapter before expanding scope.
- Run `npm test` before/after changing runtime. Add regression cases for event ordering, exact boundary, rerouting, simultaneous requests and time partition independence when relevant.
- Treat runtime contract correctness and perceived naturalness as separate evidence. Never claim media compatibility or continuity solely from metadata.
- Keep existing rigtext integration optional; compare rather than replace without evidence.
- Never introduce private character assets, proprietary media or external credentials without explicit approval. Synthetic samples are intentionally self-contained.
- Record changed assumptions, commands, pass/fail results and unverified claims in experiment notes.
