# Implementation plan

1. Update the dogfood and shipped `subnode_artifact.py` copies together:
   optional relation fields use `get()`, while supplied values keep validation;
   non-complete `completed_scope` accepts an empty list.
2. Replace the obsolete test that requires null relation fields with regression
   coverage for an ordinary relation-free brief and an early error report.
3. Make the matching reference and Marketplace wording precise: relation fields
   are only supplied for retry/counterwork; native event waiting forbids
   high-frequency polling, not post-wait/on-demand inspection.
4. Run targeted tests and parity, then the repository checks and graph change
   analysis. Release Marketplace and Trellis as the same next version; update
   the Pennix setup pin in its owning task only after the tag is available.
5. In a temporary repository, run the published CLI's native `init` with the
   fixed Marketplace source and inspect the selected workflow plus generated
   managed assets.
