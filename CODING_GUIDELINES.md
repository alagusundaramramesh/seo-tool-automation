# Coding Best Practices

When writing or modifying code in this project, follow these principles.
(Provided by the project owner on 2026-10-13. Every contributor, human or AI, follows these.)

## 1. Keep the code simple and readable

Write code at the level of the existing project.

* Prefer simple, straightforward JavaScript.
* Do not introduce advanced patterns just to make the code look more professional.
* Do not over-engineer simple requirements.
* Prefer readable code over clever or highly abstract code.
* Follow the existing project structure and coding style before introducing a new pattern.
* Avoid unnecessary classes, factories, repositories, service layers, dependency injection, or complex abstractions unless the existing code already uses them or they provide a clear benefit.

## 2. Use early returns / guard clauses

Avoid deeply nested `if` statements when checking validation or error conditions.

```js
if (!vendor) {
    return res.status(404).json({ status: false, message: "Vendor not found" });
}

if (!vendor.is_active) {
    return res.status(400).json({ status: false, message: "Vendor is inactive" });
}

// Main logic here
```

Use early returns mainly for missing data, invalid input, permission/auth failures, business-rule failures and error conditions. Do not force early returns when nesting represents the actual business logic or algorithm.

## 3. Use meaningful business names

Avoid vague names such as `data`, `result`, `obj`, `item`, `temp`, `response`, `arr` when a more meaningful name is possible. Names should explain what the data represents.

```js
const activeProducts = products.filter(product => product.status === 1);
```

Do not rename existing variables unnecessarily when making an unrelated change.

## 4. Protect the application from external data structures

Do not let third-party response structures (Lighthouse, AWS, etc.) spread through the application. Keep the transformation close to the integration point.

```js
function formatPaymentResponse(response) {
    return {
        paymentId: response.entity.id,
        orderId: response.entity.order_id,
        amount: response.entity.amount,
        status: response.entity.status
    };
}
```

Do not create an abstraction layer for every external API automatically. Use a mapper/helper when it genuinely improves maintainability.

## 5. Prevent invalid business states

Before performing important operations, validate that the current state allows the operation. Ask: "Can this action legally happen in the current state?" Do not introduce state-machine libraries unless genuinely required.

## 6. Separate business decisions from side effects when useful

When business logic is meaningful or reused, separate "Can this action happen?" (e.g. `canRefundOrder(order)` returning `{ allowed, reason }`) from "Perform the action." Do not create a separate function for every simple `if`.

## 7. Make errors useful

Avoid `throw new Error("Something went wrong")`. Prefer meaningful messages and, when useful, a stable error code:

```js
return res.status(400).json({
    status: false,
    code: "SKU_OUT_OF_STOCK",
    message: "Selected SKU is out of stock"
});
```

Never expose passwords, JWTs, API keys, secrets, payment credentials or sensitive personal information in errors or logs. Server logs should include useful context:

```js
console.error("Order payment failed", { orderId, paymentId, reason });
```

## 8. Keep changes focused

Change only what is required. No unrelated refactoring, mass renames, whole-file reformatting, or architecture changes without a clear reason. Small requirement → small focused change → easy review → easy testing → easy rollback.

## 9. Respect the existing project architecture

Before creating new files, functions or patterns: inspect existing code, find similar functionality, follow the working approach, reuse helpers. Project consistency beats a theoretically cleaner architecture.

## 10. MongoDB coding style

Use the native MongoDB driver (`db.collection("...").findOne(...)`). Do not introduce Mongoose or a repository/ORM layer unless explicitly requested. Use projections when they provide a clear benefit.

## 11. Redis usage

Respect `CONFIG.CAN_ENABLE_REDIS`. Do not make Redis mandatory for functionality that works without it. Cache flow: check Redis → hit returns → miss reads MongoDB → store in Redis → return. Always consider cache invalidation. Do not add caching just because it is theoretically faster.

## 12. Async and error handling

Use `async/await` consistently. Do not silently swallow errors; if an error is intentionally ignored, explain why in a comment.

## 13. Don't over-abstract

Before creating a helper ask: Will it be reused? Is it complex enough to deserve a name? Does extracting it make the code easier to understand? If no, keep it local.

## 14. Preserve existing behavior

Do not change unrelated API response formats, database fields, compatibility code or frontend expectations. Search all usages before changing shared functions. Explain the impact before any broad refactor.

## 15. Prefer readable code over clever code

Avoid nested ternaries, complex one-liners, metaprogramming, excessive destructuring, advanced functional programming, clever regex and unnecessary design patterns.

## 16. Before changing code

Understand: where it is called, what it receives, what it returns, which collections are involved, whether Redis is involved, whether the frontend depends on the response, whether helpers exist, and what else could be affected. Then make the smallest safe change.

## 17. Overall engineering rule

Priority order:

1. Existing project conventions
2. Correctness
3. Security
4. Readability
5. Maintainability
6. Performance when justified
7. Abstraction / architectural improvement

When multiple solutions are valid, prefer the one that is easier to understand, debug and test, consistent with existing code, the smallest reasonable change, and appropriate for the current scale.
