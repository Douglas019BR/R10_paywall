# Contributing

Thanks for taking the time to improve R10 Paywall.

## Development setup

```bash
git clone git@github.com:Douglas019BR/R10_paywall.git
cd R10_paywall
npm install
npm test
```

Then load the repository folder as an unpacked extension and enable Developer mode
in `chrome://extensions`. Reload the extension after every code or rule change.

## Adding a site rule

The generic sanitizer handles common overlays, modals and hiding styles. When a
site needs more, add an entry to [`rules/sites.json`](rules/sites.json):

```json
{
  "name": "Example News",
  "hostnames": ["*.example.com", "example.com"],
  "userAgent": "curl/8.0",
  "removeSelectors": [".paywall", "#subscription-overlay"],
  "keepSelectors": ["article", ".article-content"]
}
```

Use the smallest selectors that target the paywall, and protect the article
container with `keepSelectors` if a parent element would otherwise be removed.
Test the rule against a real article before opening a pull request.

## Pull requests

- Keep each pull request focused on one change.
- Run `npm test` and verify the extension in the browser.
- Fill in the pull request template, especially the site-rule checklist.
- CI runs the tests on every pull request to `main`.

## Reporting bugs and requesting sites

Use the issue templates for bug reports and site-rule requests. For security
issues, follow [`SECURITY.md`](SECURITY.md) instead of opening a public issue.

By participating you agree to the [Code of Conduct](CODE_OF_CONDUCT.md).
