## Add dsh-drawio-chat

`dsh-drawio-chat` is a chat-first draw.io plugin for DeepSeek Harness: the agent
creates, reads and edits native `.drawio` files with semantic ops, and an
interactive draw.io viewer renders them inline in the transcript. Files stay in
the workspace under `diagrams/`.

- Entry file: `data/plugins/xuedipiaofei__dsh-drawio-chat.yml`
- Category: `tools`
- The repository's `package.json` declares `dsh.bundle` (`cordis.patch.yml` at the
  repo root) and `dsh.client`; `pnpm typecheck`, `pnpm test` (13 files / 50 tests)
  and `pnpm build` pass.
- Upstream plugin: https://github.com/xuedipiaofei/dsh-drawio-chat
