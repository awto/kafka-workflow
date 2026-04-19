# Temporal Port: patching-api

Original Temporal sample:
[temporalio/samples-typescript/tree/main/patching-api](https://github.com/temporalio/samples-typescript/tree/main/patching-api)

This port keeps versioning in demo code instead of adding a dedicated patch API to the core runtime.

Comparison point:

- Temporal uses patch markers inside workflow code to coordinate old and new paths.
- This port uses the existing versioned-envelope demo flow: `1.0` hands off state to `1.1`, and patch-only `1.1.x` starts just run the latest compatible code without an upgrade step.
- This is the better tradeoff for this runtime: versioning remains explicit
  domain workflow code, while the core stays small and avoids a permanent patch
  marker API.

Run:

```sh
npm test --workspace demos/temporal-ports/patching-api
```
