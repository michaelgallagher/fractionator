# Cross-platform alignment

When you scan two or more platforms, Fractionator matches components across them
so you can see what's shared, what's named differently, and what's missing on a
platform. Matching runs in three passes:

1. **Manual mapping** from a `component-mapping.yaml` (highest priority).
2. **Exact name match** across platforms.
3. **Normalised match** — strips a configurable prefix (default `NHS`) and common
   suffixes (`UI`, `View`, `Component`), then compares case-insensitively, so
   `NHSCard` ↔ `NHSCardUI` line up.

Anything left over is reported as *platform-only*. Matched concepts whose names
differ across platforms are flagged as *name drift*, shown in the alignment table
in the HTML report.

## When you need a mapping

Automated matching is deliberately conservative — semantically equivalent
components with unrelated names (e.g. iOS `RowLink` ↔ Android `NHSRowItem`) won't
match automatically. Capture those in a mapping file:

```bash
# Generate a starter mapping from detected components, then curate it
fractionator --ios ~/ios-proto --android ~/android-proto --init-mapping
# edit catalogue-output/component-mapping.yaml — link concepts, fill in nulls

# Re-run with the curated mapping
fractionator --ios ~/ios-proto --android ~/android-proto \
  --mapping catalogue-output/component-mapping.yaml
```

```yaml
# component-mapping.yaml
mappings:
  - concept: "Row link"
    ios: RowLink
    android: NHSRowItem
  - concept: "Profile / NHS card"
    ios: ProfileCard
    android: NHSCard
```

Mapping entries override automated matches. Names referenced in the mapping but
not found in the scan are surfaced in the output, so curation mistakes are
visible.
