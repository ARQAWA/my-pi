# Workflow Manifest

This file records how the owner works and what he expects of the agent's work on my-pi. The agent rereads it and aligns with it; where the work disagrees with it, the work changes, not this file. It changes only by the owner's direct edit, his direct request, or his explicit approval of a proposed change. It describes the work, not the package: the layout lives in `AGENTS.md`, the decisions in `DECISIONS.md`.

## How the owner works

The owner is an experienced engineer. He works fast, simply and in iterations: he takes the shortest path to the result, gathers the information the decision needs, picks the best solution his expertise, the documentation and the source code support, hands the result over, runs it, looks at it and decides the next iteration. The agent works the same way, and my-pi is built this way, step by step: a correct, proven result sooner is worth more than a perfect one later.

## Quality bar

What is handed over is excellent, fully proven and in line with this manifest. Solutions are as simple, light and blunt as possible, without over-engineering, and still fast and efficient. They are universal and work automatically, always. Everything agreed is done in full, and nothing beyond it is added; quality words such as "perfect" or "robust" never widen the work.

## Agreement and questions

The agreement is the owner's own words across the whole conversation, his answers and the proposals he accepted, fixed in text that can be quoted. While the owner discusses or plans, nothing is changed until he gives the go. Before the work starts, the agent compiles every requirement he has stated, finds the contested points and asks, in one message, only about what his words leave open: wording by which a reviewer could not check the result, and a choice that changes what he gets. Choices he leaves to the agent are made by it: the best and most efficient solution, settled by measurement where it can be measured, and recorded. Everything else goes into the work at once.

## Autonomy and execution

From the go, the task runs autonomously to the final proven result; the owner hears nothing before it unless a blocker only he can remove appears. Speed is wall-clock time to a correct result, and everything independent runs in parallel. The main agent is the coordinator: it chooses how to execute the task, keeps its own context lean, hands the work to as many parallel subagents as the task needs, each with a self-contained task that returns its result, and remains responsible for scope and result. Subagents run on Opus only, at low, medium or high reasoning. Work happens only in this repository; other repositories are read-only sources.

## Proof

Everything is proven, corner cases included. Tests, checks against Pi's documentation and source code, and model runs are always part of the work, chosen to fit the claim. The proof covers Windows, the owner's platform, as well as macOS and Linux.

## Review

Every change passes an independent review before it is merged; an answer or report without changes needs none. The agent picks the reviewer's strength for the work; which strength fits which work is settled by measurement. The reviewer is an independent subagent doing code review: it checks that what was agreed is delivered and nothing extra is piled on, and does not try to prove the work perfect. Minor inaccuracies without effect and matters of taste are not findings. Each pass covers the whole work and returns every problem it sees at once; the main agent checks the quotes of the findings, fixes the admitted ones in one iteration, and a fresh reviewer checks the whole work again, until it returns CLEAN. Large work is split into parts for parallel reviewers; after fixes, only the parts they touch are checked again. Every finding and every rejection rests on verbatim quotes of the agreement and of the work; a finding backed by quotes must be fixed, a finding without them is rejected, and every later pass gets the earlier rejections with their reasons, so settled points are not raised again.

## Git

Each task runs on its own branch. When the result is proven and the review is CLEAN, the agent commits, pushes and merges the branch into `main` by itself, then reports once. Publishing outside the repository, such as a release or a Marketplace version, happens only on the owner's direct request.

## Decisions and documentation

Every rule and every decision lives in one place. Every decision goes into `DECISIONS.md` with the owner's quote, its reason and the file that carries it, so a later change knows what it replaces. Code and documentation must not drift apart: a change updates its documentation in the same merge. Whatever is abolished is removed wherever it still stands; whatever is postponed stays recorded as postponed. History stays in Git: no archive copies and no removal notes.

## Communication

The agent answers the owner briefly, in his language, with the main point first: a few short paragraphs at most, no wall of text.
