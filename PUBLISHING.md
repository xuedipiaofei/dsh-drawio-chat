# Publishing dsh-drawio-inline

The repo has the publishable package (`dsh-drawio-inline`), a market entry and
an OIDC publish workflow. The steps below are the remaining user actions — the
plugin has **not** been published anywhere yet.

## 1. GitHub repository

1. Create `github.com/<you>/dsh-drawio-inline` (public).
2. Add the topic `dsh-plugin` (and `deepseek-harness`).
3. Push this repository and tag the release: `git tag v0.1.0 && git push --tags`.

The `publish.yml` workflow uses npm trusted publishing via GitHub OIDC; configure
the npm package's trusted publisher (repo + workflow) instead of an npm token.

## 2. npm

Either push a `v*` tag (workflow publishes automatically once trusted publishing
is configured), or publish manually:

```sh
pnpm typecheck && pnpm test && pnpm build
npm publish --access public --provenance
```

Check the tarball first: `npm pack --dry-run`.

## 3. Market listings

- **Community catalog / awesome list** (`awesome-dsh-plugin.com`, format 1):
  open a PR that adds this repository. The entry to submit is
  [`market/awesome-entry.yml`](market/awesome-entry.yml); the full catalog
  fragment (for a self-hosted catalog) is [`market/index.json`](market/index.json).
- **Official GUI marketplace** (`dsh-market.com`, 101 entries): it has **no
  diagram/drawio category yet**. Submit the same entry to its PR process (see
  `@linxin666/dsh-client-ui-market` README) and use keywords
  `drawio`, `draw.io`, `diagram`, `flowchart`, `mermaid` in the listing so search
  finds it ("画图" alone does not match drawio entries).

## 4. Version bumping

- Update `package.json`, `market/index.json`, `CHANGELOG.md` together.
- `pnpm build` must be clean; the package ships only `lib/`, locale files,
  `cordis.patch.yml`, READMEs, NOTICE and LICENSE.
- Desktop users can install a local build without the CLI (quit the app first):

```sh
node scripts/install-into-desktop-profile.mjs --dry-run
node scripts/install-into-desktop-profile.mjs
```

`--uninstall` rolls the profile back (`package.json` gets a timestamped backup).
