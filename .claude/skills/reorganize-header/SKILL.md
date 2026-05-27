---
name: react-props-sorter
description: 
    Reorganize React component props interfaces and destructuring to follow a strict
    canonical structure with categorized, alphabetically sorted props. Use this skill
    whenever the user asks to sort, reorganize, reorder, or clean up props in a React
    component, mentions "props structure", "props order", "interface sorting", or asks
    to apply the LegalPass props convention. Also trigger when the user pastes a
    component and says "fix the props" or "reorganize this component".
---

# React Props Sorter

Reorganizes a React component's `interface XxxProps` and its destructuring block inside the component function to match the canonical LegalPass prop structure: fixed category order, alphabetical sort within each category.

**Also reorders JSX call or Hook sites** where the component is used, so prop attributes in JSX match the same category and alphabetical order.

---

## Target Structure

### Interface

```ts
interface ComponentNameProps {
    // Data states
    // Callbacks
    // State setters
    // Refs
    // Events
    // Boolean flags
    // Error messages
    // Others
}
```

### Destructuring block

```
export function ComponentName(props: ComponentNameProps) {
    const {
        dataStateProp1, dataStateProp2, dataStateProp3,
        callbackProp1, callbackProp2,
        setterProp1, setterProp2,
        refProp1,
        eventProp1, eventProp2,
        boolProp1, boolProp2,
        errorProp1, errorProp2,
        otherProp1,
    } = props;
}
```

---

## Category Classification Rules

Classify each prop by inspecting its **name and type signature**:

| Category | Classification signals |
|---|---|
| **Data states** | Holds domain data: typed as a model/entity (`User`, `Party[]`, `Keypoint[]`), string/number content fields, status strings, anything that isn't a function, ref, boolean, or error |
| **Callbacks** | Name starts with `on` (`onClick`, `onSave`, `onClauseRequest`) |
| **State setters** | Name starts with `set` (`setEdits`, `setParties`) |
| **Refs** | Type contains `React.RefObject` or `React.MutableRefObject` |
| **Events** | Name ends with `Event` or type is a custom event object (e.g. `KeypointClickEvent`) |
| **Boolean flags** | Type is `boolean` (with or without `?`) |
| **Error messages** | Name contains `error` or `Error` (case-insensitive prefix or substring), or type is `string \| number \| undefined` and the name semantically describes an error |
| **Others** | Anything that doesn't match the above |

Within each category, sort props **alphabetically by name** (case-insensitive A→Z).

---

## Step-by-step Process

### 1. Parse the interface

Identify all props and their full type annotations (including optional `?`, multiline types, generics, union types). Preserve the exact type text — do not simplify or alter types.

### 2. Classify each prop

Apply the classification rules above. When ambiguous, prefer the first matching rule in table order.

### 3. Sort within categories

Sort alphabetically within each category (A→Z, case-insensitive). Ignore leading `on`/`set` prefixes only for **display ordering within their own category** — do not strip them from the actual name.

> **Correct**: sort `onClauseRequest` before `onSaveDocument` (C < S)
> **Correct**: sort `setCurrentEdit` before `setEdits` (C < E)

### 4. Rewrite the interface

Output the full interface with:
- Category comment headers — omit headers for empty categories entirely (no comment with nothing under it)
- One prop per line, indented with 4 spaces
- Alphabetical order within each category
- Original type annotations preserved exactly

### 5. Rewrite the destructuring block

In `const { ... } = props;`:
- One line per category, all props of that category on the same line, comma-separated
- A trailing comma after each category line, including the last one
- Blank line between categories (match existing style if visible)
- Preserve the exact prop names

### 6. Reorder JSX call or Hook sites — ALWAYS run this step if any JSX usage is provided

**This step is mandatory whenever JSX or Hook call sites are present in the input.** Do not skip it because the interface or destructuring block was already correctly sorted. The call site is a separate artifact that must be independently verified and reordered.

For each JSX usage of the component found in the input:
- Classify each JSX attribute by the same category rules as the interface
- Reorder attributes to match the canonical category order
- Within each category, sort alphabetically (same rule as the interface)
- Preserve the **exact value expression** of each prop — only the order of attributes changes
- Group attributes by category without blank lines
- Do NOT add `// category` comments inside JSX — attributes only
- If the JSX element was single-line before, keep it single-line after
- If the JSX element was multiline before, keep it multiline after


## Output Format

Always produce output for **every section that was provided in the input**, even if a section was already correctly sorted (output it unchanged, do not silently skip it):

1. **Interface** — rewritten or confirmed correct
2. **Destructuring block** — rewritten or confirmed correct
3. **JSX or Hook call site(s)** — reordered, or the "not provided" note if absent