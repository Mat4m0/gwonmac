# Investigation record template

> **Purpose:** preserve an expensive wrong turn so that another maintainer does
> not repeat it. This is an evidence format, not an architecture document.

Create a record when the cause was not where the symptom suggested, an
instrument gave a false impression, or a shipped correction needed replacement.
If the first hypothesis was correct, use a commit message instead.

Record each round while it happens. A later reconstruction usually keeps the
answer and loses the useful failed hypothesis.

## Template

```md
## Round N: short result

**Hypothesis:** State what you believed and why it was plausible.

**Change:** State what you changed because of the hypothesis.

**Measurement:** Include the exact value, trace line, error, or observed result
that confirmed or rejected the hypothesis.

**Retained work:** List only work that remains correct for an independent
reason.

**Lesson:** State the rule that would have shortened this investigation.
```

## Evidence rules

- A rejected hypothesis needs a measurement.
- State what each instrument cannot observe.
- Treat a misleading instrument as a defect and record it.
- Record the exact client build for every index, address, offset, and hash.
- Use the least expensive proof that can decide the question.
- End the investigation with the current conclusion and evidence boundary.
- Remove temporary client-memory probes, tracers, and patches after they answer
  the question. Preserve only their result here.
