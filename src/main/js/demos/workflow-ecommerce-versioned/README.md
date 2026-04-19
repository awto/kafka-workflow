`workflow-ecommerce-versioned` is the second versioned workflow example.

It reuses the same demo versioning helper as the trip-booking demo:
- `1.0.x` carts can hand off state for an explicit managed upgrade
- `1.1.x` adopts the cart and adds a discount reminder stage
- `2.0.x` starts fresh and does not reuse `1.x` instances

The upgrade manager is ordinary workflow code, not a runtime registry. The demo
uses versioned envelopes and durable refs to show how a project can choose its
own compatibility policy without growing the core API. A real application can
keep this protocol, remove pieces it does not need, or build a different
versioning workflow around the same durable refs and messages.

Run the bundle tests with:

```sh
npm test --workspace demos/workflow-ecommerce-versioned
```

Run the Docker Compose integration test with:

```sh
npm run test:integration --workspace demos/workflow-ecommerce-versioned
```

That Compose run covers:

- `1.0 -> 1.1` minor upgrade with cart-state handoff
- `1.1.x` patch-only start without upgrade
- fresh `2.0` start with the v2 reminder flow
