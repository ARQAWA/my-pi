## Measurements and benchmarks

Runs exist to find and fix defects, not to tick a box. Every measurement or benchmark with model calls follows:

1. Waves, never the whole matrix at once: a small first wave, then larger ones. The first launches use the
   strongest models of the measured list, so a defect shows at the start on strong models.
2. Outputs are checked continuously while the run goes, not only at checkpoints: an automatic anomaly watcher
   runs after every run, and an agent reads the actual outputs, not only counters, for anomalies (repeated rounds,
   errors, format failures, loops, outliers in time).
3. At the first obvious defect the run stops at once and the defect is fixed before anything else runs. Waiting for
   the full run only means rerunning it after the fix.
4. The next wave starts only after the previous one is clean; the full matrix only after the early waves are clean.
5. Calibration, meaning fixing the system under test, happens on the strongest models. Weaker models are measured
   afterwards on the calibrated version; their failures are recorded as capability limits, not treated as defects
   to fix, unless they show a mechanics or checker bug.
6. Measurement runs have no hard request or start caps as stop conditions; usage never stops a run. The one exception is the
   controlled pause of the [task timebox](../PROCESS.md#task-timebox): outstanding work pauses at a review boundary and is
   reported; it is no request or start cap. The measurer
   supervises instead: a programmatic monitor checks the running wave every 1-5 minutes (not
   continuous polling), the measurer reads the actual outputs it surfaces, and interrupts the run on real anomalies
   (harness defect, stuck or looping reviewer, runaway repairs, unpinned sources, errors).
7. When two judges disagree, a third independent arbiter subagent verifies the disputed finding against the sources and
   decides.
