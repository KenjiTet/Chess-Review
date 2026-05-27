CODING STANDARDS AND GUIDELINES
==================
- Never use inline if else statements
- Always use multi-line format for conditionals

GENERAL PRINCIPLES
==================
- All code must be developer-friendly and maintainable
- Write efficient, optimized code
- Code must be modular and reusable

FUNCTION PARAMETERS
===================
- Always inline parameters when calling functions
- Good example:
  useFunction(param1, param2, param3)

- Bad example (DO NOT USE):
  useFunction(
  param1,
  param2,
  param3
  )

CODE DOCUMENTATION
==================
- Always comment your code
- Provide clear explanations of logic and purpose

CONTROL FLOW
=============
- No inline if-else statements
- Always use multi-line format for conditionals
- No inline return statements
- Return statements should be on their own line

KEY NAMING CONVENTIONS
==================
- Unique keys when iterating: `elementName-${identifier}-${index}`

TYPE SAFETY
===========
- Always type everything, especially useState, useRef, and function parameters
- Use explicit type annotations

OPERATORS AND VALUES
====================
- Prefer nullish coalescing operator (??) over logical OR (||)
- Good: value ?? defaultValue
- Avoid: value || defaultValue

- Prefer undefined over null
- Use undefined as the default "no value" indicator

MODULARITY
==========
- Code must be modular
- Create reusable components and functions
- Follow separation of concerns principles