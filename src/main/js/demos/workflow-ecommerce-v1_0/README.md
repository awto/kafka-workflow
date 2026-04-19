`workflow-ecommerce-v1_0` is the `1.0.x` business logic for the versioned ecommerce demo.

It keeps the original cart behavior:
- collect cart items and email
- send one reminder on timeout
- abandon on the next timeout

This version also registers itself with the generic versioning registry and can hand off its cart state to a newer compatible minor version.
