# Project evidence records

Add only permission-backed, non-identifying project records here.

Template:

```json
{
  "id": "proj.example",
  "title": "Short non-identifying title",
  "status": "verified",
  "serviceIds": ["svc.power-washing"],
  "areaIds": ["area.shawnigan-lake"],
  "summary": "What was done, without street address or customer name.",
  "source": "ops_approval",
  "sourceReference": "ticket-or-note-id",
  "verifiedAt": "2026-08-10",
  "permissionGranted": true,
  "notes": null
}
```

Until a record exists with `status: "verified"`, project-specific GBP claims fail closed.
