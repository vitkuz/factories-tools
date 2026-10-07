# factory-diagram

Draws a factory `pipeline.json` as an SVG, headless: no browser, no server, no network.
The skill `/draw-factory <id>` is a thin wrapper around this CLI.

```text
factories/<id>/pipeline.json  (or factories.local/<id>/, the project's own)
        ↓  load + validate   (the kit's factories-tools/bin/validate.mjs, then Zod for types)
        ↓  resolve constants (the runner's rules; {{date}} and empty params stay as written)
   GraphModel  (nodes start|step|human|end, edges forward|loop|max|jump, ranks, lanes)   ← --format json
        ↓  renderer: native (the Studio's layout, ported; own SVG writer)
   <out>/<id>.svg
```

## Use

```sh
npm install && npm run build                      # once; dist/ is not committed
node bin/factory-diagram.js quick-research-factory          # → <repo>/quick-research-factory.svg
node bin/factory-diagram.js sdlc-factory --out docs/diagrams # → docs/diagrams/sdlc-factory.svg
node bin/factory-diagram.js sdlc-factory --out ideas/sdlc.svg
node bin/factory-diagram.js --all                            # → diagrams/<id>.svg + diagrams/index.md
node bin/factory-diagram.js quick-research-factory --format json   # the model, not a picture
node bin/factory-diagram.js --list
```

Run it from the repository root, or pass `--root <repo>`. A pipeline is named by id, by its
folder, or by the file. Options: `--out`, `--format svg|json`, `--hide loops,max,legend,title`,
`--highlight <slug,…>`, `--strict` (warnings fail), `--open` (wslview / xdg-open).

Not yet (the CLI refuses them and names what it does): `--renderer graphviz|mermaid`,
`--view detailed|minimal`, `--theme dark|mono`, `--direction TB`, `--format png|dot|mmd`, `--run`.

## How validity is decided

The shared validator is the one source of truth. Its errors stop the tool — except the two
the Studio draws anyway, which become warnings: a dangling target (that edge is not drawn)
and a step unreachable from START (drawn with a warning badge). Legacy string prompts /
`systemPrompt` are upgraded on read as the Studio does. `--strict` turns every warning into
a failure.

## Layout

`src/shared/studio-graph/` is a verbatim copy of `factories-tools/factory-studio/web/src/shared/graph/`
(`rank.ts`, `layout.ts`, `text.ts`, `graph.types.ts`); `tests/studio-sync.test.ts` fails when
the two drift. Edit the Studio, then copy again — never the copy. The native renderer only turns
the port's handles and lane ys into SVG paths. Known inherited limit: when a step caps two
different events, only the first one's `onMax` is drawn as an escape.

## Layout of the code

```text
src/
├─ cli/                      arg parsing (commander), composition root
├─ features/
│  ├─ load/      locate → read (legacy upgrade) → shared validator → Zod → resolve constants
│  ├─ graph/     build-graph.service.ts, graph.schema.ts (Zod), graph.types.ts, graph.utils.ts
│  ├─ render/    render.types.ts (Renderer = (model, options) => { svg, warnings })
│  │  └─ native/ layout.service.ts, svg.writer.ts, cards.ts, edges.ts, legend.ts, title.ts, themes.ts
│  └─ draw/      one pipeline → one file; --all → a folder + index.md
├─ adapters/     file-system (sync), shell (the validator process)
└─ shared/       logger, errors, fp, studio-graph (the port)
fixtures/        1 linear · 2 fan-out-fan-in · 3 review-loop · 4 shortcut-jump · 5 human-gate
                 · 7 legacy-prompts · 8 dangling-unreachable   (6 is factories/aws-architecture-factory)
tests/           model + SVG snapshots for every fixture and every factory, sync test, draw rules
```

`npm test`, `npm run typecheck`, `npm run format`.

## Pinned for later milestones (spiked, not installed)

- graphviz renderer: `@hpcc-js/wasm-graphviz@1.29.2` (Graphviz 16.1.0 in WASM, 2.1 MB, ~130 ms to load) + `ts-graphviz@3.0.7`
- PNG: `@resvg/resvg-js@2.6.2` (text without Chromium; note it does not resolve CSS custom
  properties, which is why the theme is baked into the `<style>` rules rather than exposed as `var(--x)`)
