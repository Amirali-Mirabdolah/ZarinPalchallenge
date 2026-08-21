# Agent Instructions

## Project Goal

Build a high-quality analytical product for the ZarinPal data challenge.

Prioritize:

1. Actionable and novel insights
2. Accuracy and traceability
3. Analytical depth
4. Non-technical UX
5. Technical quality

## Dataset

* The dataset contains approximately 1 million payment-attempt records.
* Never load the entire raw dataset into the LLM context.
* Use Python, pandas, SQL, or other programmatic tools for full-dataset analysis.
* Prefer aggregated results and targeted subsets when reasoning about the data.
* Distinguish payment attempts from transactions.
* Account for repeated attempts and missing values.
* All monetary values are in IRR.
* `adjusted_fee` is not the real ZarinPal fee; only relative comparisons are valid.

## Workflow

Follow the project workflow step by step:

1. Discovery
2. OpenSpec / Specification
3. Implementation
4. UI refinement
5. Testing and validation

Do not skip phases or move to the next phase without explicit instruction.

## Tools & Skills

* Use OpenSpec when creating or modifying project specifications.
* Use Caveman and available UI skills when working on UI/UX.
* Follow existing project conventions before introducing new patterns.

## Engineering Rules

* Do not install packages unless explicitly required.
* Do not make unnecessary configuration changes.
* Reuse existing dependencies and project structure when possible.
* Prefer simple, maintainable solutions.
* Avoid premature abstractions.
* Keep the application performant with the large dataset.

## Data Integrity

* Never invent data, metrics, or business conclusions.
* Distinguish clearly between observed facts, calculated metrics, inferences, and hypotheses.
* Important insights must be reproducible and traceable to the source data.

## Agent Behavior

* Read this file before starting work.
* Focus only on the current requested phase.
* Do not perform unrelated work.
* Do not implement features before they are specified when the workflow requires specification first.
* Stop when the current phase is complete and wait for the next instruction.
