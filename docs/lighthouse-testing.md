# Lighthouse Testing

Start with mobile first because most quote traffic is likely to come from phones.

## Recommended baseline flow

1. Build the site:
   `npm run build`
2. Start a production preview in another terminal:
   `npm run preview -- --host 127.0.0.1 --port 4325`
3. Run the mobile audit:
   `npm run lighthouse:mobile`
4. Optional desktop audit:
   `npm run lighthouse:desktop`

Reports are written to `qa-reports/` as both HTML and JSON.

## What to watch first

- Performance
- Accessibility
- Best Practices
- SEO

## Priority thresholds

- Performance: aim for `80+` first, then push higher
- Accessibility: aim for `95+`
- Best Practices: aim for `95+`
- SEO: aim for `95+`

## Good first-page audit targets

- `/`
- `/quote`
- `/services/power-washing`
- `/services/fence-work-minor-repairs`
- `/services/garden-bed-maintenance`

## Notes

- Run Lighthouse against the preview build, not the dev server.
- Compare mobile results before desktop because mobile is the more important conversion path here.
- Re-run after major layout, image, font, or CTA changes.
- The helper script creates `qa-reports/` automatically.
- On Windows, Lighthouse can sometimes throw a temp cleanup error after the report files are already written. The helper script treats that as a successful run if both report files exist.
