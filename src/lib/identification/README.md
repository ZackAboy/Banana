# Deterministic product identification

Live `/api/identify` uses ordered uploaded photos → parallel local PaddleOCR and
SerpApi Lens discovery → text Product Search → deterministic Fusion → the existing
`ProductIdentification`. Gemini is an optional semantic fallback, skipped when
Fusion confirms. Mock mode remains offline and deterministic. SigLIP runtime,
embeddings, catalog infrastructure, reviews and price shopping are deferred.

## General products and precision

`identityResolution` is optional additive API metadata. It contains:

- `granularity`: `product_family`, `variant`, `exact_model`, or null when unnamed.
- `productFamily`: the supported broader name.
- `unresolvedFields`: variant, size or identifiers still needing evidence.
- `evidence`: source, physical/external observation group, ordered image indexes,
  source URL and observed text. Full findings remain in internal `FusionResult`.

Status applies to the returned precision. A confirmed family with an unresolved
variant, or a confirmed variant with unresolved size, is valid. Downstream work
must inspect granularity/unresolved fields before making exact offer/review matches.
`modelNumber`/`sku` stay null on semantic confirmation; an observed but unassociated
identifier remains in OCR provenance and unresolved fields, not exact identity.
Legacy/demo results may omit the metadata. Gemini cannot author this metadata.

`semantic-products.ts` conservatively joins physical product wording to external
subject titles. It normalizes casing, whitespace and punctuation using whole,
ordered phrases, including at most three adjacent OCR regions. It never uses
fuzzy distance, query echoes, model confidence, result rank or source-count votes.
A product-name phrase, or separately grounded branding plus a wordmark, supplies a
family anchor. Additional physically observed wording can resolve a variant.
Source-declared/Gemini variants split a full name only when physically transcribed.
Unobserved source tails cannot create exact variants. Size/package suffixes remain
unresolved rather than blocking identity. Different variants preserve the shared
family; different physically grounded families remain a material conflict.
These lexical rules deliberately miss aliases, reordered titles and obscured text.

Gemini interpretation alone supplies a tentative family. Indexed transcribed
packaging/label text can ground a broad identity with independent external evidence
when OCR misses it, but cannot manufacture exact identifiers. OCR and Gemini of
image N share `physical:N`; repeated processing is never another independent vote.
Lens titles/URLs/images retain their provider and image provenance. Lens alone
cannot confirm or populate model/SKU fields. Exact association derivation excludes
Lens hypotheses; Lens wording does not independently veto a textual association.
A physically grounded product-family conflict still vetoes exact confirmation.

See [runtime setup and bounded smoke tests](RUNTIME.md) for configuration,
degradation and transport. Existing exact-identifier rules follow below.

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

- A brand actually grounded in the source and appearing as a whole title prefix:
  provider metadata, a labeled `Brand` field, or literal leading source-title
  words related to the query brand/manufacturer clue. The query is only a spelling
  hint; it cannot supply a brand absent from source text. A descriptive product
  name must follow. Candidate representative titles never replace observations.
- A Search `literal` typed title observation, rechecked with Search's public
  identifier comparator. The observed identifier must end the title (optional
  parentheses/brackets). Bare suffixes establish model roles only; SKU/part
  numbers require explicit matching labels. Normalized/extension matches do not
  qualify and original spelling is preserved.
- Alternatively, a strongly labeled specification snippet may qualify: `Brand`,
  a descriptive `Product`/`Product Name`/`Model` matching the whole subject title,
  and an explicit identifier field matching both the literal value and typed
  kind. Fields must be delimited by semicolons/newlines and use colon/comma label
  separators. Conflicting repeated fields are rejected. `MPN`/`P/N`/`Part Number`
  are part numbers, **not model numbers**; arbitrary snippet mentions do not qualify.
- The title must pass the small accessory/relationship/negation/comparison/support
  guard. Snippet guards target the particular identifier's relationship: e.g.
  “works with”, “case for”, or “not compatible with” still veto, while commerce
  boilerplate such as “get the best deals for” does not poison a strong title.
- No source-group disagreement. Different titles/snippets, known brand/variant
  clues or nonliteral agreement between same-kind observed identifiers suppress
  the group. Different product names across accepted associations remain ambiguous.

Manufacturer/brand comparison is bounded lexical normalization, not ownership
verification. Exact case/whitespace agreement always qualifies. Only a physical
**manufacturer** clue may lose an anchored legal suffix (`Inc.`, `Ltd.`, `LLC`,
`Corp.`, etc.). A shorter external brand must be the complete leading name with
at least four letters, followed only by one or two generic corporate descriptors
(`electronics`, `interactive`, `entertainment`, `technology`, `technologies`,
`products`, `systems`). Middle/shared tokens, arbitrary remaining words, descriptor-only
brands and suffix-free aliases fail. Explicit physical **brand** clues still require
exact agreement. Raw values/kinds remain in provenance; related names add
`manufacturer_brand_name_relationship` to the explanation.

`inspectSearchAssociations` reports rejection codes from the same policy; the
bounded development logger shows provider/request outcomes and association
acceptance without dumping raw payloads or credentials. Actual failed/partial
Search runs remain `search_incomplete_or_unavailable` plus runtime notices and
provenance. They do not veto otherwise established exact identity. Intentional
optional skips remain in provenance without being described as failures.

These conservative rules intentionally have false negatives. Fixtures normalized
by the real Search module validate local policy, not destination-page accuracy.

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

Exact model/SKU confirmation requires all of:

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
label cannot confirm without independent external evidence. A single provisional family/name can be likely. Semantic agreement can confirm
a family/variant; conflicting exact identities or product families remain uncertain. Equal normalized display identities and identical typed claims
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

Gemini's original status is ignored in the new primitive. Its family hypothesis can supply a provisional name, but model guesses cannot
supply physical identifiers.
An explicitly grounded conflicting Gemini transcription or `conflictingImages`
is preserved as a conflict; agreement on the same photo adds no independent vote.

## Follow-up and application projection

| Missing evidence       | Owner          | Photo request                                                               |
| ---------------------- | -------------- | --------------------------------------------------------------------------- |
| `physical_identifier`  | User           | Clear model/SKU label only for an actually transcribed identifier ambiguity |
| `external_association` | Product Search | None: the physical label is already available                               |
| `distinguishing_view`  | User           | Clear front/side branding and product/variant wording                       |
| `conflict_resolution`  | Fusion         | None automatically; reconcile conflicting references first                  |
| None (confirmed)       | None           | None                                                                        |

`suggestedFusionImage` maps these structured decisions to presentation text.
`toProductIdentification(result, input)` validates a backwards-compatible
projection through the additively extended shared schema. It clears stale Gemini follow-up
instructions, preserves available transcriptions/features, and never invents
missing fields. Part numbers, detailed findings and source groups stay in
`FusionResult`: the public type has no part-number field. Public `candidates`
remain empty because source groups are not safely selectable canonical identities.
The additive resolution metadata exposes supporting observations and precision.
Full conflict references and part numbers remain internal.

CFI-ZCT1W and CFI-ZCT2W each confirm when their physical observation and independent
subject-product association agree, with visual compatibility or no comparison.
Both return `needsMoreEvidence: false` and no further label-photo request.
The implementation contains no Sony, DualSense or model-specific rule.
An accessory title such as “Case compatible with … CFI-ZCT1W” remains unresolved,
even if incorrectly supplied as `product_identity`; its literal occurrence is
never sufficient confirmation.

## Remaining runtime integration, in order

1. **Fusion + OCR maintainers:** deploy/provision the local CLI environment and
   cached weights; the runtime bridge requires the source checkout and a Node
   host with subprocess/filesystem support. No HTTP inference server is needed.
2. **Product Search:** richer ambiguous subject association still requires
   reviewed findings. Candidate verification and destination-page validation
   remain separate work; strict direct-title rules intentionally miss listings.
3. **Product Search + Visual Retrieval:** Search candidate ID/image URL → safe
   bounded fetched bytes → SigLIP remains deferred. Agree URL/DNS/redirect safety,
   MIME/byte/time limits and explained visual assessments before runtime wiring.
   No downloader, hosting, raw-score threshold or SigLIP runtime is included.
4. **Fusion maintainers:** expose detailed Fusion provenance/part numbers through
   a coordinated additive API/UI contract only when needed; runtime now
   projects resolution/supporting observations and safe notices.

Assumptions: explicit OCR labels refer to the photographed object; OCR's
`label_role: unknown` is preserved and never relabeled as manufacturer-verified.
Association findings come from a qualifying external subject title or a genuine
independent source review. Candidate
image bytes are faithfully linked by the acquisition caller. Manufacturer/brand
comparison uses only the bounded lexical relationship above; source identities
have no product-name aliases.
These limitations can produce uncertainty rather than unsafe automatic merging.

## Validation

Run `npm run check` and `git diff --check`. The canonical suite is offline and
includes existing Product Search/association/Fusion regressions plus general
product, granularity, conflict, tailored follow-up, bounded image preparation,
mock HTTP upload/partial Lens results and runtime fallback coverage. No live API,
Python inference or model download occurs. Manual smoke cases are opt-in in the
runtime guide. Python modules and exact identifier comparison are unchanged.
