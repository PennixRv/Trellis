# Core runtime design

The Core change is a type-only compatibility extension to the durable
`spawned` event. CLI owns resolution and receipt construction; Core does not
validate model availability or derive profile state. Existing reducer fields
remain unchanged when the optional metadata is absent.

I05/I06 are closed by the smallest deterministic checks already present in the
Core test surface, or by a root-cause fix only when a check fails.
