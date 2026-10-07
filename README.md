# factories-tools

The tools of the Claude Code **factories** kit: the validator (the gate), the run recorder (the
state), two headless runners, the diagram CLI, the Factory Studio and the `ai-usage` cost
tracker. Mounted as a git submodule at `factories-tools/` in every project that uses the kit,
beside `factories/` (the pipelines) and `factories-skills/` (the skills).

```
factories-tools/                 this repository, as a project sees it
├── bin/validate.mjs             the gate:     node factories-tools/bin/validate.mjs <id>
├── bin/state.mjs                the recorder: node factories-tools/bin/state.mjs <command> <runDir> …
├── bin/xstate-runner.mjs        the headless runner on XState: node factories-tools/bin/xstate-runner.mjs run <id> …
├── pipeline-validation/         the validator's TypeScript sources and tests (bundled into bin/)
├── pipeline-state/              the recorder's sources and tests (bundled into bin/)
├── pipeline-xstate-runner/      the XState runner's sources and tests (bundled into bin/)
├── pipeline-runner/             the first headless runner: Claude, Codex, Copilot and Antigravity harnesses (npm install + build)
├── factory-diagram/             the SVG diagram CLI behind /draw-factory (npm install + build)
├── factory-studio/              the Studio: editor, runs and sessions in a browser (npm install + build)
├── ai-usage/                    usage and cost tracker for AI coding harnesses; the hooks.after cost attribution
└── scripts/                     check-bundles.sh, check-secrets.sh
```

The three bundles in `bin/` are **committed**, so a consumer runs them with plain node 20 and
installs nothing. The other four tools are built in place (`npm install && npm run build` inside
each) by the skill or the person that uses them.

## The contract between the three repositories

The mount names at the project root are the contract, the same in every project:

| Mount | Repository | Holds |
|---|---|---|
| `factories/` | `vitkuz/factories` | `<id>/pipeline.json` and knowledge, `pipeline.schema.json`, `state.schema.json`, hook scripts |
| `factories-tools/` | `vitkuz/factories-tools` | this repository |
| `factories-skills/` | `vitkuz/factories-skills` | `any-factory`, `create-any-factory`, `draw-factory`, one wrapper skill per factory, `install.sh` |

The repositories share **file contracts** (paths and JSON shapes), never code:

```
factories-skills  ──calls──▶  factories-tools/bin/*.mjs  ──reads──▶  factories/<id>/pipeline.json
   └──────────────────reads──────────────────▶  factories/<id>/  (the runner walks the graph)
factories  ──▶  nothing (its hook scripts are self-contained, exit 0 when their tool is absent)
```

Every tool finds the **project root** from the working directory: the nearest folder holding
`.claude/`, never a `.git` (inside a submodule `.git` is a file). From there it reads
`factories.local/<id>/pipeline.json` (the project's own factory) before `factories/<id>/pipeline.json`,
and the validator looks for the wrapper skill at `.claude/skills/<id>/`. Each tool validates with
its own Zod twin of `factories/pipeline.schema.json`; a test checks the twin against the schema
file when `../factories` is mounted.

## Add to a project

```sh
git submodule add git@github-personal:vitkuz/factories.git factories
git submodule add git@github-personal:vitkuz/factories-tools.git factories-tools
git submodule add git@github-personal:vitkuz/factories-skills.git factories-skills
bash factories-skills/install.sh           # .claude/skills/<name> -> ../../factories-skills/<name>
node factories-tools/bin/validate.mjs      # lists the ids; node 20+, nothing to install
```

A fresh clone of a project: `git clone --recurse-submodules …`, then `bash factories-skills/install.sh`
once. To update: `git submodule update --remote factories factories-tools factories-skills && bash factories-skills/install.sh`,
then commit the three pointers.

## Develop

The bundled tools (`pipeline-validation`, `pipeline-state`, `pipeline-xstate-runner`):

```sh
cd pipeline-validation   # or pipeline-state, pipeline-xstate-runner
npm install
npm run check            # typecheck, prettier, tests (incl. the bundle test: the committed bin/ is current)
npm run bundle           # rewrites ../bin/<name>.mjs — commit it with the sources
```

`bash scripts/check-bundles.sh` runs the staleness check of all three. The other tools:
`npm run typecheck && npm test` (`npm run format` first), and `npm run build` for a runnable `bin/`.

The tests that walk **every real factory** (`pipeline-validation/tests/factories.test.ts`,
`pipeline-state/tests/factories.test.ts`, the runner's contract tests, the schema-twin tests) need this
repository mounted in a project beside `factories/` and `factories-skills/`; run alone they are
skipped with a note. `factory-diagram` and `factory-studio` tests likewise read the real kit at
`../../factories`.

Before every push: `bash scripts/check-secrets.sh` (gitleaks when installed, then grep patterns for
keys, tokens, account ids, emails, home paths and the owner's private project names). This repository
is public: fixtures and docs name no project, no account, no person.

Each tool's README says how it is organised and used:
[pipeline-validation](pipeline-validation/README.md), [pipeline-state](pipeline-state/README.md),
[pipeline-xstate-runner](pipeline-xstate-runner/README.md), [pipeline-runner](pipeline-runner/README.md),
[factory-diagram](factory-diagram/README.md), [factory-studio](factory-studio/README.md),
[ai-usage](ai-usage/README.md).

## License

MIT, see `LICENSE`.
