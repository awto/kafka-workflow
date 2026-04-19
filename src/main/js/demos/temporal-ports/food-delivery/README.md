# Temporal Port: food-delivery

Original Temporal sample: [temporalio/samples-typescript/tree/main/food-delivery](https://github.com/temporalio/samples-typescript/tree/main/food-delivery)

This port keeps the workflow part of the sample:

- charge the order;
- expose current order status through a query-like event;
- react to `pickedUp` and `delivered` signals;
- refund if pickup or delivery takes too long;
- send the final rating reminder after delivery.

The frontend, worker, and app scaffolding from the Temporal sample are intentionally left out here so the workflow logic stays directly comparable.

Run with:

```sh
npm test --workspace demos/temporal-ports/food-delivery
```
