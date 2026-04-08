import type { AuditEntry } from "@fivemcp/shared";

import { AUDIT_RING_BUFFER_SIZE } from "@fivemcp/shared";

export class AuditLog {
  private readonly entries: AuditEntry[] = [];

  append(entry: AuditEntry): AuditEntry {
    this.entries.unshift(entry);
    if (this.entries.length > AUDIT_RING_BUFFER_SIZE) {
      this.entries.length = AUDIT_RING_BUFFER_SIZE;
    }
    return entry;
  }

  list(limit: number): AuditEntry[] {
    return this.entries.slice(0, limit);
  }
}
