`workflow-ecommerce-v1_1` adopts cart handoffs from `1.0.x` and extends the reminder flow.

Compared with `1.0.x`:
- the first timeout still sends the normal reminder
- the next timeout sends a discount reminder
- checkout returns the active discount code when one was offered
