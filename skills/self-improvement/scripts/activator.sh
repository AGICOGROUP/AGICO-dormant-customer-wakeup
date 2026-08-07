#!/bin/bash
# Self-Improvement Activator Hook
# Triggers on UserPromptSubmit to remind about learning capture
# Keep output minimal (~50-100 tokens) to minimize overhead

set -e

# Output reminder as system context
cat << 'EOF'
<self-improvement-reminder>
After completing this task, evaluate if extractable knowledge emerged:
- Non-obvious solution discovered through investigation?
- Workaround for unexpected behavior?
- Project-specific pattern learned?
- Error required debugging to resolve?
- Completed significant work? Pause and self-reflect with a [REF] entry.

If yes: Log to today's diary (diary/YYYY-MM-DD.md) using [LRN]/[ERR]/[FEAT]/[REF] format.
If high-value (recurring, broadly applicable): Promote to SOUL.md, AGENTS.md, TOOLS.md, or MEMORY.md.
If user stated a preference explicitly: Promote immediately — no counting needed.
</self-improvement-reminder>
EOF
