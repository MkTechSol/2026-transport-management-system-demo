# ADR 0003 — Stock held by stores *or* bowzers

**Decision:** stock quantity is tracked per `(item, holder)` where holder is a store or a vehicle; movements are an immutable ledger; balances carry `CHECK (qty >= 0)`. Tyres are additionally serial-tracked.

**Why:** the client's meaning of "inventory" is what is fitted to each vehicle (5 cameras here, 3 there), tyre changes and spare-part replacement. A store-only model cannot answer those questions.

**Costing:** moving average over store stock; fitting an item to a bowzer expenses it to that bowzer; returning reverses; moving between bowzers re-allocates cost. Invariant: inventory ledger = Σ store qty × average cost (tested, and shown in Setup → Data integrity).
