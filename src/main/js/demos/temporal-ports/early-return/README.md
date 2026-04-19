# Temporal Port: early-return

Original Temporal sample: [temporalio/samples-typescript/tree/main/early-return](https://github.com/temporalio/samples-typescript/tree/main/early-return)

Temporal demonstrates update-with-start here: the caller starts the workflow and sends an update that waits for the workflow to reach a confirmation point, while the workflow keeps running in the background.

This port keeps the same behavior with plain workflow messages:

- start the workflow normally;
- send `awaitConfirmation` with a reply id;
- the workflow answers that reply when confirmation happens, then continues to completion.

Run with:

```sh
npm test --workspace demos/temporal-ports/early-return
```
