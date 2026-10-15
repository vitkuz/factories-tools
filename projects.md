# Projects that use factories-tools

Every project on this machine that carries `vitkuz/factories-tools` as a git submodule (at `factories-tools/`, next to `factories/` and `factories-skills/`). Use this list when a change here has to reach every project: update the submodule pointer in each, rebuild the apps, and keep the ports apart.

Machine: WSL Ubuntu, user `kuzmenka`. Updated: 2026-10-15.

## Projects

| Project | Path | Remote (origin) | Branch | Other submodules |
|---|---|---|---|---|
| smekalka-test-pipline | `/home/kuzmenka/smekalka-test-pipline` | — (local only) | `main` | `factories`, `factories-skills` |
| vitkuz-ai-dark-factory-project | `/home/kuzmenka/vitkuz-ai-dark-factory-project` | `git@github-personal:vitkuz/b3l3o3g3-factory.git` | `main` | `factories`, `factories-skills`, `repos/back`, `repos/front`, `repos/tools`, `repos/docs` |
| vitkuz-quotes-and-answers | `/home/kuzmenka/vitkuz-quotes-and-answers` | `git@github-personal:vitkuz/vitkuz-quotes-and-answers.git` | `main` | `factories`, `factories-skills`, `repos/reference` |
| vitkuz-youtube-travel-collector | `/home/kuzmenka/vitkuz-youtube-travel-collector` | `git@github-personal:vitkuz/vitkuz-youtube-travel-collector.git` | `main` | `factories`, `factories-skills`, `repos/front`, `repos/back`, `repos/tools`, `repos/docs` |
| vitkuz-art-gallery | `/home/kuzmenka/vitkuz-art-gallery` | `git@github-personal:vitkuz/vitkuz-art-gallery.git` | `main` | `factories`, `factories-skills` |

## Ports

Each project sets its ports in the git-ignored `api/.env` of each app (see the Ports section of `factory-studio/README.md` and `factory-editor/README.md`). Editor = Studio API port + 50 and web port + 10 (smekalka-test-pipline predates the rule: 3110 / 3111). A new project takes the next free pair.

| Project | Factory Studio API / web (`factory-studio/api/.env`) | Factory Editor API / web (`factory-editor/api/.env`) |
|---|---|---|
| smekalka-test-pipline | 3110 / 5179 | 3111 / 5189 |
| vitkuz-ai-dark-factory-project | 3100 / 5175 | 3150 / 5185 |
| vitkuz-quotes-and-answers | 3101 / 5176 | 3151 / 5186 |
| vitkuz-youtube-travel-collector | 3103 / 5178 | 3153 / 5188 |
| vitkuz-art-gallery | 3200 / 5177 | 3250 / 5187 |

Free next: Studio API 3104 / web 5180, Editor API 3154 / web 5190.

## Rolling a change out to every project

After a change is pushed to `vitkuz/factories-tools` `main`:

```bash
for d in /home/kuzmenka/smekalka-test-pipline /home/kuzmenka/vitkuz-ai-dark-factory-project \
         /home/kuzmenka/vitkuz-quotes-and-answers /home/kuzmenka/vitkuz-youtube-travel-collector \
         /home/kuzmenka/vitkuz-art-gallery; do
  (cd "$d/factories-tools" && git status --short)          # must print nothing: no local edits here
  (cd "$d/factories-tools" && git fetch -q origin && git checkout -q main && git merge --ff-only origin/main)
  (cd "$d" && git add factories-tools && git commit -m "Bump factories-tools: <what changed>" -- factories-tools)
  (cd "$d" && git remote | grep -q . && git push origin HEAD)  # smekalka-test-pipline has no remote
done
```

Then rebuild the apps in each project (`dist/` is git-ignored, so a pointer update alone serves the old build):

```bash
cd <project>/factories-tools/factory-studio && npm install && npm run build
cd <project>/factories-tools/factory-editor && npm install && npm run build
```

Rules learned the hard way:

- **Never edit shared files for a per-project need** (ports, paths): put it in the project's git-ignored `api/.env`. A local edit inside `factories-tools/` blocks the next update and gets reverted.
- Commit only the submodule path in each project (`-- factories-tools`); the projects often have unrelated uncommitted work.
- Stop a running app by the PID that holds its port (`ss -ltnp | grep ':<port> '`), never `pkill node` — the other projects' apps run node too.

## Adding or removing a project

Add a row to both tables when a project adds the submodule (`git submodule add git@github-personal:vitkuz/factories-tools.git factories-tools`), pick the next free ports, and create both `api/.env` files. To check the list is still complete:

```bash
grep -l "vitkuz/factories-tools" /home/kuzmenka/*/.gitmodules
```
