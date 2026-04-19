# workflow-versioning-demo

Tiny helper package for the versioned workflow examples.

This is not a runtime-level versioning system. It is one small userland
protocol used by the demos. Applications can copy it, simplify it, or replace
it with different envelopes, compatibility rules, upgrade triggers, and cleanup
workflows.

- Defines one demo envelope shape and version rule set.
- Provides handoff and upgrade-manager helper functions.
- Keeps upgrade-manager inputs explicit, so the demo stays in userland and does not need any runtime discovery support.
- Keeps major-version isolation and minor-version upgrades out of the runtime.
- Treats the upgrade manager as another workflow. It receives a normal envelope,
  emits normal upgrade-dispatch records, and resumes target workflows through
  durable refs.
- Patch version differences intentionally do not trigger an upgrade. Minor
  versions can hand off compatible state. Major versions are separate workflow
  families.

The package is intentionally small. The actual demo behavior lives in the versioned trip-booking and ecommerce example packages.
