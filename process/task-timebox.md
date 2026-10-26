## Task timebox

Owner's words and reasons: [DECISIONS.md, Task pipeline](../DECISIONS.md#task-pipeline), `D-PIPELINE-TIMEBOX`.

- Substantive work on a development task is limited to 2 hours, from the start of real work until the finished
  implementation or result is handed over. Count research, design, implementation and fixes of actual defects. Do
  not count check runs, review passes, CI or other external waits toward substantive work. Genuine CI, review and owner
  waits are not active execution. A scheduled local full-release regression is the single active execution task while
  it runs, but its check time remains excluded from substantive work. Time genuinely paused or waiting externally is not counted.
- The clock belongs to the logical task: all its descendant agents and all earlier work count. A retry, a restart or
  a handover to a helper never resets it.
- At 2 hours of substantive work on an unfinished task, Main pauses it safely (`interrupt`, sessions kept, no
  checkpoint file) and reports to the owner: the achieved result, the known costs, the roadmap of next steps and why
  it is unfinished, with facts kept apart from hypotheses. The report gives substantive work time separately from
  verification and wait time; when the logs cannot separate them, it says the time is unknown and states no exact
  figure the timestamps do not prove.
- Main starts the highest-priority runnable task of the waiting queue next. Waiting for the owner's answer is not
  active execution.
- More work on the paused task needs the owner's decision, and no silent
  continuation, restart or reassignment replaces it. If the owner continues it, Main reprioritises and resumes the
  task, interrupting a lower-priority active task if needed, with its history kept.
- This is a control checkpoint, not a promise that any task is done in 2 hours.
