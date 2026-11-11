# ADR: External held-Goal control over local MCP

- Status: Accepted for the implementation candidate; installed acceptance pending
- Date: 2026-11-12
- Scope: Additive local MCP access to existing Goal execution handlers

## Context

External schedulers currently read Goal completion reports but cannot inspect
or resolve the Host-owned blocked hold through the reviewed control catalog.
A draft report can therefore hide the actual user choice between continuing
with additional material and explicitly accepting an unverified result.
The existing Main IPC and Host already own these operations and their state.

## Decision

Expose a read-only `pi_goal_execution_get`, dangerous `pi_goal_resume` and
`pi_goal_close` over the corresponding existing Main IPC handlers. Register
those handlers explicitly in the reviewed catalog, making named and generic
paths use the same confirmation requirement. Keep the Host's session,
execution and version CAS authoritative. Resume must use Main's turn and
runtime orchestration, not a direct Host mutation or ordinary prompt.

Read returns the original hold with its reasons, progress and draft gaps.
Explicit acceptance retains the original verdict and unmet checks with
`closure=user_accepted`; it must not claim independent verification passed.
Consumers read a finalized report's trusted hash separately. A response loss
is an unknown write outcome and must be reconciled through a read rather than
blindly retried. The IPC protocol owns the precise request and response DTOs.

Wire the existing report-result normalizer into both external MCP read paths:
the trusted Host hash is exposed as `report_sha256`, ready report content and
its nested hashes stay intact, and non-ready bodies are withheld. First-party
plugin IPC keeps its existing Host result shape.

## Consequences

A scheduler can show the real blocked condition and relay an explicit user
choice in the same Goal. No storage migration, new permission principal,
provider secret access, remote-host route, report-writing API or Goal
transition is introduced. Existing consumers and older installations remain
compatible through capability discovery. Resume may incur model cost; the
caller remains responsible for obtaining authorization and maintaining its
own durable operation receipt before a write.

## Verification

The authenticated local MCP and registered Main IPC contracts cover discovery,
confirmation, session/execution/version forwarding, supplemental text,
acceptance result preservation, generic-path CAS errors and invalid inputs.
Existing Main runtime tests cover same-Goal launch and rollback. The isolated
Goal blocked-resume suite also routes through authenticated MCP and registered
Main handlers to a real Host and AgentSidecar with a loopback model fixture.
The installed-app journey remains a separate acceptance boundary; no user
Goal is resumed or accepted as a test fixture.
