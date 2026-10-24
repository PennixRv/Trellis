# Independent evaluation

Use independent evaluation when one answer needs a countercheck. The evaluation method changes the work brief, not the generic teammate role card.

## Advisor

An advisor is one ordinary work unit assigned to analyze a question and return evidence-backed recommendations. It uses the generic `.trellis/agents/teammate.md` contract; there is no advisor-specific runtime identity or agent card.

## Two-member committee

A committee is exactly two work units in the same frozen batch:

- Give both units the same normalized question, source boundary, and acceptance contract.
- Assign distinct evaluation lenses so their reasoning is meaningfully independent.
- Keep their evidence independent. The counter evaluation must identify its primary evaluation and must not reuse its evidence identities.
- Do not let the two teammates communicate or revise their work in response to one another.
- Wait for the whole batch's terminal receipt before comparing or synthesizing either report.

The batch artifact records the shared `evaluationGroup` and the counter relationship in `counterOf`. Validation rejects a missing or mismatched pair, identical lenses, a different shared contract, a missing primary evaluation, or overlapping evidence identities.

The coordinating agent compares both reports against the same acceptance contract only after terminal completion. If one unit remains failed after its bounded retries, preserve that failure in the receipt and report the evaluation as incomplete; do not synthesize a successful verdict from the other report alone.
