# ShiftCircle — requirement-to-proof traceability

**Derived from the test sources, not from the prose.** Checked on 2026-11-20 against `main` at
`c0dcaf3` by grepping `@Test`, Playwright `test(...)` titles and the Flyway migrations. The
sources hold **97 rules + 27 infrastructure + 224 api = 348 tests**, counted as `@Test` methods
on their own line (no parameterised tests). The last full clean-worktree runs are dev-qa's
independent ones at `c0dcaf3`: **348, 0 failures, 0 skipped**, in the default order and with random
seed 20261121; Playwright against the real api gives desktop 19 passed and tablet 18 + 1 skipped,
fixtures 43 passed / 3 skipped. This author's static count agrees. A proof below names the test
class and method that makes the claim, not the document that hopes it exists.

**Path shorthand.** `RulesTest` = a class in `api/shiftcircle-rules/src/test/java/ca/shiftcircle/rules/`;
`ApiTest` = a class in `api/shiftcircle-api/src/test/java/ca/shiftcircle/api/`;
`InfraTest` = a class in `api/shiftcircle-infrastructure/src/test/java/ca/shiftcircle/infrastructure/`;
`WebTest` = a component test in `web/src/`; `e2e` = a spec in `e2e/tests/`.

**Status.** **PASS** = an automated test asserts the behaviour. **PARTIAL** = a test asserts part of
it (shape, one side of a boundary, or one layer). **NOT COVERED** = no test. **PROCESS** = enforced
by review or convention, with no code assertion.

## 1. Rules — every rule the assessment names

| Rule | What the proof must show | Test(s) | Status |
|---|---|---|---|
| U-01 | 8 h rest in 24 h: 7 h 59 m BLOCK, exactly 8 h PASS; evidence names both shifts | `RestRulesTest#u01BlocksWithSevenHoursFiftyNineMinutesRest`, `#u01PassesAtExactlyEightHours`, `#u01PassesJustOverEightHours`; `RuleScenarioRunnerTest#everyNamedScenarioPassesOnThePublishedRuleSet` (T2/T3) | PASS |
| U-02 | 12 h target: 11 h 59 m WARN, 12 h PASS, 16 h shifts exempt | `RestRulesTest#u02WarnsAtElevenHoursFiftyNineMinutesAfterARegularShift`, `#u02PassesAtExactlyTwelveHours`, `#u02DoesNotApplyAfterSixteenHourShifts` | PASS |
| U-03 | 12 h after a 16 h shift: 11 h 59 m BLOCK, 12 h PASS | `RestRulesTest#u03BlocksAtElevenHoursFiftyNineMinutesAfterASixteenHourShift`, `#u03PassesAtExactlyTwelveHours`; `RuleScenarioRunnerTest#everyNamedScenarioPassesOnThePublishedRuleSet` (T4) | PASS |
| U-04 | OT extension ≥ 4 h: 9 h 59 m rest WARN, 10 h PASS, 3 h 59 m extension not triggered | `RestRulesTest#u04WarnsAfterAFourHourExtensionWithNineHoursFiftyNineMinutesRest`, `#u04PassesAtExactlyTenHours`, `#u04DoesNotTriggerForAnExtensionOfThreeHoursFiftyNineMinutes` | PASS |
| U-05 | 16 h in any 24 h: rostered 16 h PASS, +15 min extension BLOCK | `HoursAndRunsRulesTest#u05PassesForARosteredSixteenHourShift`, `#u05BlocksWithAFifteenMinuteExtension`; `RuleScenarioRunnerTest` (T2) | PASS |
| U-08 | 7 consecutive days PASS, 8th scheduled BLOCK, 8th OT WARN, tied runs BLOCK | `HoursAndRunsRulesTest#u08PassesAtSevenConsecutiveDays`, `#u08BlocksAnEighthScheduledDay`, `#u08WarnsWhenTheEighthDayIsPickedUpOvertime`, `#u08BlocksWhenAnOvertimeRunTiesAScheduledRun` | PASS |
| U-09 | 4 consecutive 12 h shifts PASS, 5th scheduled/extended BLOCK, 5th OT WARN, tied runs BLOCK | `HoursAndRunsRulesTest#u09PassesAtFourConsecutiveTwelveHourShifts`, `#u09BlocksAFifthScheduledTwelveHourShift`, `#u09BlocksAFifthTwelveHourShiftEvenWhenItIsExtended`, `#u09BlocksWhenAFiveShiftScheduledRunTiesAnOvertimeRun`, `#u09WarnsWhenTheFifthShiftIsPickedUpOvertime` | PASS |
| U-10 | 4 overnight 12 h shifts PASS, 5th WARN | `HoursAndRunsRulesTest#u10PassesAtFourOvernightShiftsAndWarnsAtFive`; `RuleScenarioRunnerTest` (T5) | PASS |
| U-11 | 3 per 7 d and 10 per 28 d; 4th in 7 d WARN, 11th in 28 d WARN, 7-day boundary PASS | `HoursAndRunsRulesTest#u11PassesAtThreeSixteenHourShiftsInSevenDays`, `#u11WarnsAtAFourthSixteenHourShiftWithinSevenDays`, `#u11CountsAnExtendedSixteenHourShift`, `#u11PassesWhenTheFourthShiftIsExactlySevenDaysAfterTheFirst`, `#u11WarnsAtAnEleventhSixteenHourShiftWithinTwentyEightDays` | PASS |
| U-12 | 2 consecutive days off in 7; 48 h PASS, 47 h 59 m WARN, break boundary and leading/trailing breaks counted | `HoursAndRunsRulesTest#u12PassesWithFortyEightHoursOff`, `#u12CountsABreakOfTwentyFourHoursAsNoDayOff`, `#u12CountsABreakOfTwentyFourHoursOneMinuteAsOneDay`, `#u12IgnoresALongBreakFromAnEarlierWeek`, `#u12CountsLeadingAndTrailingBreaksInTheWindow`, `#u12WarnsWithFortySevenHoursFiftyNineMinutesOff`, `#u12CountsDaysOffAtTheBreakBoundary` | PASS |
| U-14 | 48 h PASS, 48.25 h WARN, 60.25 h BLOCK; no override | `HoursAndRunsRulesTest#u14PassesAtExactlyFortyEightHours`, `#u14WarnsAtFortyEightHoursFifteenMinutes`, `#u14BlocksAtSixtyHoursFifteenMinutes`; override refusal in `AssignmentApiTest#aBlockRuleWithoutAnEmergencyOverrideCannotBeOverridden` | PASS |
| U-15 | Board shows under / approaching / in overtime for the current period; 71.99 h UNDER, exactly 72 h APPROACHING, 79.99 h APPROACHING, exactly 80 h IN_OVERTIME; last day and midnight-crossing entry stay in their own period | `ScheduleApiTest#overtimeStatusChangesAtThePayPeriodThresholdBoundaries`, `#overtimeStatusUsesThePeriodThatContainsTheBoardDateAndCountsAMidnightCrossing`, `#listsTheOfficerRowsWithAssignmentsAndOvertimeStatus`; `PlanningPage.test.tsx#shows the officer pay-period hours with the overtime status pill` | PASS |
| P-01 | 80 h REG, 80.5 h → 0.5 OT15, 96 h → 80 REG + 16 OT15, rostered 16 h inside 80 h all REG | `PayAndShiftLengthRulesTest#p01TreatsEightyHoursAsRegular`, `#p01ClassifiesHalfAnHourBeyondTheThreshold`, `#p01TreatsRosteredHoursAndAPickedUpSixteenHourShiftAsDesigned`; `PayrollApiTest#adjustedTimesSplitPeriodOvertimeThroughThePayClassifier` | PASS |
| P-01b | OT paid at 1.5× | `PayAndShiftLengthRulesTest#p01ClassifiesHalfAnHourBeyondTheThreshold` (rate 1.5); `PayrollExportGoldenTest#theLockedPeriodsExportMatchesTheGoldenFileAndTheActualHours` (OT15 rows) | PASS |
| P-04 | OT under 30 min unpaid; 29 m → 0, 30 m → 0.5 h | `PayAndShiftLengthRulesTest#p04DoesNotPayTwentyNineMinutesOfOvertime`, `#p04PaysThirtyMinutesOfOvertime` | PASS |
| L-01 | Only 8/12/16 h; unexpected length BLOCK; an extended 16 h shift not blocked | `PayAndShiftLengthRulesTest#l01AcceptsEightTwelveAndSixteenHourShifts`, `#l01BlocksAnUnexpectedShiftLength`, `#l01DoesNotBlockAnExtendedSixteenHourShift` | PASS |
| S-03 | 16 h only where the unit has the agreement; 12 h agreement flag enforced | `PayAndShiftLengthRulesTest#s03BlocksASixteenHourShiftOnAUnitWithoutTheAgreement`, `#s03AllowsATwelveHourShiftWhereTheUnitHasTheAgreement`, `#s03BlocksATwelveHourShiftWhereTheUnitHasNoAgreement` | PASS |
| O-01 | Ranking policy comes from the OT_RANKING rows; blocked officers keep their place | `OvertimeRankerTest#thePolicyComesFromTheOtRankingRows`, `#aBlockedOfficerIsSkippedAndKeepsTheirPlace`, `#theRankingRuleRowsRecordThePolicy`; `OvertimeApiTest#theRankedListIsFewestOvertimeThenSeniority` | PASS |
| O-02 | Fewest overtime hours first, then seniority, deterministic ties | `OvertimeRankerTest#fewestOvertimeHoursRanksFirst`, `#equalOvertimeIsBrokenBySeniority`, `#tiesAreBrokenDeterministically`; `RuleScenarioRunnerTest#theRankingCheckPassesOnThePublishedPolicy` | PASS |
| O-03 | Skip officers who would break a rule, keep their fairness place; unqualified officer UNAVAILABLE | `OvertimeRankerTest#aBlockedOfficerIsSkippedAndKeepsTheirPlace`, `#keepPlaceCanBeTurnedOffByThePolicy`; `OvertimeApiTest#theRankedListIsFewestOvertimeThenSeniority`, `#theUnqualifiedOfficerHeadsTheControlListAsUnavailable` | PASS |
| S-04 | Workflow-enforced: only a supervisor creates/confirms EXTRA shifts or offers, and each writes an audit event | `AuthorizationMatrixTest#extraShiftsAreASeparateSupervisorActionAndAreAudited`; `OvertimeApiTest#anEmployeeCannotSendOrConfirmOffers`, `#creatingAnOpenShiftIsSupervisorOnlyAndAudited`; `AssignmentApiTest#aBlockIsSavedWithAnEmergencyOverrideAndAudited` (audit rows) | PASS |

U-06, U-07 and U-13 are not in rule set v1; `docs/05-union-rules.md` §3 says so. They are not a
missing test, but they are also not a delivered rule.

## 2. Scenarios T1–T14

The publish pipeline runs the rule-firing scenarios T1–T5 plus the T6 ranking check
(`RuleScenarioRunner`, `RuleSetApiTest#t7DroppingToThreeNightsShowsTheDryRunAndWarnsAfterPublish` reports the scenario counts). T7–T14 are database or
workflow scenarios; they are proved by their own API/DB tests, not by the rule-set build.

| ID | Proof | Status |
|---|---|---|
| T1 | `RuleScenarioRunnerTest#everyNamedScenarioPassesOnThePublishedRuleSet` includes T1 (rested officer, clean day) | PASS (rule outcome only; no separate API save test) |
| T2 | `RuleScenarioRunnerTest#everyNamedScenarioPassesOnThePublishedRuleSet` (T2 expects U-01 + U-05); `AssignmentApiTest#previewReturnsBlockingResultsAndSavesNothing`; evidence naming both shifts in `RestRulesTest#u01BlocksWithSevenHoursFiftyNineMinutesRest`; `e2e/e1-blocked-assignment.spec.ts` `@api PC-01 blocks from the empty cell, and the override and overtime links work` | PASS |
| T3 | `RuleScenarioRunnerTest#everyNamedScenarioPassesOnThePublishedRuleSet` (T3); `AssignmentApiTest#warningsNeedExplicitAcknowledgement`; `OvertimeApiTest#exactlyEightHoursRestIsAWarningNotABlock` | PASS |
| T4 | `RuleScenarioRunnerTest#everyNamedScenarioPassesOnThePublishedRuleSet` (T4); `RestRulesTest#u03BlocksAtElevenHoursFiftyNineMinutesAfterASixteenHourShift` | PASS |
| T5 | `RuleScenarioRunnerTest#everyNamedScenarioPassesOnThePublishedRuleSet` (T5); `HoursAndRunsRulesTest#u10PassesAtFourOvernightShiftsAndWarnsAtFive` | PASS |
| T6 | `RuleScenarioRunnerTest#theRankingCheckPassesOnThePublishedPolicy`; `OvertimeRankerTest` (10 tests); `OvertimeApiTest#theRankedListIsFewestOvertimeThenSeniority`, `#theUnqualifiedOfficerHeadsTheControlListAsUnavailable` | PASS |
| T7 | `RuleSetApiTest#t7DroppingToThreeNightsShowsTheDryRunAndWarnsAfterPublish` (dry run impact, submit/approve/publish, same check warns, live version) | PASS |
| T8 | `PayrollExportGoldenTest#theLockedPeriodsExportMatchesTheGoldenFileAndTheActualHours` (byte-for-byte golden file, actual hours, OT15) | PASS |
| T9 | `AssignmentApiTest#aBlockIsSavedWithAnEmergencyOverrideAndAudited` (reason ≥ 10, override + audit); `ReportsApiTest#overridesReconcileWithTheOverrideRowsAndCarryReasonActorAndRuleCodes` (report row); `DemoDataGeneratorTest#generatesADatasetThatPassesItsOwnSelfCheck` (PC-03 17 h override exists) | PASS |
| T10 | `RuleSetApiTest#t10TheAuthorCannotApproveTheirOwnDraft` (403); `SchemaConstraintsTest#rejectsAVersionApprovedByItsOwnAuthor` (DB CHECK) | PASS |
| T11 | `PayrollApiTest#aLockedPeriodIsReadOnlyInTheApiAndInTheDatabase` (409 + trigger); `SchemaConstraintsTest#rejectsTimeEntryChangesInALockedPayPeriod` | PASS |
| T12 | `PayrollApiTest#authorizationAndScopeCells` — another officer's hours answer 404 | PASS |
| T13 | `RuleSetApiTest#t13ARowBelowTheLegalFloorFailsValidationAndCannotBeSubmitted`; `RuleRowValidatorTest#aRestFloorBelowEightHoursIsRefused` | PASS |
| T14 | `PayrollApiTest#refusesToLockWithMissingActualsAndNamesThem` (3 missing, 409, stays OPEN); `#locksOnceEveryEndedShiftHasAnActualAndAuditsIt` | PASS |

## 3. Flows E1–E5

| ID | Spec file | Test titles | Recorded run | Status |
|---|---|---|---|---|
| E1 | `e2e/e1-blocked-assignment.spec.ts` (+ `keyboard.spec.ts`) | `@fixtures a Block shows its reasons and offers no way to save`; `@fixtures the emergency override needs a reason of at least 10 characters`; `@api PC-01 blocks from the empty cell, and the override and overtime links work`; `@fixtures with a reason the override saves`; `@fixtures Find eligible officer leads to the ranked list and offers to two officers`; keyboard `@fixtures E1: reach the PC-01 block, open the override, and back out` | Real api, desktop + tablet: `ai-dev-log` 61 (8 passed / 2 skipped per viewport) | PASS |
| E2 | `e2e/e2-offer-accept-confirm.spec.ts` | `an offer reaches Tara, she accepts, the supervisor confirms`; `an employee sees no colleague hours or overtime totals` | Real api: `ai-dev-log` 61 | PASS |
| E3 | `e2e/e3-rule-change.spec.ts` (+ `keyboard.spec.ts`) | `admin edits, builds and submits; approver approves and publishes`; `a supervisor can read the rules but not build, submit, approve or publish`; keyboard `@fixtures E3: edit, build, submit, sign out, approve, publish` | Real api: `ai-dev-log` 61 | PASS |
| E4 | `e2e/e4-lock-and-payroll.spec.ts` | `@fixtures the open period refuses to lock while actuals are missing`; `the open period can be locked at the demo clock`; `a locked period is read-only and exports the payroll CSV`; `unlocking a period asks for a reason of at least 10 characters` | Real api: `ai-dev-log` 61 | PASS |
| E5 | `e2e/e5-wall-display.spec.ts` | `shows counts only, with no officer names or employee numbers anywhere in the page`; `refreshes every 60 seconds and says when it last did`; `@api says it is not live when the api cannot be reached, and recovers`; `a supervisor sees only their own units`; `fits a 1920×1080 TV and a 1366×768 screen without scrolling` | **PASS** — dev-qa ran the full suite on a private fresh stack at `web-display a4b307e` (`docs/review-rounds.md` R26) and again for the stale fix at `067e556` (R27): 9 passed / 1 skipped per run, the skip being the fit test on the tablet project by design. Re-confirmed on the clean clone at `17308b7`. API counterpart `DisplayApiTest` 3/3 | PASS |

Every spec calls `expectAccessible` (axe, WCAG 2.1 AA, serious/critical fail) on the screens it
reaches; E1 also calls `expectDisclaimer`. E2–E5 rely on the web shell test for the footer.

## 4. Guardrails (HANDOFF §5)

| # | Guardrail | How it is enforced | Proof | Status |
|---|---|---|---|---|
| 1 | Synthetic data only | Fixed fictional units/users in `V3`; generated officers from a fixed seed; no real names in the UI | `DemoDataGeneratorTest#generatesADatasetThatPassesItsOwnSelfCheck` (100 officers, counts); `DisplayApiTest#theDisplayContainsNoNamesOrEmployeeIdentifiers`; `AppShell.test.tsx#does not use a government logo, wheat sheaf or coat of arms` | PARTIAL — a test can prove the generator's shape and that no names leak to the wall display, not that every name is fictional |
| 2 | No secrets in the repo | `.env.example` only; compose requires the variables; the API refuses to start | `StartupSecretsTest#startsWhenBothSecretsAreSet`, `#refusesToStartWithoutTheDatabasePassword`, `#refusesToStartWithoutTheJwtSecret`, `#refusesAShortJwtSecret`; `README.md` §4 | PASS |
| 3 | Never weaken a safeguard | 422/ack/override contract; maker/checker; locked-period trigger; append-only audit; no auto-approval; a database conflict answers a problem document, not a 500 | `AssignmentApiTest#aBlockRuleWithoutAnEmergencyOverrideCannotBeOverridden`, `#anEmergencyOverrideMustAlsoAcknowledgeTheWarnings`, `#aShortOverrideReasonIsRefused`; `AssignmentMoveCancelApiTest#cancelNeedsAReasonAndTheCurrentVersion`; `RuleSetApiTest#t10TheAuthorCannotApproveTheirOwnDraft`; `PayrollApiTest#aLockedPeriodIsReadOnlyInTheApiAndInTheDatabase`; `AuditApiTest#theTrailCannotBeChangedThroughTheApiOrTheDatabase`; `SchemaConstraintsTest#auditEventsCannotBeUpdatedOrDeleted`; `ConstraintProblemApiTest#anOverlappingEmergencyOverrideAnswersAConflictAndSavesNothing`, `#movingAShiftOntoAnotherOneAnswersAConflict` | PASS |
| 4 | Every rule needs boundary tests, reviewed by a human | Rule boundary classes + scenario runner; **human review waived** by the lead, AI verifiers instead | `RestRulesTest`, `HoursAndRunsRulesTest`, `PayAndShiftLengthRulesTest`, `RuleRowValidatorTest`, `RuleScenarioRunnerTest`; exception recorded in `HANDOFF.md` §5 and `ai-dev-log` 24 | PARTIAL — automated boundary tests exist; no human review has taken place (waived, not hidden) |
| 5 | Log AI use, corrections and rejections | `docs/ai-dev-log.md` (63 entries) and `docs/review-rounds.md` | Process only; the log is part of the submission | PROCESS |
| 6 | Keep docs in sync; record new decisions as ADRs | `docs/decisions.md` ADR-001…ADR-023; this traceability file | Process only; this document is itself the sync check | PROCESS |
| 7 | Small descriptive commits; the lead pushes | Local commits on `main`; no agent push | `git log` (small commits per slice); README/CLAUDE instruction | PROCESS |
| 8 | Footer line on every screen | Shared app shell + wall-display footer | `AppShell.test.tsx#shows the required footer disclaimer on every screen`; `PlanningPage.test.tsx#keeps the footer disclaimer`; `WallDisplayPage.test.tsx` (disclaimer assertion); `e2e/tests/support.ts#expectDisclaimer` used by E1 | PASS |

## 5. ADRs with a testable consequence

| ADR | Testable consequence | Proof | Status |
|---|---|---|---|
| 001 | Superseded by ADR-009 | — | — |
| 002 | Rules decide; humans approve; nothing auto-approves | `AssignmentApiTest#savingABlockedChangeReturns422WithResults`, `#warningsNeedExplicitAcknowledgement`, `#aBlockIsSavedWithAnEmergencyOverrideAndAudited`; `RuleSetApiTest#t10TheAuthorCannotApproveTheirOwnDraft` | PASS |
| 003 | Superseded by ADR-006 | — | — |
| 004 | Fictional facility, public rules | `DemoDataGeneratorTest#generatesADatasetThatPassesItsOwnSelfCheck`; `DisplayApiTest#theDisplayContainsNoNamesOrEmployeeIdentifiers` | PARTIAL (see guardrail 1) |
| 005 | No AI at runtime | No runtime AI dependency or external model call; rules are Drools + Java | Inspection only; no automated test | PROCESS |
| 006 | Three containers (web, api, db) | `docker-compose.yml`; `VersionEndpointTest#returnsBuildAndRuleSetInformation` exercises the api in-container in tests | No test starts the three composed containers | PROCESS |
| 007 | Superseded by ADR-012 | — | — |
| 008 | Simulated integrations stay inside the containers | `PayrollExportGoldenTest` (CSV bytes), `CsvTest` (quoting/formulas) | PASS |
| 009 | Scope: planning, employee, overtime, time/payroll, reports, rules, display | Presence/absence of endpoints and screens; out-of-scope items listed in `docs/10` §8 | No test asserts scope | PROCESS |
| 010 | No trades/notifications; 100 officers × 90 days | `DemoDataGeneratorTest#generatesADatasetThatPassesItsOwnSelfCheck` (counts, seed reproducibility) | PASS for data size; features absent by design | PARTIAL |
| 011 | Java + Spring Boot middle tier | The Maven build and every Spring test | `ShiftCircleApplicationTests`, `VersionEndpointTest` | PASS |
| 012 | Drools decision tables, editable rows, compile + scenarios + dry run + hot swap | `RuleRowValidatorTest`; `RuleScenarioRunnerTest`; `RuleSetApiTest#t7DroppingToThreeNightsShowsTheDryRunAndWarnsAfterPublish`, `#e3ARestTargetChangePublishesAndIncrementsTheLiveVersion` | PASS |
| 013 | Coverage is hourly, by unit and block | `ScheduleApiTest#reportsHourlyCoverageForTheDay`; `ReportsApiTest#coverageHoursReconcileWithTheAssignmentsHourByHour`; `DisplayApiTest#theDisplayShowsCoverageWithTheAdr017Shape` | PASS |
| 014 | REST, Problem Details, 422 rule results, preview, ETags | `ProblemDetailsApiTest` (404/400); `ApiProblemAdviceTest`; `AssignmentApiTest#savingABlockedChangeReturns422WithResults`; `AssignmentMoveCancelApiTest#cancelNeedsAReasonAndTheCurrentVersion` (428/412), `#movingUpdatesInPlaceAuditsBothSidesAndBumpsTheVersion` (ETag) | PASS |
| 015 | 8/12/16 h shift times; start times configurable through the rules flow | `SchemaConstraintsTest#migrationsApplyAndSeedTheReferenceData` (6 templates; A12 starts 00:00); `PlanningPage.test.tsx#uses the ADR-015 shift codes and the extra label` | **PARTIAL** — seed and codes are tested; the rules screen's `shift-types` route aliases the SHIFT_LENGTHS table (`RuleSetService`), so start times are not editable through the approval flow |
| 016 | Overtime is hours beyond the pay-period threshold | `PayAndShiftLengthRulesTest#p01TreatsEightyHoursAsRegular`, `#p01ClassifiesHalfAnHourBeyondTheThreshold`; `PayrollApiTest#adjustedTimesSplitPeriodOvertimeThroughThePayClassifier`; `PayrollExportGoldenTest` | PASS |
| 017 | Hourly coverage; lock only when ended shifts have actuals; counts-only rule review; explicit proposal decisions | `ScheduleApiTest#reportsHourlyCoverageForTheDay`; `PayrollApiTest#refusesToLockWithMissingActualsAndNamesThem`; `RuleSetApiTest#t7DroppingToThreeNightsShowsTheDryRunAndWarnsAfterPublish` (dry-run impact has no names); `DisplayApiTest#theDisplayContainsNoNamesOrEmployeeIdentifiers` | PARTIAL — proposals are a Should item and are not built (`docs/10` §8) |
| 018 | Audit-log grants deferred; triggers are the proof | `SchemaConstraintsTest#auditEventsCannotBeUpdatedOrDeleted`; `AuditApiTest#theTrailCannotBeChangedThroughTheApiOrTheDatabase` | PASS |
| 019 | S-04 is workflow-enforced, not a table row | `AuthorizationMatrixTest#extraShiftsAreASeparateSupervisorActionAndAreAudited`; `OvertimeApiTest#creatingAnOpenShiftIsSupervisorOnlyAndAudited`; audit rows in `AssignmentApiTest` | PASS |
| 020 | Demo data: 100 officers × 90 days, OT band 3–8%, reproducible checksum | `DemoDataGeneratorTest#generatesADatasetThatPassesItsOwnSelfCheck`, `#theSameSeedProducesTheSameRosterTwice`, `#fewerThanThreeFourNightRunsFailsTheSelfCheck` | PASS |
| 021 | Save-time safeguards: one scope guard, one officer lock, overrides never swallow warnings | `AssignmentApiTest#concurrentSavesCannotBothBypassBlockRules`, `#anEmergencyOverrideMustAlsoAcknowledgeTheWarnings`; `AssignmentMoveCancelApiTest#twoConcurrentMovesWithOneVersionCannotBothWin` | PASS |
| 022 | Lock/unlock/export facility-wide; double lock idempotent | `PayrollApiTest#lowConcurrentLocksWriteExactlyOneAuditRow`, `#authorizationAndScopeCells`; `SchedulePublishApiTest` for publish scope | PASS |
| 023 | Only EMERGENCY-policy Blocks can be overridden; U-08/U-09/U-14 cannot | `RuleRowValidatorTest#aMustRulesDocumentedOverridePolicyCannotBeChanged`; `AssignmentApiTest#aBlockRuleWithoutAnEmergencyOverrideCannotBeOverridden` | PASS |

## 6. Other Must requirements and NFRs (spot-check)

| Requirement | Proof | Status |
|---|---|---|
| FR-01 assign, unassign and move; every change runs the rules | `AssignmentApiTest`; `AssignmentMoveCancelApiTest` (move re-runs the pipeline); E1/E4 | PASS |
| FR-02 shift templates configurable | `SchemaConstraintsTest#migrationsApplyAndSeedTheReferenceData` (six seeded templates); `ReferenceApiTest#shiftTemplatesAndQualificationsAreReadableByAnySignedInRole` (read) | **PARTIAL** — start times/lengths are seed data, not editable in the prototype |
| FR-03/04 required vs scheduled vs actual per block; qualifications | `ScheduleApiTest#reportsHourlyCoverageForTheDay`; `ReportsApiTest#coverageHoursReconcileWithTheAssignmentsHourByHour`; `OvertimeRankerTest#anUnqualifiedOfficerKeepsTheFairnessPlaceButIsUnavailable` | PASS |
| FR-05 overtime status live | `ScheduleApiTest#overtimeStatusChangesAtThePayPeriodThresholdBoundaries`; `#overtimeStatusUsesThePeriodThatContainsTheBoardDateAndCountsAMidnightCrossing`; `PlanningPage.test.tsx#shows the officer pay-period hours with the overtime status pill` | PASS |
| FR-06 publish a period | `SchedulePublishApiTest#publishingIsScopedAuditedAndOneWay`, `#aDraftWeekReadsAsUnpublishedUntilItIsPublished`; `SchedulePeriodSeedApiTest#publishingASeededPeriodWorksOnAFreshDataset` (publishes a **generated** period, no planted row), `#theBoardCarriesThePeriodItReadsSoTheWebCanPublish` (the board hands over the id), `#theBoardCountsTheShiftsChangedAfterThePublication`, `#aPastWeekIsAlreadyPublishedAndCannotBePublishedAgain` | PASS |
| FR-07 notice check and per-officer "changed" flag after publishing | The board counts the shifts changed after the publication (`publishedState.unpublishedChanges`, from the audit trail) and names the period; there is no P-05/S-01 rule row and no per-officer changed marker | **PARTIAL** — the count is real; the notice rule and the per-officer flag are not built (`docs/10` §8) |
| One open shift is filled once, and one unlock is audited once | `OvertimePayrollConcurrencyApiTest#threeDifferentOfficersCannotFillOneOpenShift`, `#twoAcceptedOffersForOneShiftConfirmOnlyOnce`, `#twoShiftsAndTwoOfficersAssignInParallelWithoutDeadlock`, `#concurrentUnlocksWriteOneAuditRow` (all over HTTP, real threads) | PASS (dev-qa, `c0dcaf3`) |
| The employee roster without a unit filter is scoped | `AuthorizationMatrixTest#theEmployeeListIsScopedWhenNoUnitIsGiven` (ellis A/B, chen ADM/CTL/ESC, auditor all, out-of-scope unit 404) | PASS (dev-qa, `c0dcaf3`) |
| A rules-admin row edit is saved or refused, and a stored bad value is a validation error, not a 500 | `RuleRowEditApiTest#aRawAfterShiftKindEditIsSavedInsteadOfDropped`, `#aFriendlyAfterLabelStillMapsToTheStoredPattern`, `#aHostileAfterShiftKindIsRefusedAndNothingIsSaved`, `#anUnknownParamsKeyIsRefusedNamingIt`, `#aStringInANumericColumnIsRefusedNamingTheColumn`, `#aStringInTheExtensionColumnIsRefusedNamingTheColumn`, `#aStringAllowedLengthsIsRefused`, `#aNullAllowedLengthsIsRefused`, `#aHugeAllowedLengthsListIsRefusedAtTheCap`, `#minRestHoursOutsideTheRangeIsRefused`, `#anUnsafeRuleCodeIsRefusedInPlainWords`, `#aBuildWithAStoredWrongTypeAnswersValidationNotAFiveHundred`, `#aBuildWithAStoredAllowedLengthsStringAnswersValidationNotAFiveHundred`, `#aBuildWithAStoredAllowedLengthsNullAnswersValidationNotAFiveHundred`, `#aBuildRefusesAStoredRestAboveTheCeiling`, `#aBuildDoesNotReturnThousandsOfErrorsForOneHugeList`, `#aBuildCapsTheNumberOfErrorsItReturns` (all over HTTP); `RuleRowValidatorTest` (27 tests: null/empty/string/5/true params roots and the numeric bounds), `RuleRowEditApiTest` (31 @Test: the whole PUT refusal contract, including unknown top-level fields, the after conflict, the numeric ranges and the new-row extension column) | PASS (dev-qa, `c0dcaf3`) |
| A change's `type` and `startAt` are validation problems, not conflicts | `AssignmentInputApiTest#aGarbageChangeTypeIsRefusedNamingTheField`, `#anAbsurdStartYearIsRefusedNamingTheField`, `#aValidPreviewIsStillAccepted` | PASS (dev-qa, `c0dcaf3`) |
| A missing JWT secret answers the actionable message, not a raw placeholder | `JwtServiceTest#aMissingSecretExplainsWhatToDo`, `#aShortSecretExplainsWhatToDo`; `StartupSecretsTest` | PASS (dev-qa, `c0dcaf3`) |
| Every error body is RFC 9457 problem+json, a database conflict is a 409 rather than a 500, and every hidden cause is logged server-side under the trace id the caller gets | `ConstraintProblemApiTest#anOverlappingEmergencyOverrideAnswersAConflictAndSavesNothing`, `#movingAShiftOntoAnotherOneAnswersAConflict`, `#anOvertimeConfirmThatWouldOverlapIsRefusedBeforeTheDatabaseIsAsked` (all over HTTP and pinning the WARN line); `ApiProblemAdviceTest#theExclusionConstraintNamesTheConflictWithoutTheSql`, `#aUniqueConstraintBecomesA409Problem`, `#aNumericOverflowIsABadRequestNotAServerError`, `#aCheckConstraintStaysAConflict`; `UnexpectedFailureApiTest#anUnexpectedFailureAnswersAProblemDocumentWithoutInternals` (body traceId matches the ERROR log), `#springWebFailuresKeepTheirOwnStatus`, `#aRoleRefusalKeepsItsStatusAndGetsAProblemBody`; `RuleSetServiceCompileFailureTest#aCompileFailureIsLoggedWithItsDetailAndRefusedInPlainWords`; `PublishedRuleSetBootTest#aDirectEditToAPublishedRowRefusesToStartAndNamesTheProblem`, `#aPublishedRowThatCannotBeReadRefusesToStartInsteadOfServingV1`; `ProblemDetailsApiTest` (404 and 400 over HTTP) | PASS |
| FR-20–23 open shift, eligible list, offers, direct assign | `OvertimeApiTest#creatingAnOpenShiftIsSupervisorOnlyAndAudited`, `#theRankedListIsFewestOvertimeThenSeniority`, `#offerAcceptAndConfirmCreateTheAssignment`, `#directAssignRunsTheRulesAndFillsTheShift`, `#anEmployeeCannotSendOrConfirmOffers` | PASS |
| FR-50–54 actuals, pay codes, lock, payroll CSV | `PayrollApiTest` (13 tests); `PayrollExportGoldenTest`; `CsvTest` | PASS |
| FR-60–62/64 hours, overtime, coverage reports and CSV | `ReportsApiTest#coverageHoursReconcileWithTheAssignmentsHourByHour`, `#hoursAndOvertimeReconcileWithTheTimeEntriesAndThePayrollExport`, `#csvExportsUseTheDocumentedHeaders`, `#m4DisplayIsDeniedEveryReport` | PASS |
| FR-70/71/75/76 decision tables, versions, maker/checker, scenarios before publish | `RuleSetApiTest`; `RuleRowValidatorTest`; `RuleScenarioRunnerTest` | PASS |
| FR-73 append-only audit | `AuditApiTest` (5 tests); `SchemaConstraintsTest#auditEventsCannotBeUpdatedOrDeleted`; payroll/override audit assertions | PASS |
| FR-80/81/83/84 100 officers × 90 days, actuals before today, planted cases, fictional footer | `DemoDataGeneratorTest`; `AppShell.test.tsx#shows the required footer disclaimer on every screen` | PASS (fictionality is generator design, not proven by test) |
| The demo's roster weeks are publishable (docs/10 §6.1) | `DemoDataGeneratorTest#seedsTheRosterWeeksEveryUnitCanPublish` (84 periods: one Monday-to-Sunday week per unit, past weeks published, current and later weeks drafts, every shift in its period), `#aMissingSchedulePeriodFailsTheSelfCheck`; `SchedulePeriodSeedApiTest#everyUnitHasARosterWeekForTheWindowAndOnlyThePastOnesArePublished` | PASS |
| NFR-01 three containers, no paid services | `docker-compose.yml`; README §4 | PROCESS (no automated compose test) |
| NFR-02 responsive desktop/tablet/TV | Playwright projects `desktop`/`tablet`; `e5-wall-display.spec.ts#fits a 1920×1080 TV and a 1366×768 screen without scrolling` | PASS |
| NFR-03/04 consistent, accessible UI | `expectAccessible` in every e2e spec; web component tests; `keyboard.spec.ts` | PASS |
| NFR-05 board < 1 s, rule check < 200 ms, 90-day report < 2 s | `PerformanceSmokeTest#nfr05TheHeavyScreensMeetTheirLimits` (28-day board, stricter) | PASS |
| NFR-06 deterministic, boundary-tested rules engine | Rule boundary classes; `RuleScenarioRunnerTest`; `ReferenceDataMatchesRuleRowsTest` | PASS |
| NFR-07 no secrets in repo | `StartupSecretsTest`; `.env.example` | PASS |
| NFR-08 synthetic data labelled in the footer | `AppShell.test.tsx`; `PlanningPage.test.tsx`; `WallDisplayPage.test.tsx`; `e2e/support.ts#expectDisclaimer` | PASS |
| NFR-09 OpenAPI / Swagger UI | None found in code or dependencies; `docs/07` §1 promises `/api/v1/openapi.json` and Swagger UI | **NOT COVERED** |
| NFR-10 API-enforced authorization | `AuthorizationMatrixTest` (9 methods); per-endpoint authz cells in `AssignmentApiTest`, `AssignmentMoveCancelApiTest`, `PayrollApiTest#authorizationAndScopeCells`, `ReportsApiTest#authorizationAndScopeCells`, `AuditApiTest#onlyTheAuditorAndSupervisorsMayReadTheTrail` | PASS |

## 7. Where the documents overstate the proof (found by this derivation)

1. **Scenario library format.** `docs/10` §2 and `HANDOFF.md` §7 say the scenarios are data files in
   `src/test/resources/scenarios/*.json` and that T1–T13 run in the publish pipeline. No such
   directory exists. `RuleScenarioRunner` holds T1–T5 and the T6 ranking check in Java; the build
   pipeline runs exactly those (`RuleSetService` step 3). T7–T14 are API/DB tests. `ai-dev-log` 43
   already described this correctly; the test-strategy header did not.
2. **U-15 boundary (fixed after this derivation).** The planning board computes UNDER/APPROACHING/IN_OVERTIME; this derivation first found only UNDER asserted. `ScheduleApiTest` now pins 71.99 h, 72 h, 79.99 h, 80 h and 80.01 h plus the last-day/midnight-crossing period edge, and the rule row above is PASS.
3. **FR-07 notice/changed flag.** Not built. Only `publishedState.unpublishedChanges` (a count) is
   returned; there is no P-05/S-01 row and no per-officer "changed since published" marker. It is now listed in `docs/10` §8.
4. **NFR-09 OpenAPI.** `docs/07` §1 promises a generated OpenAPI document and Swagger UI. No
   springdoc dependency, controller or endpoint exists. It is now listed in `docs/10` §8.
5. **ADR-015 shift-time editing.** Start times are seeded in `V2`; the rules screen's
   `/rules/{version}/shift-types` route resolves to the SHIFT_LENGTHS table (`RuleSetService`), not
   a shift-template editor. FR-02's "configurable" is therefore seed-level only, not an admin flow. It is now listed in `docs/10` §8.
6. **`docs/10` §2 performance layer** says "E2E timing + a JUnit timing test". Only the JUnit
   `PerformanceSmokeTest` measures timings; no Playwright test asserts a time budget.
7. **`docs/10` §2 authorization layer** says "one test per denied/scoped cell". The matrix is
   asserted, but grouped into nine area methods plus per-endpoint authz tests, not one method per
   cell. The coverage is real; the phrasing is stronger than the structure.
8. **T2's U-14 detail.** The real-api E1 test accepts "Blocked: 2 or 3 rules" and asserts U-01; the
   comment says U-14 also fires, but no assertion names U-14. `AssignmentApiTest` asserts U-01 only.
