# Deterministic evidence fusion

`fuseProductEvidence` is a synchronous, offline adjudication primitive exported
from `fusion.ts`. It makes no provider, Gemini, model, network or image-download
calls. `fuseEvidence(SemanticVisionSignal)` remains the legacy Gemini-only policy;
the existing live `/api/identify` path still uses that policy. **This milestone
does not fix the running application until orchestration supplies independent
evidence to the new primitive.** Mock mode is unchanged.

## Input

`FusionInput` in `evidence-contracts.ts` accepts:

| Field               | Meaning                                                                                                           |
| ------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `imageCount`        | Number of submitted views; image references are 1-based within this request.                                      |
| `ocr`               | Python `ocr.v1` JSON. Local readers validate used fields, spans and image references, retaining extra provenance. |
| `search`            | Existing `ProductSearchResult`, validated using Search's public schema.                                           |
| `associations`      | Optional supplied findings; omitted derives conservative Search findings; `[]` explicitly opts out.               |
| `retrieval`         | Python `retrieval.v1` JSON after retrieval has run. Candidate IDs and supplied source URLs must link to Search.   |
| `visualAssessments` | Optional inspection findings linked to a candidate/image comparison: compatible, concern or contradiction.        |
| `semantic`          | Optional existing `SemanticVisionSignal`. Gemini is never required.                                               |

Search candidate IDs identify **source groups**, not canonical products.
An `ExternalAssociation` separates source text from interpretation, specifying
the subject identity, typed identifiers, relation, basis and optional shared
upstream `originGroup`. `product_identity` means the source associates these
identifiers with its subject product. `compatible_with` and `unresolved` cannot
confirm. The adapter validates literal source grounding and defensively rejects
compatibility wording, but **cannot establish the truth of a supplied review
finding**. Do not populate it automatically from `matchSignals`, Search query
echoes, `modelNumbersSeen`, ranking or literal occurrence alone.

`deriveSearchAssociations(search)` now bridges the existing Search result to
`ExternalAssociation[]`, using only returned observations. `adaptEvidence`
invokes it when `associations` is omitted. Explicit supplied findings (including
an empty array) retain caller control. No provider or page crawler was added.

The deliberately narrow positive rule requires:

- A source brand clue appearing as the exact title prefix (case/whitespace
  insensitive), followed by a descriptive product name. Query brand/product
  values and the candidate's representative title never supply missing identity.
- A Search `literal` typed observation in that observation's title field,
  rechecked with the public identifier comparator using its query value and case
  policy. The literal observed spelling must end the title, optionally enclosed
  in parentheses/brackets. Snippet-only and normalized/extension matches do not
  qualify. SKU and part numbers additionally require an explicit matching title
  label; an unlabeled suffix is accepted only for model-number observations.
- No guarded subject ambiguity in title or snippet: relationship/negation terms
  such as `for`, `compatible`, `fits`, `not`, or `replacement`; a few accessory
  nouns (`case`, `cover`, `dock`); or review/comparison wording. This small guard
  deliberately rejects some genuine listings, including unrelated compatibility
  statements, rather than attempting general language understanding.
- No source-group disagreement. Different titles/snippets, known brand/variant clues or
  nonliteral agreement between same-kind observed identifiers suppress the whole
  group. Guarded ambiguity in any observation of a multi-observation group also
  blocks the group. Case/whitespace differences are tolerated, but name aliases
  and differently worded snippets are not merged. Fusion records `source_group_identity_conflict` with all group
  observation references, even when no positive association survives.

An accepted finding retains the exact product-name prefix and identifier spelling,
typed kind/case policy, candidate ID, observation index and an explanatory basis.
The existing source reference retains URL/domain, title/snippet, provider/engine,
query/request, timestamp and observations; provenance is dereferenced rather
than duplicated into a new public contract. Variant clues require a literal
whitespace-delimited occurrence in the returned text. Rank, similarity, duplicate
count, source authority scores and untyped token guesses are unused.

Search evidence is sufficient for this restricted direct-listing pattern, **not
for arbitrary subject association**. A bare identifier mention, missing source
brand/name, identifier buried in prose, or an ambiguous/misleading title remains
unresolved. Source text is assumed to describe its subject honestly; this producer
does not verify a destination page or detect every accessory synonym. The offline
tests use synthetic provider responses normalized by the real Search module;
they establish local rule behavior, not live source accuracy.

Likewise, native cosine scores are preserved, not thresholded into visual findings
or status. A `VisualAssessment` requires a separate, explained inspection or
validated mismatch policy. No such automated policy is introduced here. Raw
retrieval with no assessment is recorded as unassessed compatibility evidence;
it neither establishes identity nor fabricates a contradiction.

Invalid schemas, image references, OCR spans, candidate links or source grounding
throw rather than disappearing or becoming demo results. Integration must map
these failures through the existing application error envelope. Search provider
run records and partial/failure states remain in provenance; empty output does
not assert provider success. Absent OCR/retrieval is absence, not successful
inference. Future orchestration owns their error handling.

## Output and rules

`FusionResult` contains the existing `confirmed | likely | uncertain` status,
an identity (tentative unless confirmed), supporting reference IDs, conflicting
reference IDs with materiality and reason codes, all provenance, and structured
`needsMoreEvidence`, `missingEvidenceType`, `followUpReason`, `followUpOwner`.
Identity includes brand, product name, model, SKU, part number and variant;
serial numbers stay in provenance and never identify a product. No probability
or weighted confidence is returned.

Confirmation requires all of:

1. A span-grounded, explicitly labeled physical model/SKU/part number. Spatial
   label inference and generic text are retained but cannot confirm.
2. A supported external **subject-product** association with a literal identifier
   agreeing exactly in kind and value. Search's public `identifierObservations`
   supplies comparison semantics: models default to case insensitive, SKU/part
   numbers to case sensitive; the stricter declared case policy prevails.
   Separator-folded agreement and suffix extensions never become exact proof.
3. One supported identity, with no unresolved material contradiction between
   physical labels, external identifiers, brands, variants or source observations.
4. No material visual contradiction or outstanding visual concern. Visual
   comparison is optional; an unassessed cosine score has no status threshold.

A weak visual concern retains identifier support and caps the result at likely;
a material contradiction produces uncertain. Strong visual compatibility cannot
override conflicting exact identifiers. Conflicting observations in a Search
group survive even when an association cites only one observation. The current
conservative rule lets material conflicts block confirmation across supplied
associations; callers should supply relevant findings, not manufacture findings
for every search hit.

Differing typed identifier occurrences without reviewed product association are
preserved as nonmaterial `unresolved_external_identifier_disagreement` concerns.
They are not proof of a conflicting product identity. Reviewed associations and
disagreements inside their source groups receive the material checks above.

OCR alone, Search alone, visual retrieval alone, and Gemini plus OCR of the same
label cannot confirm through this primitive. A single provisional family/name
can be likely; multiple supported identities or materially conflicting evidence
are uncertain. Equal normalized display identities and identical typed claims
can coalesce across source groups. Different aliases/claim sets remain ambiguous;
there is no canonical-product ontology or top-ranked winner.

OCR and Gemini observations on image N share `physical:N`. Search references
retain URLs, query/request/provider references, text and timestamps. Same-host
observations share a conservative observation group; `originGroup` can additionally
link known syndicated sources. There is **no source-count voting**, so duplicated
results cannot strengthen a decision. Unknown syndication is not detected.
Retrieval preserves query indexes, candidate image URL/ID, native metric/scores,
checkpoint/revision/preprocessing and the explanation of any assessment. Its
comparison evidence cannot act as another exact-identifier confirmation.

Gemini's original status is ignored in the new primitive. Its family hypothesis
can supply a provisional name, but model guesses cannot supply physical identity.
An explicitly grounded conflicting Gemini transcription or `conflictingImages`
is preserved as a conflict; agreement on the same photo adds no independent vote.

## Follow-up and application projection

| Missing evidence       | Owner          | Photo request                                                           |
| ---------------------- | -------------- | ----------------------------------------------------------------------- |
| `physical_identifier`  | User           | Clear model/SKU/part-number label, only when no strong label is present |
| `external_association` | Product Search | None: the physical label is already available                           |
| `distinguishing_view`  | User           | Angle showing distinguishing physical features                          |
| `conflict_resolution`  | Fusion         | None automatically; reconcile conflicting references first              |
| None (confirmed)       | None           | None                                                                    |

`suggestedFusionImage` maps these structured decisions to presentation text.
`toProductIdentification(result, input)` validates a backwards-compatible
projection through the unchanged shared schema. It clears stale Gemini follow-up
instructions, preserves available transcriptions/features, and never invents
missing fields. Part numbers, detailed findings and source groups stay in
`FusionResult`: the public type has no part-number field. Public `candidates`
remain empty because source groups are not safely selectable canonical identities.
UI/API exposure of those findings is a later coordinated change.

CFI-ZCT1W and CFI-ZCT2W each confirm when their physical observation and independent
subject-product association agree, with visual compatibility or no comparison.
Both return `needsMoreEvidence: false` and no further label-photo request.
The implementation contains no Sony, DualSense or model-specific rule.
An accessory title such as “Case compatible with … CFI-ZCT1W” remains unresolved,
even if incorrectly supplied as `product_identity`; its literal occurrence is
never sufficient confirmation.

## Remaining runtime integration, in order

1. **Fusion + OCR + Visual Retrieval maintainers:** agree the versioned inference
   HTTP/client boundary, ordered request images, deployment/authentication,
   readiness, timeout and error mapping. `vision-service/app/main.py` currently
   exposes only `/health`; its local OCR/retrieval modules have no HTTP endpoints.
   Before wiring, add shared Python/TypeScript contract fixtures for both versions.
   The present test reads the existing Python OCR fixture, with no model loading.
2. **Product Search:** supply existing normalized results to Fusion. Direct
   subject-title association is now implemented offline; richer ambiguous
   association still requires reviewed findings. Existing
   `src/lib/products/verification.ts` remains unimplemented; this producer does
   not replace runtime candidate verification or destination-page validation.
3. **Product Search + Visual Retrieval:** provide a bounded external-image
   acquisition boundary: Search candidate ID/image URL -> safe fetched bytes ->
   `CandidateImage` -> SigLIP. Preserve the candidate ID/image ID/source URL and
   submitted query indexes. Fetching requires URL/DNS/redirect safety, byte limits,
   MIME validation and timeouts. No downloader, hosting or SSRF layer is included.
   Agree explained visual assessments separately; raw scores remain raw scores.
4. **Fusion maintainers:** orchestrate public interfaces in
   `src/lib/services/analysis.ts`, call `fuseProductEvidence`, then project the
   result for `/api/identify`. Exact independent evidence should run without
   Gemini; use Gemini optionally for ambiguity/reconciliation. Preserve explicit
   mock mode and existing errors. Keep detailed Fusion findings available for a
   future coordinated response/UI extension, especially non-photo follow-ups.

Assumptions: explicit OCR labels refer to the photographed object; OCR's
`label_role: unknown` is preserved and never relabeled as manufacturer-verified.
Association findings come from a qualifying external subject title or a genuine
independent source review. Candidate
image bytes are faithfully linked by the acquisition caller. Conservative brand
comparison has no corporate-name aliases; source identities have no name aliases.
These limitations can produce uncertainty rather than unsafe automatic merging.

## Validation

`npx vitest run tests/search-associations.test.ts tests/fusion.test.ts` covers
direct subject association, both controller models and an unrelated synthetic
product, accessory/compatibility/negation, physical and source-group conflicts,
normalized-only matches, provenance and the original Fusion regressions.
Tests are offline: no Gemini, external APIs, Python inference or model downloads.
Run the repository tests, typecheck, lint, format check and `git diff --check`
alongside them. Python modules/dependencies and public API/provider schemas are
unchanged. The existing association finding shape is unchanged. The additive
Fusion export is `deriveSearchAssociations`; omitted `FusionInput.associations`
now derives findings, while explicit arrays preserve caller control. Search's
identifier matching semantics are unchanged.
