# Temporal Port: nextjs-ecommerce-oneclick

Original Temporal sample: [temporalio/samples-typescript/tree/main/nextjs-ecommerce-oneclick](https://github.com/temporalio/samples-typescript/tree/main/nextjs-ecommerce-oneclick)

This port keeps the same core behavior:

- a one-click purchase starts in `PURCHASE_PENDING`;
- callers can query the current state while it is running;
- a cancel signal wins if it arrives before the timeout, otherwise the purchase is confirmed.

Run with:

```sh
npm test --workspace demos/temporal-ports/nextjs-ecommerce-oneclick
```
