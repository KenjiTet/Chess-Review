---
name: ts-unit-test
description: Generate full Vitest unit test coverage for TypeScript utility files in the LegalPass frontend. Use this skill whenever the user asks to write tests, add test coverage, or test a utility/helper file. Trigger on phrases like "write tests for", "add coverage to", "test this util", or any mention of a .ts utility file that needs testing.
---

# TypeScript Unit Test Coverage — LegalPass

## Stack & Conventions

- **Test runner:** Vitest
- **Language:** TypeScript — strict typing throughout, never use `any`
- **Test file location:** Mirror the source path under `resources/js/Tests/`
  - Source: `js/Components/AiReview/Utils/AiReviewUtils.ts`
  - Test:   `js/Tests/AiReview/AiReviewUtils.test.ts`
- **Path aliases:** Use `@/` just like source files do
- **Imports:** Always import from `vitest` explicitly: `{ describe, it, expect, vi, beforeEach }`

---

## Workflow

### Step 1 — Read the source file

Read the entire utility file before writing a single line. Extract:

- Every **exported** function (name, parameters, return type)
- All **imports** — note which are: types only, constants, other internal utils, external libs (axios, route, etc.)
- Functions that are **async**
- Functions that **throw**
- Functions that **call other project utilities** internally (candidates for mocking or integration-style testing)

### Step 2 — Read imported dependencies

For each non-trivial import (types, enums, constants used in logic), read those files too:

- Enums: know all possible values — every branch must be exercised
- Constants: understand what the default/sentinel values are (e.g. `DEFAULT_NONE`, `NOT_MENTIONED`)
- Types: know the shape of every interface so test data is correctly typed

### Step 3 — Decide mocking strategy

Apply these rules strictly:

| Dependency type | Strategy |
|---|---|
| Pure internal utility functions | **Do not mock** — test the real integration |
| `axios` / HTTP calls | **Mock with `vi.mock`** — never make real network calls |
| `route()` Ziggy helper | **Mock with `vi.mock`** — it requires Laravel context |
| `crypto.subtle` (Web Crypto) | **Mock with `vi.spyOn`** — environment may not support it |
| `Date.now()` / `new Date()` | **Mock with `vi.setSystemTime`** when output depends on current time |
| Complex class dependencies | **Create a minimal mock class** — only implement the methods actually used |

**Rule:** mock at the boundary of the system under test, not inside it.

### Step 4 — Plan coverage per function

For every exported function, define test cases across these categories before writing code:

| Category | What to test |
|---|---|
| **Happy path** | Typical valid input — verify expected output exactly |
| **Edge cases** | `[]`, `""`, `0`, `undefined`, `null` where the type allows |
| **Boundary conditions** | Single-element arrays, values at exact thresholds |
| **All enum/union branches** | Every possible value of an enum or union type gets at least one test |
| **Async resolution** | For `async` functions: resolved values AND rejected/thrown cases |
| **Thrown errors** | Every code path that `throws` must have a test asserting the throw |
| **Conditional branches** | Every `if`/`else` branch, especially those guarding against bad state |

**Mandatory rule:** Every exported function must have its own `describe` block and at least one test case.

If a function has non-trivial logic, it must have multiple test categories (happy path, edge cases, failure cases).
Before writing tests, list all exported functions and verify that each one will be tested.

### Step 5 — Write the test file

Write the complete file. Apply the rules below.

---

## File Structure

```ts
// 1. vi.mock calls MUST come before any other imports (Vitest hoists them)
vi.mock("axios");
vi.mock("ziggy-js", () => ({ default: vi.fn((name: string) => `/mocked/${name}`) }));

// 2. Vitest imports
import { describe, it, expect, vi, beforeEach } from "vitest";

// 3. Source under test
import { myFunction, anotherFunction } from "@/Components/Feature/Utils/MyUtils";

// 4. Type imports used in test data
import type { MyType } from "@/Components/Feature/Types/MyTypes";
import { MyEnum } from "@/Components/Feature/Types/MyEnum";

// 5. Factory functions (see below)
// 6. describe blocks (see below)
```

---

## Naming Conventions

- Outer `describe` = the function name: `describe("mergeKeypoints", ...)`
- Inner `describe` = scenario group: `"happy path"`, `"edge cases"`, `"boundary conditions"`, `"when X is missing"`, etc.
- `it` = plain English assertion, starts with a verb: `"returns an empty array when input is empty"`, `"throws when value is undefined"`

---

## Typing Discipline

Always type test data explicitly. Never let TypeScript infer from a loose object literal.

---

## Factory Functions

Define factory functions at the top of the file for every domain type used in multiple tests. Factories use `Partial<T>` overrides over a valid minimal default.

```ts
// Factory: minimal valid Keypoint
const makeKeypoint = (overrides: Partial<Keypoint> = {}): Keypoint => ({
    name: "default_key",
    value: "default_value",
    modifiedBy: [],
    numberOfModifications: 0,
    ...overrides,
});

// Factory: minimal valid Party
const makeParty = (overrides: Partial<Party> = {}): Party => ({
    id: "party-1",
    name: "Test Corp",
    role: "buyer",
    entityType: "PM",
    fields: [],
    extracted: false,
    ...overrides,
});
```

**Rule:** if a type appears in more than one test, it needs a factory. Never inline the same object literal twice.

---

## Async Functions

```ts
it("resolves with the company_file_id on success", async () => {
    // arrange
    vi.mocked(axios.post).mockResolvedValueOnce({ data: { company_file_id: 42 } });

    // act
    const result = await uploadDocumentWithMetadata(...args);

    // assert
    expect(result.company_file_id).toBe(42);
});

it("propagates axios error on failure", async () => {
    vi.mocked(axios.post).mockRejectedValueOnce(new Error("Network error"));

    await expect(uploadDocumentWithMetadata(...args)).rejects.toThrow("Network error");
});
```

---

## Assertion Strength
Assertions must verify **actual behavior and data correctness**, not just existence.

Prefer:

- `toEqual`
- `toMatchObject`
- explicit property checks

Avoid weak assertions like:

- `toBeDefined()`
- `toBeTruthy()`
- `not.toBeNull()`

unless they are the only meaningful check.

Example:

❌ Weak

expect(user).toBeDefined()

✅ Strong

expect(user).toMatchObject({
id: 42,
email: "john@example.com",
})

---

## Mocking Axios

```ts
vi.mock("axios");
import axios from "axios";

// In beforeEach, reset mocks so tests don't bleed into each other
beforeEach(() => {
    vi.clearAllMocks();
});

// Per-test: control the resolved value
vi.mocked(axios.post).mockResolvedValueOnce({ data: { company_file_id: 99 } });
vi.mocked(axios.get).mockResolvedValueOnce({ data: { id: 1, name: "Alice" } });
```

---

## Mocking the `route()` Helper

```ts
vi.mock("ziggy-js", () => ({
    default: vi.fn((name: string, params?: unknown) => `/mocked/${name}`),
}));
```

Then in tests:
```ts
import route from "ziggy-js";
// route() will return "/mocked/route-name" — predictable and safe to use in assertions
```

---

## Mocking `Date.now()` / Current Time

```ts
import { beforeEach, afterEach } from "vitest";

beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-15T10:00:00Z"));
});

afterEach(() => {
    vi.useRealTimers();
});
```

---

## Testing Thrown Errors

```ts
it("throws when no keypoints are provided", async () => {
    await expect(uploadDocumentWithMetadata(blob, "doc.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", 1, "text", [], [], "/", "en")).rejects.toThrow("No keypoints to send");
});

it("throws synchronously when input is invalid", () => {
    expect(() => myFunction(null as unknown as string)).toThrow("Expected a string");
});
```

---

## Using `beforeEach` for Shared Setup

Use `beforeEach` only when multiple tests in a `describe` block share identical setup. Do not use it when only one test needs the setup.

```ts
describe("when user is authenticated", () => {
    let user: User;

    beforeEach(() => {
        user = makeUser({ id: 1, name: "Alice" });
        vi.mocked(axios.get).mockResolvedValue({ data: user });
    });

    it("returns the user on success", async () => { ... });
    it("returns undefined on axios failure", async () => { ... });
});
```

---

## Anti-patterns — Never Do These

| Anti-pattern | Why it's wrong | Correct approach |
|---|---|---|
| `any` in test data | Hides type errors that tests should catch | Use the actual domain type or `Partial<T>` factory |
| Testing implementation details | Tests break on refactors that don't change behavior | Test inputs and outputs only |
| Mocking everything | Tests stop verifying real logic | Mock only at system boundaries (I/O, external libs) |
| Repeating the same object literal | Becomes a maintenance burden | Use factory functions |
| Missing `await` on async assertions | Test passes even when it should fail | Always `await expect(...).rejects...` |
| Testing only the happy path | Bugs hide in edge cases | Every function needs at least one edge case |
| `vi.mock` after imports | Vitest hoists mocks — wrong order causes subtle failures | Always place `vi.mock` before all imports |

---

## Coverage Checklist

Before writing the first line of code, verify your plan covers:

- [ ] Every exported function has at least one `describe` block
- [ ] Every enum / union branch is exercised at least once
- [ ] Every function accepting an array has an empty-array `[]` test
- [ ] Every function accepting optional params has a test with those params absent
- [ ] Every `async` function has both a success and a failure (rejection/throw) test
- [ ] Every code path that throws has a test asserting the exact error message
- [ ] `beforeEach` resets mocks with `vi.clearAllMocks()` whenever `vi.mock` is used
- [ ] No test uses `any`
- [ ] Factory functions defined for every type used in more than one test
- [ ] Every exported function in the file has a corresponding `describe` block
---

```
