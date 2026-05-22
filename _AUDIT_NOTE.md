# Audit Note — AIRadiologyReportGenerator

## Original audit recommendations (batch_07.md §9)

**Missing AI endpoints:** `/prior-comparison`, `/protocol-compliance-audit`, `/incidental-finding-flag`, `/radiation-dose-tracking`.

**Missing non-AI features:** PACS integration, HL7/FHIR EHR messaging, worklist management, QA workflow, peer review/second-read.

**Custom suggestions:** multi-modality intelligent routing, collaborative annotation, prior study intelligence, reporting template recommender, QA automation, patient-facing summary generator.

## Implemented this pass (3 mechanical)
1. `POST /api/ai/prior-comparison` — longitudinal comparison of a patient's current vs all prior reports, trajectory & next-interval recommendation. Added in `server/routes/ai.js`.
2. `POST /api/ai/protocol-compliance-audit` — JSON audit of a study protocol against ACR/institutional standards.
3. `POST /api/ai/incidental-finding-flag` — extracts incidental findings with follow-up urgency and Fleischner/ACR-style references.

All three follow the existing pattern (auth + aiRateLimiter, deidentify(), runAI helper), reuse `ai_analyses` history persistence. Syntax-checked.

## Backlog (prioritized)
1. `POST /api/ai/radiation-dose-tracking` — cumulative exposure per patient (mechanical; needs dose schema decision).
2. PACS integration (NEEDS-CREDS, large engineering).
3. HL7/FHIR EHR messaging (NEEDS-CREDS).
4. Worklist routing & QA workflow (NEEDS-PRODUCT-DECISION).
5. Patient-facing plain-language summary (mechanical follow-up).
6. Reporting template recommender (mechanical follow-up).

## Apply pass 3 (frontend)

- **Action:** LEFT-AS-IS
- **Stack:** Express server + CRA client (`client/src/api.js` axios with JWT Bearer from `localStorage`).
- **Backend endpoints checked:** Pass-2 additions `/api/ai/prior-comparison`, `/api/ai/protocol-compliance-audit`, `/api/ai/incidental-finding-flag`.
- **Frontend wiring:** `client/src/App.js` registers dedicated routes mapping to `AIPriorComparison.js`, `AIProtocolComplianceAudit.js`, `AIIncidentalFindingFlag.js`; each calls the matching endpoint via the shared `API` axios client.
- **No FE files modified.** Idempotence rule applied.
- See `_AUDIT/apply3_logs/ab3_60.md` for batch detail.

## Apply pass 6 (close-out)
- Implemented: `POST /api/ai/patient-friendly-summary` (canonical schema: `{ summary, key_findings_plain, recommended_followups_plain, glossary }`), `POST /api/ai/reporting-template-recommend` (canonical schema: `{ recommended_template_name, sections[{heading,prompts,required_fields}], rationale, alternatives }`)
- Files touched: `server/routes/ai.js`
- Syntax check: PASS
- Duplicate-endpoint note: An earlier undocumented pass already registered `/patient-friendly-summary` (line ~858) and `/reporting-template-recommender` (line ~886, `-er` suffix) with different request/response shapes. Per instructions the canonical versions were appended at the bottom of `ai.js`. Because Express resolves the first registered handler for a given method+path, the canonical `/patient-friendly-summary` is shadowed by the earlier registration; the canonical `/reporting-template-recommend` (no `-er`) is a distinct path and is fully reachable. Recommend a follow-up consolidation pass to remove or rename the legacy `/patient-friendly-summary` and `/reporting-template-recommender` so the canonical schemas are served.
- Backlog remaining: NEEDS-CREDS (PACS, HL7/FHIR), NEEDS-PRODUCT-DECISION (worklist routing, QA workflow), MECHANICAL (radiation-dose-tracking — needs dose schema decision)
