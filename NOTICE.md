# NOTICE

`dsh-drawio-inline` is an independent DeepSeek Harness (DSH) plugin that renders
draw.io diagrams in the chat transcript.

- The build preset under `shared/` (`tsdown.client.ts`, `web-platform.ts`,
  `vitest.setup.ts`) is taken from the `dsh-web` plugin family
  (Apache-2.0, https://github.com/zhu1090093659/dsh-web). It is build-time only
  and not published in the npm package.
- draw.io viewer / mermaid-converter assets are **not** bundled yet. When they
  are added they stay under their upstream licenses (draw.io: Apache-2.0 with
  additional terms for stencils/templates; `@drawio/mermaid` Apache-2.0) and
  will be listed here with their license files.
- Not affiliated with or endorsed by draw.io / diagrams.net or DeepSeek.
