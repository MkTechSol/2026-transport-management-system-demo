# ADR 0004 — Rule-based exceptions and a labelled demo assistant

**Decision:** the Exceptions Center is a set of explicit, readable rules computed from live data (acknowledgements are the only stored state). The assistant is a keyword/intent matcher over the same data and permissions, labelled "not a language model", read-only, and audited.

**Why:** managers need to see *why* something is flagged and trust the numbers; a language model adds cost, latency and the risk of confident wrong answers on financial data. A real LLM can be added later behind the same endpoint and permission checks.
