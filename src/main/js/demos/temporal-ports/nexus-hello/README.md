# Temporal Port: nexus-hello

Original Temporal sample:
[temporalio/samples-typescript/tree/main/nexus-hello](https://github.com/temporalio/samples-typescript/tree/main/nexus-hello)

This port keeps the workflow-level behavior from the sample:

- an echo caller invokes a service operation and waits for its result;
- the echo service operation remains a plain deterministic function;
- a hello caller invokes a service workflow and waits for its result;
- the service hello workflow remains ordinary deterministic workflow code.

Comparison point: Temporal models this with Nexus services, endpoints,
operation handlers, namespaces, and worker wiring. This port uses durable
operation refs and ordinary workflow threads, so the same caller/service shape
does not require a Nexus-specific runtime surface.

Run:

```sh
npm test --workspace demos/temporal-ports/nexus-hello
```
