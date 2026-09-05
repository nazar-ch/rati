# improvement-review — multi-direction improvement proposals

Four generative review directions over rati, each run as its own session — maintainer-launched, deliberately not orchestrated: where the framework should go next, what adopters will miss, what its own model uniquely enables, and what fresh eyes would change. The output is proposals, not code — new or extended records under docs/research/. This is the counterpart of the production-review effort: that one makes the existing surface sound, this one asks what surface is missing.

Out of scope for every direction: `packages/rati/src/data/`, whose roadmap is the data-package effort's; documentation and website work, which are separate efforts; and anything already decided against — the research tree's rejected options stay rejected unless a session brings genuinely new evidence, and then the output is a "reopen?" note rather than a re-proposal.

## Sequence

The four directions are independent and run in any order, one session per item, no orchestration. Best after the scope-and-island effort lands, so no session proposes what is already landing; testing-and-dx is context rather than a gate, and production-review runs before, after or interleaved, since it asks a different question.

The fence between the two outward-looking directions: IMP-01 compares against other frameworks' features, IMP-03 walks the adoption path into a real existing app. IMP-02 looks inward at the model's unexploited structure, and IMP-04 is the unconstrained redesign pass.

Close-out, once all four have filed: a closing session reconciles the overlaps between their outputs — two sessions converging on one idea is signal, and the reconciliation note says so — then archives this effort. Graduating any proposal to a planned effort is the maintainer's separate call.

## Orchestration notes

- **Every session starts by reading the existing design space** and may only propose net-new or materially sharpened directions. A proposal duplicating a recorded direction is the session failing its first instruction, and citing the record it *extends* is how a session proves it read them. The inventory, verified at cut:
  - docs/research/ whole — especially router-extensions.md (composition, layout scope, guards, typed search params, navigation status and blocking: a large claimed space, and `packages/rati/src/router/group.tsx` exists, so check what has landed since), ssg-and-rsc.md, and the executed scope-and-island-directions.md and dx-and-tooling.md.
  - docs/research/undecided/ and docs/research/postponed/ — weighed or deferred, so a proposal touching one must engage with the recorded reasoning rather than restate it.
  - docs/archive/directions-2026-07/ — the July review's shipped record, including naming.md (the vocabulary rules any proposal must respect: plain English, no coined terms) and data-package.md (the boundary with the excluded layer).
- **The proposal format**: a self-contained section, or a new file, under docs/research/ in that tree's house style — the problem, the sketch, precedents in the field, the cost or risk, and the concrete need that would trigger it. The tree's wait-for-need discipline applies to new proposals too: a session recommends, the maintainer decides what graduates to planned.
- **Grounded generativity**: a claim about what the field does — a competitor's behavior, a library's API — is checked against current sources at session time rather than recalled, and a proposal's "X can't do this" or "users of Y expect this" line is cited.
- **Each session ranks its own output**, ending with a top-3 ("if the maintainer reads only three proposals, these"), so four sessions' breadth stays digestible.
- **A session's summary note lands in its own record**, with its top-3; a bug found mid-exploration files to the production-review lens that owns it.
- **A session touches docs/research/ and its own record only** — no `packages/rati/src/` changes and no docs/current/ changes, because a proposal is not yet behavior.
- **Grading**: strongest available model, high effort. Breadth of association and judgment about what to leave unproposed are both the work.
