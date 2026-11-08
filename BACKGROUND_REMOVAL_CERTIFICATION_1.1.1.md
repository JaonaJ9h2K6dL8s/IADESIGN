# AI Design Studio 1.1.1 — Background Removal Certification

**Decision: NOT CERTIFIED FOR COMMERCIAL DISTRIBUTION**  
**Evaluation scope:** local BiRefNet Lite and MODNet segmentation, real-photo mask comparison, and the persisted editable-mask workflow.  
**Evidence date:** 2026-11-06.

This report records the tests and limits evidenced in the repository. A successful UI workflow is not evidence of universally accurate cutouts or commercial print quality.

## Executive result

- BiRefNet Lite outperformed MODNet on the tested general-object and transparent-460 datasets, but quality varied substantially by subject.
- The Open Images V5 evaluation has 14 paired photos across seven represented groups, only two per group. Shoes, jars, transparent containers, and reflective objects are not adequately represented. The “shoes-accessories” images are handbags, not shoes.
- A separate 10-image Transparent-460 test was run. Its license is **non-commercial research use only**; it is not suitable as commercial-use evidence or for redistribution.
- The browser workflow passed for two real photographs using BiRefNet Lite: batch import/cutout, exact source preservation, transparent PNG dimensions, editable mask persistence, undo/redo, save/reopen, brush/eraser refinement and undo/redo, applying the mask, and restoring originals.
- Aggregate quality, weak categories, missing category coverage, and unmeasured memory/hardware behavior keep certification withheld.

## Dataset and provenance

### Open Images paired-photo subset

The reproducible selection is recorded in `artifacts/background-removal-certification/real-photo-evaluation/manifest.json`. It identifies Open Images V5 validation object-segmentation annotations, deterministic FNV-1a selection, image IDs, source/landing pages, authors, titles, individual CC BY 2.0 image licenses, and CC BY 4.0 annotation licensing. Attribution records remain with the manifest. The subset contains 14 source images and reference masks:

| Group in manifest | Images | Qualification |
|---|---:|---|
| Bottles | 2 | Bottle labels |
| Mugs/tumblers | 2 | Mug labels; not a broad tumbler sample |
| Clothing | 2 | Clothing labels |
| Shoes/accessories | 2 | Both labels are Handbag; footwear is untested |
| Packaging/boxes | 2 | Box labels |
| Hair/portraits | 2 | Person segmentation labels; not dedicated fine-hair mattes |
| Complex backgrounds | 2 | One Person and one Bottle label |
| Jars/containers | 0 | Not available in the selected subset |
| Transparent objects | 0 | Not available in the selected subset |
| Reflective objects | 0 | Not available in the selected subset |

The manifest records source links and the applicable licenses per image. Distribution or reuse must retain the required attribution and comply with the individual image and annotation terms.

### Transparent-object evaluation

The separate `transparent-460` official test split contains 10 paired image/alpha samples. Its dataset manifest states non-commercial research use only, prohibits public redistribution, and limits use to one organization. Results below are internal research evidence only; these files must not be redistributed or included in a commercial product release. The dataset is not a substitute for a glass-container/reflective-object benchmark with a documented commercial-use license.

## Method

- BiRefNet Lite and MODNet were run locally in the browser worker on the same 14 Open Images photographs; each output was compared with its paired reference mask.
- Metrics were calculated after resizing masks to 512 × 512. Boundary F1 uses symmetric boundaries with a two-pixel tolerance. Small samples and annotation differences make these indicative, not universal estimates.
- Latency is browser wall-clock time around local inference. The first image for each model includes model initialization; warm timings follow. These timings are specific to the test workstation/session and are not a Windows-wide performance guarantee.
- Peak process RAM, WASM memory, GPU use, and CPU/GPU fallback were **not measured**. No acceleration claim is made.
- Transparent-460 used the same metric and timing method but is reported separately because of its restrictive license and different sample population.

## Model comparison — Open Images subset (n = 14 each)

| Model | Successful / attempted | Mean IoU | Mean Dice | Mean boundary F1 | Cold start | Warm median / p95 |
|---|---:|---:|---:|---:|---:|---:|
| BiRefNet Lite | 14 / 14 | 0.5413 | 0.6487 | 0.4960 | 58.97 s | 14.51 s / 15.42 s |
| MODNet | 14 / 14 | 0.1695 | 0.2281 | 0.1758 | 7.52 s | 2.26 s / 2.53 s |

### Category metrics — Open Images subset (two images per group)

| Group | BiRefNet Lite IoU / Dice / Boundary F1 | MODNet IoU / Dice / Boundary F1 | Disposition |
|---|---:|---:|---|
| Bottles | 0.728 / 0.819 / 0.800 | 0.326 / 0.492 / 0.305 | **PARTIAL** — promising on these two opaque bottle samples; no glass/transparent bottle coverage |
| Mugs/tumblers | 0.468 / 0.630 / 0.482 | 0.022 / 0.043 / 0.032 | **PARTIAL** — BiRefNet is materially better; quality is not consistently production-ready |
| Clothing | 0.522 / 0.625 / 0.263 | 0.347 / 0.416 / 0.240 | **PARTIAL** — low boundary scores leave edge quality unresolved |
| Handbags (manifest group “shoes/accessories”) | 0.924 / 0.961 / 0.868 | 0.375 / 0.433 / 0.306 | **PARTIAL** for handbags only, n=2; shoes remain **NOT TESTED** |
| Packaging/boxes | 0.401 / 0.466 / 0.278 | 0.026 / 0.049 / 0.113 | **FAIL** for reliable production use on this evidence |
| Hair/portraits | 0.208 / 0.343 / 0.341 | 0.051 / 0.092 / 0.095 | **FAIL** for quality certification; fine-hair preservation is not established |
| Complex backgrounds | 0.538 / 0.698 / 0.440 | 0.039 / 0.072 / 0.139 | **PARTIAL** — useful improvement over MODNet, but insufficient evidence for robust handling |
| Jars/containers | — | — | **NOT TESTED** |
| Transparent objects | — | — | **NOT TESTED** in this set |
| Reflective objects | — | — | **NOT TESTED** |

BiRefNet Lite has better mean metrics in every represented group, but that does not make it universally reliable. MODNet is faster in these runs but its overall and non-portrait-category mask scores are poor; its portrait-oriented name must not be interpreted as a demonstrated advantage on this dataset.

## Transparent-460 results (n = 10 each; restricted license)

| Model | Successful / attempted | Mean IoU | Mean Dice | Mean boundary F1 | Cold start | Warm median / p95 |
|---|---:|---:|---:|---:|---:|---:|
| BiRefNet Lite | 10 / 10 | 0.3336 | 0.4037 | 0.2486 | 72.37 s | 15.58 s / 23.81 s |
| MODNet | 10 / 10 | 0.1537 | 0.2367 | 0.1873 | 17.23 s | 3.86 s / 4.37 s |

**Disposition: FAIL** for transparent-object commercial certification. BiRefNet Lite is better on mean IoU and Dice, but both models score poorly; boundary accuracy is low. No separate glass, reflective-surface, transparency-preservation, or shadow-quality pass is established.

## Workflow verification

The real-photo Playwright workflow passed on two paired test photos with BiRefNet Lite. It verified:

1. Import of both photos and persistence of the original assets.
2. Batch segmentation and creation of distinct transparent PNGs with dimensions matching the source images; decoded output pixels were checked for both non-opaque background pixels and non-transparent subject pixels.
3. Persistence of editable masks and exact original-asset references.
4. Undo and redo, including persistence of the restored states.
5. Save/reopen without losing originals or masks.
6. Manual brush and eraser corrections, mask-level undo/redo, applying the corrected mask, and original recovery.

The run reported `browserErrors: []`. Evidence screenshots:

- Batch result: `artifacts/background-removal-certification/workflow-screenshots/real-photo-batch-cutout.png`
- Mask refinement: `artifacts/background-removal-certification/workflow-screenshots/real-photo-mask-refinement.png`
- Original restored: `artifacts/background-removal-certification/workflow-screenshots/real-photo-original-restored.png`

A persistence race was found during this workflow. Client autosaves are now serialized, the API rejects stale project revisions, and the backend integration test verifies that an older update cannot overwrite a newer revision. The workflow also exposed an alpha-encoding defect: mask values were written to RGB while alpha remained fully opaque. PNG generation now writes the foreground mask into the PNG alpha channel; regression assertions verify actual transparency and subject alpha in both batch and refined outputs. The final end-to-end run passed after the test waited for the exact persisted state instead of accepting an intermediate API snapshot.

## Verification record

- `npm test` — **PASS**: TypeScript check plus production-engine, smart-layout, backend-integration, and backup tests; backend integration includes stale-revision regression coverage.
- `npm run build` — **PASS**: TypeScript, Vite production build, and Electron API bundle.
- `tests/run-background-clean-workflow.cmd` — **PASS**: two real photos, batch BiRefNet Lite, original preservation, editable masks, undo/redo, reload, mask editing/history, and original recovery; no browser errors.
- Quantitative model comparisons — **COMPLETED** for 14 Open Images pairs and separately 10 Transparent-460 pairs; no inference failures recorded. This does **not** mean the quality criteria passed.
- Peak memory, GPU/CPU utilization, physical print, and commercial-use validation — **NOT TESTED**.

Raw metrics, model outputs, and comparison sheets are in `artifacts/background-removal-certification/real-photo-evaluation/benchmark-results/` and `artifacts/background-removal-certification/real-photo-evaluation/transparent-benchmark-results/`.

## Final certification disposition

**Commercial certification remains WITHHELD.** The product has a verified editable background-removal workflow and BiRefNet Lite is the stronger general-object candidate among the two models tested here. However, several measured categories have low mask/boundary scores, the sample count is only two per Open Images group, required subject categories are absent, transparent-object metrics are poor and non-commercially licensed, and memory/hardware characteristics remain unmeasured.

Before reconsideration, expand the legally usable reference set (especially footwear, glass jars, transparent and reflective objects, fine hair, and varied complex scenes), predefine category acceptance thresholds, measure memory and hardware behavior on supported Windows configurations, and repeat independent visual review. Until then, segmentation output must remain user-reviewable/editable and must not be marketed as universally production-ready.
