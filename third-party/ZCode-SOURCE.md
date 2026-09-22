# ZCode source attribution

Upstream: [zai-org/ZCode](https://github.com/zai-org/ZCode)

Source revision: [872ad960de7ec172591f7e1952f7849229f94521](https://github.com/zai-org/ZCode/tree/872ad960de7ec172591f7e1952f7849229f94521).

License: Apache License 2.0. The upstream license is reproduced in `ZCode-LICENSE`, and the upstream notice is reproduced in `ZCode-NOTICE.md`.

GrokDesk adapts the ZCode desktop interface theme, presentation components and window frame for an independent Electron client connected to local Grok Build. Integration changes are maintained in GrokDesk; the upstream project does not endorse or maintain this client. The final imported source files retain their origin annotations.

The current import and adaptation scope is:

- `renderer/DesktopWindowFrame.tsx`, from `packages/ui/src/DesktopWindowFrame.tsx`, with the local import alias adjusted.
- `renderer/components/ui/{button,dialog,dropdown-menu,input,select}.tsx`, from the corresponding `packages/ui/src/components/ui` files, with local imports adjusted.
- `renderer/components/lib/utils.ts`, from `packages/ui/src/components/lib/utils.ts`.
- `renderer/styles.css`, retaining upstream typography, `@theme`, dark, `zaiLight` and `zaiDark` variables and scrollbar rules; GrokDesk layout/Markdown additions are marked at the end, and dependency imports are adapted.
- `renderer/App.tsx`, adapting WorkspaceShellLayout, ConversationDraftEmptyState and SidePaneTabTrigger presentation.
- `renderer/Composer.tsx`, adapting ChatPromptEditor and ConversationComposer presentation.
- `renderer/Sidebar.tsx`, adapting WorkspaceSidebar, NewTaskButtonGroup and TaskListItem presentation.
- `renderer/SettingsPanel.tsx`, adapting SettingsPageParts layout.

The latter application views connect to GrokDesk's own IPC and local Grok Build adapter. They do not retain ZCode's service, account, provider or update integrations. Source comments identify the upstream revision and adaptation where applicable.

`renderer/Timeline.tsx` and `renderer/TerminalPanel.tsx` are new GrokDesk implementations rather than copied ZCode components.

The upstream notice describes ZCode itself. Inclusion preserves source attribution and does not mean that GrokDesk implements every feature or network, authentication, storage or update behavior described there. GrokDesk's own implementation and documentation describe its actual behavior.

This directory is distributed with GrokDesk under `resources/third-party`. Grok mobile icon attribution is recorded in `resources/Assets/NOTICE.md`.
