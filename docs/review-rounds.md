# Review and QA rounds

Every independent check on the build, newest last. Each entry gives who checked, at which commit, what was checked, what was found, and what happened to it. Times are UTC on 2026-11-20. The verifiers (GLM models) are a different model family from the builders (DeepSeek, and MiniMax until 05:06Z), so verification doesn't depend on the authors. Full narratives are in `docs/ai-dev-log.md`.

| Round | What and where | Who | Verdict | Findings and outcome |
|---|---|---|---|---|
| R1 | Step 1 spike, `a70556e` | dev-qa | PASS | 6/6 in Docker, on a clean worktree. Minor: an evidence string read "8 h" for 4 h of rest; fixed in step 4. |
| R2 | Steps 2–3, `502c434` | review-r1 | APPROVE | Ran the full api suite, `SchemaConstraintsTest` 15/15, web 9/9, compose refusal without secrets, and the live stack. Docs had drifted (grants, `npm ci`, `make env`, nginx root); fixed in `06afcaa`, ADR-018. |
| R3 | Steps 2–3, `502c434` | dev-qa | PASS | 28/28. Cross-checked each constraint against its test. S-04 was decided as workflow-enforced (ADR-019). One finding (CHECK rejects NULL) was **disproved**: see ai-dev-log #23. |
| R4 | Step 4 rules, `dbd0365` | dev-qa | PASS* | 68/68. Every rule checked at under, exactly and over its limit. A mutation check (3 rule values flipped) produced exactly 8 failures. *Ran on the working tree, so it missed R5's blocker. |
| R5 | Step 4, `dbd0365` | review-r2 | CHANGES NEEDED | **F1 blocker:** `.gitignore` `build/` swallowed the fact-builder package, so a clean clone couldn't compile. F2–F8 logic defects. All fixed (`b4a2562` … `6755e4f`). |
| R6 | Step 4, `c034923` | dev-qa | PASS | Clean worktree: 69/69, nothing ignored, mutation check repeated. |
| R7 | Step 4 + generator, `545afcc` | review-r2 | APPROVE F1–F8 | 83/83, with revert-the-fix checks. Generator findings R1–R5 (e.g. 16 h shifts extended past the 16 h ceiling in the actuals) fixed in `1c73768`, `baf42d0`. |
| R8 | Web UI round 1, `15e2421` | dev-design | 7 blocking | Code read: the acknowledge button saved immediately, chips weren't clickable, Approve wasn't gated, overtime-pay wording contradicted ADR-016, and more. Fixed in `7b228b9`. |
| R9 | Step 6 auth, `e19cec5` | review-r2 | CHANGES NEEDED | Validly signed tokens with hostile claims returned 500, not 401. Fixed in `ba8f763`. |
| R10 | Step 5 generator, `c3f5d41` | dev-qa | PASS | 84/84. Checksum reproduced. Own SQL checks: 0 overlaps, overtime 6.54%, coverage 98.04%. PC-06 had only one four-night run; fixed in `3cec3bd`. |
| R11 | Web UI round 2, `4413ea0` | dev-design | 5 blocking | Each fix reverted to prove its test fails. Approver landed on "Page not found", E3 impossible in fixtures, Build ignored unsaved edits. Fixed in `448fb62`, `c2da72b`. |
| R12 | Step 6, `0dc96e1` | dev-qa | PASS + leak | 125/125. Whole permission matrix probed. **Scope leak:** `POST /rule-checks` skipped the unit-scope check. |
| R13 | Step 6, `0dc96e1` | review-r2 | CHANGES NEEDED | **S2 HIGH:** two concurrent saves for one officer both passed the Block rules (a check-then-write race). Also S1 (the R12 leak), S3 (500s), S4 (28-day window). Fixed in `f73d6c5`; **re-verification pending**. |
| R14 | Web UI round 3, `f14b261`/`c919c8f` | dev-design | 1 blocking | Every guard mutated; all real. E2 broken in fixtures; fixed in `46ba5f6`. |
| E2E | Playwright, `e2e-playwright` vs web `46ba5f6` | dev-design | 25/3/4 | Real browser in Docker, axe checks: one real accessibility defect (a scroll region keyboard users can't reach). E5 is fixme (not built). |
