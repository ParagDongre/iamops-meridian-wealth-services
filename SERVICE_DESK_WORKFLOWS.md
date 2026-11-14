# Service Desk & ITSM Ticket Workflows

> **Scope Notice**: This module is a custom ServiceNow-style ITSM simulation built inside IAMOps. It does not integrate with an external ServiceNow instance.

## Supported Ticket Types
1. **Incident (`INC-XXXX`)**: Raised manually or automatically by the Provisioning Engine upon connector failures.
2. **Service Request (`SR-XXXX`)**: Operational directory maintenance and non-catalog requests.
3. **Operational Task (`TASK-XXXX`)**: Compliance checks and Leaver offboarding verification tasks.

## SLA Deadlines & Escalation
- `critical`: 4 hours
- `high`: 12 hours
- `medium`: 24 hours
- `low`: 48 hours

The SLA Sweep Engine (`POST /api/sla/sweep` or scheduled background timer via `SLA_SWEEP_MINUTES`) flags overdue tickets (`is_sla_breached = 1`) and escalates open breached tickets to Level 2.
