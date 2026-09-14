# Review instructions

> 本文件描述 AI 自审 PR 时遵循的策略。技术负责人编写并在仓库根目录维护。

## Passes

Run three passes and tag each finding with its pass:

- **Bugs**: logic errors, broken edge cases, subtle regressions
- **Security**: injection risks, authentication gaps, PII in logs
- **Compliance**: the change matches spec.md, plan.md and our design principles

## What Important means here

Reserve **Important** for findings that would break behavior, leak data or breach a policy. Style and naming are nits.

## Cap the nits

Report at most **five nits** per review; summarize the rest as a count.

## Do not report

- Generated files under `src/gen/` (and other generated paths your team configures)
- Anything CI already enforces (lint rules, type checks, etc.)

## Severity tags

Each finding must include:

- `pass`: bugs | security | compliance
- `severity`: important | nit | info
- `file:line`: location
- `evidence`: code snippet
- `suggestion`: specific fix recommendation

## Feedback loop

- When review flags the same error the second time, add the correction to `AGENTS.md`
- Review reads `AGENTS.md`, so the error gets caught in future PRs
- Review also flags when a change makes `AGENTS.md` stale

## Monthly tuning

Tech lead adjusts settings by scoring findings:

- Cap nit counts in `REVIEW.md`
- Exclude paths already enforced by CI
- Exclude generated paths

## Governance

- Review policy applies to ALL PRs
- Findings, fixes, scoring, and approvals are recorded in PR history
- PR is the audit record
- Approval comes from humans via branch protection, informed by findings
