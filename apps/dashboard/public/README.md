# Dashboard static assets

Files here are served from the site root (e.g. `public/remy-logo.png` → `/remy-logo.png`).

## Logo

The header expects the brand logo at:

```
apps/dashboard/public/remy-logo.png
```

Drop the Remy logo image there with that exact filename. The header (`components/Logo.tsx`)
renders it automatically; until the file exists it falls back to a text "Remy" wordmark, so
the site is never broken.

For the crispest result, a tightly-cropped or transparent-background PNG works best. The full
banner also works — it sits on a cream plate and is cropped to trim the surrounding whitespace.
