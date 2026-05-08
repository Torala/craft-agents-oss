# Project Evolution Archive

This folder contains historical project documentation retained for **legal reasons**. Do not delete or rename files here without consulting legal/leadership.

## Operational constraints

- One file (`Hermes : Anna thinking.pdf`) contains a colon, illegal in Windows filenames.
- This folder is **excluded from the Windows build runner** via sparse-checkout in `.github/workflows/build-and-upload.yml` and `.github/workflows/release.yml`. Do not remove that exclusion.
- This folder is **excluded from the OSS mirror** by allow-list (it is not listed in `scripts/oss-allow-list.txt`). Do not add it.
- The CI filename guard in `.github/workflows/validate.yml` exempts this folder, so any new file added here is permitted regardless of its name.

## Local Windows development

If you clone this repo on Windows, the checkout will fail on the file with `:` in its name. Configure sparse-checkout to skip this folder:

```bash
git sparse-checkout init --no-cone
git sparse-checkout set '/*' '!/docs/project-evolution/'
```

Or clone without the folder up front:

```bash
git clone --no-checkout https://github.com/craft-ai-agents/craft-agents.git
cd craft-agents
git sparse-checkout init --no-cone
git sparse-checkout set '/*' '!/docs/project-evolution/'
git checkout main
```
