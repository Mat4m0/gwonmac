# Investigation log template

The shape [investigation-log.md](investigation-log.md) is written in, extracted
so the next investigation does not have to invent one. Copy the skeleton below
into a new log, or as the next round of an existing one, and fill it in while
the work happens — a round reconstructed afterwards keeps the answer and loses
the wrong turn, which is the part worth writing down.

## When a log is owed

When the cause was not where the symptom pointed, an instrument lied, or a
shipped fix had to be replaced. Work whose first hypothesis held needs a commit
message, not a log.

## The skeleton

```md
## Round N — wrong: the one-line claim

**Hypothesis.** What was believed, in the terms that made it plausible.

**Built.** What was written on the strength of it, named well enough that a
later reader can tell which parts survived.

**Wrong because** — the measurement that killed it, quoted. The number, the
string, the trace line, not "this turned out to be incorrect".

**Kept anyway.** Only when part of the wrong build stands on its own merits;
say what those are without the hypothesis that produced it.

**Lesson.** The rule that would have shortened the round, stated so it applies
to work with nothing else in common with this bug.
```

A round that was right keeps the same headings and says so in its title. The
ratio is part of the record.

## What keeps it worth reading

- A hypothesis retired without a measurement is still alive. Say what was run,
  and prefer the cheapest level that could decide the question.
- Name what the instrument could not see. Silence from a filtered trace is not
  absence, and an instrument gets its own defects recorded like any other.
- Date a round that lands long after the ones above it; every index, offset and
  hash in these documents belongs to one client build.
- Close a finished investigation with what we would do differently and the
  verification ladder that ended up working, so the next one starts a level up.
- Probes that read client memory, temporary tracers and one-off patches are
  removed once they have answered. The log is where they persist.
